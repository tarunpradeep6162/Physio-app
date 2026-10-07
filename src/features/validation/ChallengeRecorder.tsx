import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { drawSkeleton, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { Notice } from '../../components/ui';
import type { ChallengeClip } from '../../data/models';
import { usePrefs } from '../../data/prefs';
import { insert, remove, update, useDb, uuid } from '../../data/store';
import type { ProcessedFrame } from '../../engine/pipeline';
import { checkClip, CONSENT_VERSION, encodeLandmarks, exportChallengeSet } from '../../lab/challenge';
import { deviceClass } from '../../clinical/validationData';
import { RuntimeOverlay, StageMedia } from '../scan/StageParts';

/**
 * Phase 51: record occlusion challenge clips with consenting VOLUNTEERS (not patients) for the
 * Phase 22 locked challenge set. Stores raw model landmarks only, never video. The operator holds a
 * button while the occluder is in place; that marking is the ground truth. Choosing, locking and
 * judging the set is for the Phase 22 reviewers.
 */
const MAX_MS = 15_000;
const OCCLUDERS = ['Phone held in front', 'Hand or forearm', 'Chair or table', 'Bag or object', 'Other person', 'Other'];
const JOINTS = ['left shoulder', 'right shoulder', 'left elbow', 'right elbow', 'left wrist', 'right wrist', 'left hip', 'right hip', 'left knee', 'right knee', 'left ankle', 'right ankle'];
const VIEWS = ['front', 'back', 'left side', 'right side'];

interface Setup {
  participantCode: string;
  consented: boolean;
  occluder: string;
  joints: string[];
  view: string;
  lighting: string;
  notes: string;
}

export function ChallengeRecorder() {
  const user = useCurrentUser();
  const prefs = usePrefs();
  const clips = useDb((d) => d.challengeClips);
  const [setup, setSetup] = useState<Setup>({ participantCode: '', consented: false, occluder: OCCLUDERS[0], joints: [], view: 'front', lighting: '', notes: '' });
  const [stage, setStage] = useState<'setup' | 'camera' | 'review'>('setup');
  const [draft, setDraft] = useState<ChallengeClip | null>(null);
  const [setName, setSetName] = useState('occlusion-set-1');
  const [message, setMessage] = useState<string | null>(null);
  if (!user) return null;
  const ready = setup.participantCode.trim() && setup.consented && setup.joints.length > 0;
  const simulated = prefs.poseProvider === 'simulated';

  const exportSet = (lock: boolean) => {
    const real = clips.filter((c) => !c.isDemo && !c.lockedInSet);
    if (!real.length) {
      setMessage('No unlocked clips from a real camera to export.');
      return;
    }
    const res = exportChallengeSet(real, setName.trim(), new Date().toISOString());
    if (!res.ok) {
      setMessage(`Not exported: ${res.problems.map((p) => `${p.clipId.slice(0, 6)} — ${p.problem}`).join('; ')}`);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(res.file)], { type: 'application/json' }));
    a.download = `${setName.trim()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (lock) for (const c of real) update('challengeClips', c.id, { lockedInSet: setName.trim() }, user.id, 'lock');
    setMessage(`${real.length} clip(s) exported${lock ? ` and locked into "${setName.trim()}"` : ''}.`);
  };

  if (stage === 'camera') {
    return <RecorderStage setup={setup} actorId={user.id} onCancel={() => setStage('setup')} onDone={(clip) => { setDraft(clip); setStage('review'); }} />;
  }

  return (
    <div className="content stack loose">
      <div>
        <p className="eyebrow">Validation · Phase 51</p>
        <h1>Occlusion challenge recorder</h1>
        <p className="muted">Record short clips of a consenting volunteer while something covers a joint, so the occlusion checks can be tested on real people and phones.</p>
      </div>
      <Notice tone="warn">
        For volunteers only, never patients. Only the pose model’s landmark points are stored; no video or image is kept. Each clip needs the volunteer’s written consent for this purpose, recorded under a participant code (no names).
        {simulated && ' The simulated camera is selected: clips recorded with it are marked as demo and can never be exported.'}
      </Notice>
      {stage === 'review' && draft && (
        <section className="panel stack tight" aria-labelledby="review-h">
          <h2 id="review-h">Review clip</h2>
          <p className="small" style={{ margin: 0 }}>
            {draft.t.length} frames · person detected in {draft.frames.filter(Boolean).length} · marked occluded in {draft.occluded.filter(Boolean).length}
          </p>
          {(() => {
            const problems = checkClip(draft);
            return problems.length ? <ul className="small" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="small" role="status">The clip passes the structural checks.</p>;
          })()}
          <div className="row wrap">
            <button className="btn primary" onClick={() => { insert('challengeClips', draft, user.id); setDraft(null); setStage('setup'); setMessage('Clip saved.'); }}>Save clip</button>
            <button className="btn secondary" onClick={() => { setDraft(null); setStage('camera'); }}>Record again</button>
            <button className="btn ghost" onClick={() => { setDraft(null); setStage('setup'); }}>Discard</button>
          </div>
        </section>
      )}
      {stage === 'setup' && (
        <section className="panel stack tight" aria-labelledby="setup-h">
          <h2 id="setup-h">New clip</h2>
          <label className="field"><span>Participant code (no names)</span><input className="input" value={setup.participantCode} onChange={(e) => setSetup({ ...setup, participantCode: e.target.value })} placeholder="e.g. V-03" /></label>
          <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
            <input type="checkbox" checked={setup.consented} onChange={(e) => setSetup({ ...setup, consented: e.target.checked })} />
            <span className="small">The volunteer has given written consent to landmark-only recording for occlusion testing (consent form {CONSENT_VERSION}, draft awaiting ethics review). They are not a patient of this clinic in this recording.</span>
          </label>
          <label className="field"><span>What covers the joint</span>
            <select className="input" value={setup.occluder} onChange={(e) => setSetup({ ...setup, occluder: e.target.value })}>{OCCLUDERS.map((o) => <option key={o}>{o}</option>)}</select>
          </label>
          <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 650 }}>Joints that will be covered</legend>
            <div className="chips">
              {JOINTS.map((j) => <button key={j} type="button" className="chip" aria-pressed={setup.joints.includes(j)} onClick={() => setSetup({ ...setup, joints: setup.joints.includes(j) ? setup.joints.filter((x) => x !== j) : [...setup.joints, j] })}>{j}</button>)}
            </div>
          </fieldset>
          <label className="field"><span>Camera view</span>
            <select className="input" value={setup.view} onChange={(e) => setSetup({ ...setup, view: e.target.value })}>{VIEWS.map((v) => <option key={v}>{v}</option>)}</select>
          </label>
          <label className="field"><span>Lighting (optional)</span><input className="input" value={setup.lighting} onChange={(e) => setSetup({ ...setup, lighting: e.target.value })} placeholder="e.g. window light from the left" /></label>
          <label className="field"><span>Notes (optional, no identifying details)</span><input className="input" value={setup.notes} onChange={(e) => setSetup({ ...setup, notes: e.target.value })} /></label>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!ready} onClick={() => setStage('camera')}>Open camera</button>
        </section>
      )}
      <section className="panel stack tight" aria-labelledby="clips-h">
        <h2 id="clips-h">Saved clips ({clips.length})</h2>
        {message && <p className="small" role="status" style={{ margin: 0 }}>{message}</p>}
        {clips.length === 0 && <p className="small muted">No clips yet.</p>}
        <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {clips.map((c) => {
            const problems = checkClip(c);
            return (
              <li key={c.id} className="row between wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem' }}>
                <span className="small">
                  <strong>{c.consent.participantCode}</strong> · {c.label.occluder} over {c.label.joints.join(', ')} · {c.label.view} · {c.label.deviceClass} · {c.t.length} frames
                  {c.isDemo && <span className="badge demo"> simulated</span>}
                  {c.lockedInSet && <span className="badge ok"> locked in {c.lockedInSet}</span>}
                  {problems.length > 0 && <span className="xs muted"> — {problems.join('; ')}</span>}
                </span>
                {!c.lockedInSet && <button className="btn ghost sm" onClick={() => remove('challengeClips', c.id, user.id)}>Delete</button>}
              </li>
            );
          })}
        </ul>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field"><span>Set name</span><input className="input" value={setName} onChange={(e) => setSetName(e.target.value)} /></label>
          <button className="btn secondary" disabled={!setName.trim()} onClick={() => exportSet(false)}>Export (JSON)</button>
          <button className="btn secondary" disabled={!setName.trim()} onClick={() => exportSet(true)}>Export and lock</button>
        </div>
        <p className="xs muted" style={{ margin: 0 }}>Export includes unlocked clips from a real camera only. Locking makes those clips unchangeable; do it only when the Phase 22 reviewers have agreed the set. Pass/fail is judged by them, not here. See <Link to="/c/analytics">Where capture fails</Link> for field data.</p>
      </section>
    </div>
  );
}

function RecorderStage({ setup, actorId, onCancel, onDone }: { setup: Setup; actorId: string; onCancel: () => void; onDone: (clip: ChallengeClip) => void }) {
  const prefs = usePrefs();
  const simulated = prefs.poseProvider === 'simulated';
  const [facing] = useState<'user' | 'environment'>('environment');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rec = useRef<{ start: number; t: number[]; frames: (string | null)[]; occluded: boolean[]; w: number; h: number } | null>(null);
  const occludedNow = useRef(false);
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const finish = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    if (!r) return;
    onDone({
      id: uuid(),
      label: { occluder: setup.occluder, joints: setup.joints, view: setup.view, deviceClass: deviceClass(navigator.userAgent), lighting: setup.lighting || undefined, notes: setup.notes || undefined },
      t: r.t, frames: r.frames, occluded: r.occluded, frameWidth: r.w, frameHeight: r.h,
      consent: { participantCode: setup.participantCode.trim(), landmarkUse: true, videoRetained: false, consentVersion: CONSENT_VERSION, recordedBy: actorId },
      createdAt: new Date().toISOString(),
      isDemo: simulated || undefined,
    });
  }, [setup, actorId, simulated, onDone]);

  const onFrame = useCallback((f: ProcessedFrame, ctx: FrameContext) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (c2d && f.raw) drawSkeleton(c2d, f.raw, f.width, f.height, { mirrored: facing === 'user', minVisibility: 0.5 });
    }
    const r = rec.current;
    if (!r) return;
    if (!r.start) r.start = ctx.now;
    r.w = f.width;
    r.h = f.height;
    r.t.push(Math.round(ctx.now - r.start));
    r.frames.push(encodeLandmarks(f.raw));
    r.occluded.push(occludedNow.current);
    if (ctx.now - r.start >= MAX_MS) finish();
    else if (r.t.length % 10 === 0) setElapsed(ctx.now - r.start);
  }, [facing, finish]);

  const runtime = useMotionRuntime({ providerId: prefs.poseProvider, facing, filter: prefs.filter, onFrame });
  const hold = (v: boolean) => {
    occludedNow.current = v;
    setHeld(v);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !rec.current) return;
      e.preventDefault();
      hold(e.type === 'keydown');
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
    };
  }, []);
  const secs = useMemo(() => Math.floor(elapsed / 1000), [elapsed]);

  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored={facing === 'user'} simulated={simulated} />
      <div className="stage-top">
        <div className="grow">
          <div style={{ fontWeight: 700 }}>Challenge clip · {setup.participantCode}</div>
          <div className="xs" style={{ color: '#8fb0aa' }}>{setup.occluder} over {setup.joints.join(', ')} · {setup.view}{simulated && ' · simulated camera'}</div>
        </div>
        <button className="btn sm secondary" onClick={onCancel}>Close</button>
      </div>
      <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} />
      {runtime.status === 'running' && (
        <div className="stage-bottom stack">
          <div className="glass stack tight" style={{ padding: '0.75rem 1rem' }}>
            {!recording ? (
              <>
                <p className="small" style={{ margin: 0 }}>Start with the joints clear, then cover them. Hold the button (or the space bar) for exactly the time the occluder is in place. Recording stops after {MAX_MS / 1000} s.</p>
                <button className="btn primary" onClick={() => { rec.current = { start: 0, t: [], frames: [], occluded: [], w: 0, h: 0 }; setElapsed(0); setRecording(true); }}>Start recording</button>
              </>
            ) : (
              <>
                <p className="small" role="status" style={{ margin: 0 }}>Recording · {secs} s {held && '· occluder marked'}</p>
                <button
                  className={`btn ${held ? 'primary' : 'secondary'}`}
                  style={{ minHeight: 64, touchAction: 'none' }}
                  aria-pressed={held}
                  onPointerDown={() => hold(true)}
                  onPointerUp={() => hold(false)}
                  onPointerCancel={() => hold(false)}
                  onPointerLeave={() => hold(false)}
                >
                  Hold while the occluder is in place
                </button>
                <button className="btn ghost" onClick={finish}>Stop</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
