import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAngleArc, drawSkeleton, OVERLAY_COLORS, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { IconClose } from '../../components/icons';
import { Segmented } from '../../components/ui';
import { setPrefs, usePrefs } from '../../data/prefs';
import { uuid } from '../../data/store';
import { evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { jumpRate, LATENCY_BUCKETS, TrackingDiagnostics, type DiagSample, type DiagSnapshot } from '../../engine/diagnostics';
import { ExerciseRunner, type RunnerSnapshot } from '../../engine/exerciseRunner';
import { defaultPrescription, EXERCISE_LIST, getDefinition } from '../../engine/exercises/definitions';
import { requiredView, type ExerciseId } from '../../engine/exercises/types';
import type { FilterKind } from '../../engine/filters';
import { LANDMARK_NAMES } from '../../engine/landmarks';
import { estimate, estimate3d, MEASUREMENTS } from '../../engine/measurements';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { PoseProviderId } from '../../engine/pose/provider';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import type { Landmark, Side } from '../../engine/types';
import { useT } from '../../i18n';
import { StageMedia, RuntimeOverlay } from '../scan/StageParts';

/**
 * Engineering / clinical Validation Mode (not reachable by patients).
 * Shows raw vs filtered landmarks, per-landmark confidence, raw/filtered/3D angle, FPS,
 * inference latency, state machine and thresholds, and exports anonymised recordings as CSV.
 */

interface Row {
  t: number;
  fps: number;
  inferenceMs: number;
  persons: number;
  view: string;
  rawAngle: number | null;
  filteredAngle: number | null;
  world3dAngle: number | null;
  confidence: number;
  state: string;
  reps: number;
  landmarks?: string;
}

export function ValidationMode() {
  const { t } = useT();
  const prefs = usePrefs();
  const [providerId, setProviderId] = useState<PoseProviderId>(prefs.poseProvider);
  const [exercise, setExercise] = useState<ExerciseId>('knee_flexion');
  const [side, setSide] = useState<Side>('left');
  const [filter, setFilter] = useState<FilterKind>(prefs.filter);
  const [recording, setRecording] = useState(false);
  const [includeLm, setIncludeLm] = useState(false);
  const [panel, setPanel] = useState(true);
  const [ui, setUi] = useState<{ f: ProcessedFrame | null; snap: RunnerSnapshot | null; calib: CalibrationResult | null; world: number | null; jitterRaw: number | null; jitterFilt: number | null; fps: number; inf: number }>({ f: null, snap: null, calib: null, world: null, jitterRaw: null, jitterFilt: null, fps: 0, inf: 0 });
  const { roll } = useDeviceRoll();
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runner = useRef(new ExerciseRunner(defaultPrescription(exercise, side), filter));
  const rows = useRef<Row[]>([]);
  const recRef = useRef(false);
  recRef.current = recording;
  const recStart = useRef(0);
  const hist = useRef<{ raw: number[]; filt: number[] }>({ raw: [], filt: [] });
  const lastUi = useRef(0);
  const light = useRef<LightingSample | null>(null);
  const sampler = useRef<LightingSampler | null>(null);
  const simulated = providerId === 'simulated';
  const diag = useRef(new TrackingDiagnostics(5000));
  const diagRows = useRef<DiagSample[]>([]);
  const diagLm = useRef<(string | null)[]>([]);
  const prevRaw = useRef<{ lms: Landmark[] | null; t: number }>({ lms: null, t: 0 });
  const [snap5, setSnap5] = useState<DiagSnapshot | null>(null);

  useEffect(() => {
    runner.current = new ExerciseRunner(defaultPrescription(exercise, side), filter);
    hist.current = { raw: [], filt: [] };
    diag.current.reset();
  }, [exercise, side, filter, providerId]);

  const onFrame = useCallback(
    (f: ProcessedFrame, ctx: FrameContext) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (simulated) {
        const sim = ctx.provider as SimulatedPoseProvider;
        sim.scenario = { exercise, side, peak: getDefinition(exercise).defaults.target.min + 8, holdSeconds: 3 };
      }
      const def = getDefinition(exercise);
      runner.current.update(f, ctx.now);
      const snap = runner.current.snapshot;
      const world = f.world ? estimate3d(def.primary, f.world, side) : null;
      if (!simulated && sampler.current === null) sampler.current = new LightingSampler();
      const px = simulated ? null : sampler.current?.sample(ctx.video);
      light.current = px ? lightingFromPixels(px) : simulated ? { meanLuma: 140, clippedFraction: 0 } : null;
      const calib = evaluateCalibration({
        frame: f,
        req: { landmarks: MEASUREMENTS[def.primary].landmarks(side), views: requiredView(def, side), heightRange: [0.45, 0.98], extentAxis: def.position === 'supine' ? 'horizontal' : 'vertical', minConfidence: 0.65, maxRollDeg: 4 },
        lighting: light.current,
        cameraRollDeg: simulated ? 0 : rollRef.current,
        facing: 'user',
      });

      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (c2d) {
        const mirrored = !simulated;
        if (f.raw) drawSkeleton(c2d, f.raw, f.width, f.height, { mirrored, color: OVERLAY_COLORS.raw, thin: true, jointRadius: 2, minVisibility: 0 });
        if (f.smoothed) {
          const focus = MEASUREMENTS[def.primary].landmarks(side);
          drawSkeleton(c2d, f.smoothed, f.width, f.height, { mirrored, focus, state: snap.estimate.value === null ? 'low' : 'tracked' });
          const [a, b, c] = focus;
          if (snap.estimate.value !== null) drawAngleArc(c2d, f.smoothed[a], f.smoothed[b], f.smoothed[c], f.width, f.height, `${snap.estimate.value.toFixed(1)}°`, mirrored);
        }
      }

      // Stage-separated diagnostics: raw-landmark angle vs smoothed-landmark angle vs reported angle.
      const m = def.primary;
      const req = MEASUREMENTS[m].landmarks(side);
      const rawA = estimate(m, f.raw, f.width, f.height, side, { ignoreView: true, minConfidence: 0 }).value;
      const smA = estimate(m, f.smoothed, f.width, f.height, side, { ignoreView: true, minConfidence: 0 }).value;
      const doneAt = ctx.timing.finishedAt;
      const bodyPx = bodyExtentPx(f.raw, f.width, f.height);
      const sample: DiagSample = {
        t: doneAt,
        captureTs: ctx.timing.captureTs,
        presentedFrames: ctx.timing.presentedFrames,
        inferenceMs: f.inferenceMs,
        persons: f.personCount,
        status: f.status,
        orientation: f.orientation,
        requiredVis: f.raw ? req.map((i) => f.raw![i].visibility) : [],
        jumpRate: jumpRate(prevRaw.current.lms, f.raw, req, doneAt - prevRaw.current.t, bodyPx, f.width, f.height),
        rawAngle: rawA,
        smoothAngle: smA,
        finalAngle: snap.estimate.value !== null ? snap.angle : null,
        reason: snap.estimate.value === null ? (f.status !== 'tracking' ? f.status : snap.estimate.reason) : undefined,
        meanLuma: light.current?.meanLuma ?? null,
      };
      prevRaw.current = { lms: f.raw, t: doneAt };
      diag.current.record(sample);
      if (recRef.current) {
        diagRows.current.push(sample);
        diagLm.current.push(includeLm && f.raw ? f.raw.map((l) => `${l.x.toFixed(4)},${l.y.toFixed(4)},${l.visibility.toFixed(3)}`).join(';') : null);
      }

      if (snap.rawAngle !== null) {
        hist.current.raw.push(snap.rawAngle);
        hist.current.filt.push(snap.angle ?? snap.rawAngle);
        if (hist.current.raw.length > 60) {
          hist.current.raw.shift();
          hist.current.filt.shift();
        }
      }
      if (recRef.current) {
        rows.current.push({
          t: Math.round(ctx.now - recStart.current),
          fps: Math.round(ctx.stats.fps * 10) / 10,
          inferenceMs: Math.round(f.inferenceMs * 10) / 10,
          persons: f.personCount,
          view: f.orientation,
          rawAngle: snap.rawAngle === null ? null : Math.round(snap.rawAngle * 100) / 100,
          filteredAngle: snap.estimate.value === null ? null : Math.round((snap.angle ?? 0) * 100) / 100,
          world3dAngle: world === null ? null : Math.round(world * 100) / 100,
          confidence: Math.round(snap.estimate.confidence * 1000) / 1000,
          state: snap.state,
          reps: snap.repsCounted,
          landmarks: includeLm && f.raw ? f.raw.map((l) => `${l.x.toFixed(4)}|${l.y.toFixed(4)}|${l.z.toFixed(4)}|${l.visibility.toFixed(3)}`).join(';') : undefined,
        });
      }
      if (ctx.now - lastUi.current > 200) {
        lastUi.current = ctx.now;
        const sd = (xs: number[]) => {
          if (xs.length < 10) return null;
          const m = xs.reduce((a, b) => a + b, 0) / xs.length;
          return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
        };
        setUi({ f, snap, calib, world, jitterRaw: sd(hist.current.raw), jitterFilt: sd(hist.current.filt), fps: ctx.stats.fps, inf: ctx.stats.inferenceMs });
        setSnap5(diag.current.snapshot());
      }
    },
    [exercise, side, simulated, includeLm],
  );

  const runtime = useMotionRuntime({ providerId, facing: 'user', filter, onFrame, thread: prefs.inferenceThread });

  const exportCsv = () => {
    const header = ['t_ms', 'fps', 'inference_ms', 'persons', 'view', 'raw_angle', 'filtered_angle', 'world3d_angle', 'confidence', 'state', 'reps', ...(includeLm ? ['landmarks_x|y|z|vis'] : [])];
    const lines = rows.current.map((r) => [r.t, r.fps, r.inferenceMs, r.persons, r.view, r.rawAngle ?? '', r.filteredAngle ?? '', r.world3dAngle ?? '', r.confidence, r.state, r.reps, ...(includeLm ? [r.landmarks ?? ''] : [])].join(','));
    const meta = [
      `# PhysioVision validation export (anonymised: no patient identifiers, no images)`,
      `# recording_id,${uuid()}`,
      `# exercise,${exercise}@${getDefinition(exercise).version},side,${side},filter,${filter},provider,${providerId}`,
      `# exported_at,${new Date().toISOString()}`,
    ];
    const blob = new Blob([[...meta, header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `physiovision-validation-${exercise}-${side}-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Privacy-conscious diagnostics record: timing, stage outputs and reasons — never video or identifiers. */
  const exportDiagnostics = () => {
    const video = runtime.videoRef.current;
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    const st = track?.getSettings();
    const t0 = diagRows.current[0]?.t ?? 0;
    const doc = {
      kind: 'physiovision-tracking-diagnostics',
      version: 1,
      source: simulated ? 'simulated' : 'live_camera',
      recordingId: uuid(),
      exportedAt: new Date().toISOString(),
      privacy: 'No video, images or patient identifiers. Landmark coordinates included only if selected.',
      provider: runtime.providerRef.current?.info ?? null,
      filter,
      measurement: { exercise: `${exercise}@${getDefinition(exercise).version}`, primary: getDefinition(exercise).primary, side },
      camera: st ? { width: st.width, height: st.height, frameRate: st.frameRate, facingMode: st.facingMode, displayMirrored: true } : null,
      device: { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency ?? null },
      summary: diag.current.snapshot(),
      frames: diagRows.current.map((r, i) => ({
        t: Math.round(r.t - t0),
        ageMs: r.captureTs === null ? null : Math.round(r.t - r.captureTs),
        presented: r.presentedFrames,
        inferMs: Math.round(r.inferenceMs * 10) / 10,
        persons: r.persons,
        status: r.status,
        view: r.orientation,
        vis: r.requiredVis.map((v) => Math.round(v * 100) / 100),
        jump: r.jumpRate === null ? null : Math.round(r.jumpRate * 100) / 100,
        raw: rnd(r.rawAngle),
        smooth: rnd(r.smoothAngle),
        final: rnd(r.finalAngle),
        reason: r.reason ?? null,
        luma: r.meanLuma === null || r.meanLuma === undefined ? null : Math.round(r.meanLuma),
        lms: diagLm.current[i] ?? undefined,
      })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
    a.download = `physiovision-diagnostics-${exercise}-${side}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const def = getDefinition(exercise);
  const th = def.thresholds;
  const rx = runner.current.rx;
  const lmIdx = MEASUREMENTS[def.primary].landmarks(side);

  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored simulated={simulated} />
      <div className="stage-top">
        <Link className="stage-btn" to="/c/settings" aria-label={t('common.close')}>
          <IconClose width={20} />
        </Link>
        <strong className="grow">Validation Mode {simulated && <span className="badge demo">{t('common.simulated')}</span>}</strong>
        <button className="stage-btn" onClick={() => setPanel((p) => !p)} aria-pressed={panel}>
          Panel
        </button>
      </div>
      <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} onUseDemo={() => setProviderId('simulated')} />
      {panel && (
        <aside className="glass mono" style={{ position: 'absolute', zIndex: 4, right: 8, top: 64, bottom: 8, width: 'min(400px, calc(100% - 16px))', overflowY: 'auto', padding: '0.75rem', fontSize: '0.75rem' }}>
          <div className="stack tight">
            <Segmented<PoseProviderId> label="Provider" value={providerId} onChange={setProviderId} options={[{ id: 'mediapipe-lite', label: 'Lite' }, { id: 'mediapipe-full', label: 'Full' }, { id: 'mediapipe-heavy', label: 'Heavy' }, { id: 'simulated', label: 'Sim' }]} />
            <Segmented<ExerciseId> label="Exercise" value={exercise} onChange={setExercise} options={EXERCISE_LIST.map((d) => ({ id: d.id, label: d.id.replace(/_/g, ' ') }))} />
            <Segmented<Side> label="Side" value={side} onChange={setSide} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
            <Segmented<FilterKind> label="Angle filter (live)" value={filter} onChange={setFilter} options={[{ id: 'one_euro', label: '1€' }, { id: 'ema', label: 'EMA' }, { id: 'kalman', label: 'Kalman' }, { id: 'none', label: 'Raw' }]} />
            <Segmented<'auto' | 'main'> label="Inference thread" value={prefs.inferenceThread} onChange={(v) => setPrefs({ inferenceThread: v })} options={[{ id: 'auto', label: 'Worker (auto)' }, { id: 'main', label: 'Main (fallback)' }]} />
          </div>
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <StagePanel snap={snap5} />
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <table style={{ width: '100%' }}>
            <tbody>
              <KV k="Inference thread · delegate" v={`${runtime.stats.thread ?? '–'} · ${runtime.stats.delegate ?? '–'}${runtime.stats.probing ? ' (timing delegates…)' : ''}${runtime.stats.fallbackReason ? ` (${runtime.stats.fallbackReason})` : ''}`} />
              <KV k="Delegate timing (median ms)" v={Object.entries(runtime.stats.delegateMeasuredMs).map(([k, v]) => `${k} ${v}`).join(' · ') || '–'} />
              <KV k="Camera fps / inference fps" v={`${fmt(snap5?.cameraFps)} / ${fmt(snap5?.inferenceFps)}`} />
              <KV k="Camera frames skipped" v={snap5?.skippedFraction === null || snap5?.skippedFraction === undefined ? '–' : `${Math.round(snap5.skippedFraction * 100)}%`} />
              <KV k="Frame age capture→result p50 / p95" v={snap5?.frameAge ? `${fmt(snap5.frameAge.p50, 0)} / ${fmt(snap5.frameAge.p95, 0)} ms` : '–'} />
              <KV k="Inference p50 / p95 / max" v={snap5 ? `${fmt(snap5.latency.p50)} / ${fmt(snap5.latency.p95)} / ${fmt(snap5.latency.max)} ms` : '–'} />
              <KV k="Pose presence / >1 person" v={snap5 ? `${Math.round(snap5.presence * 100)}% / ${Math.round(snap5.multiplePeople * 100)}%` : '–'} />
              <KV k="Implausible jumps" v={snap5 ? `${Math.round(snap5.jumpFraction * 100)}%` : '–'} />
              <KV k="Filter lag / RMS Δ (raw→reported)" v={snap5 ? `${snap5.filterLagMs ?? '–'} ms / ${fmt(snap5.filterDeltaRms, 2)}°` : '–'} />
            </tbody>
          </table>
          {snap5 && <LatencyHistogram counts={snap5.latency.histogram} />}
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <table style={{ width: '100%' }}>
            <tbody>
              <KV k="FPS" v={ui.fps.toFixed(1)} />
              <KV k="Inference (ms)" v={ui.inf.toFixed(1)} />
              <KV k="Persons" v={ui.f?.personCount ?? '–'} />
              <KV k="Tracking" v={ui.f?.status ?? '–'} />
              <KV k="View (vote)" v={`${ui.f?.orientation ?? '–'} (${(ui.f?.orientationConfidence ?? 0).toFixed(2)})`} />
              <KV k="Raw angle" v={fmt(ui.snap?.rawAngle)} />
              <KV k="Filtered angle" v={fmt(ui.snap?.estimate.value !== null ? ui.snap?.angle : null)} />
              <KV k="World-3D angle" v={fmt(ui.world)} />
              <KV k="Angle SD raw / filt, 2 s (hold still = jitter)" v={`${fmt(ui.jitterRaw, 2)} / ${fmt(ui.jitterFilt, 2)}`} />
              <KV k="Confidence" v={`${(ui.snap?.estimate.confidence ?? 0).toFixed(3)} ${ui.snap?.estimate.reason ?? ''}`} />
              <KV k="Velocity (°/s)" v={fmt(ui.snap?.velocity)} />
              <KV k="Motion state" v={ui.snap?.state ?? '–'} />
              <KV k="Reps counted / attempts" v={`${ui.snap?.repsCounted ?? 0} / ${ui.snap?.attempts ?? 0}`} />
              <KV k="Hold elapsed (s)" v={fmt(ui.snap?.holdElapsed, 2)} />
              <KV k="Peak this attempt" v={fmt(ui.snap?.peak)} />
            </tbody>
          </table>
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <strong>Thresholds · {def.id}@{def.version}</strong>
          <table style={{ width: '100%' }}>
            <tbody>
              <KV k="Rest ≤" v={`${th.restThreshold}°`} />
              <KV k="Start >" v={`${th.restThreshold + th.startDelta}°`} />
              <KV k="Target" v={`${rx.target.min}–${rx.target.max}°`} />
              <KV k="Approach from" v={`${rx.target.min - th.approachMargin}°`} />
              <KV k="Hold / tolerance" v={`${rx.holdSeconds}s / −${th.holdTolerance}°`} />
              <KV k="Over-target cue >" v={`${rx.target.max + th.overTolerance}°`} />
              <KV k="Max velocity" v={`${rx.tempo.maxVelocityDegPerSec}°/s`} />
              <KV k="Pause reset" v={`${th.pauseResetMs} ms`} />
            </tbody>
          </table>
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <strong>Calibration</strong>
          <table style={{ width: '100%' }}>
            <tbody>
              {ui.calib?.checks.map((c) => (
                <KV key={c.id} k={`${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '?'} ${c.id}`} v={c.detail ?? ''} />
              ))}
            </tbody>
          </table>
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <strong>Landmark visibility (raw → filtered x,y)</strong>
          <table style={{ width: '100%' }}>
            <tbody>
              {lmIdx.map((i) => {
                const r = ui.f?.raw?.[i];
                const s = ui.f?.smoothed?.[i];
                return <KV key={i} k={LANDMARK_NAMES[i]} v={r && s ? `${r.visibility.toFixed(2)} · ${r.x.toFixed(3)},${r.y.toFixed(3)} → ${s.x.toFixed(3)},${s.y.toFixed(3)}` : '–'} />;
              })}
            </tbody>
          </table>
          <hr className="divider" style={{ margin: '0.6rem 0', background: '#2c4a4f' }} />
          <label className="row" style={{ gap: '0.4rem' }}>
            <input type="checkbox" checked={includeLm} onChange={(e) => setIncludeLm(e.target.checked)} /> include raw landmark coordinates
          </label>
          <div className="row wrap" style={{ marginTop: '0.5rem' }}>
            <button
              className={`btn sm ${recording ? 'danger' : 'primary'}`}
              onClick={() => {
                if (!recording) {
                  rows.current = [];
                  diagRows.current = [];
                  diagLm.current = [];
                  recStart.current = performance.now();
                }
                setRecording((r) => !r);
              }}
            >
              {recording ? `Stop (${rows.current.length})` : 'Record'}
            </button>
            <button className="btn sm secondary" disabled={recording || rows.current.length === 0} onClick={exportCsv}>
              Export CSV
            </button>
            <button className="btn sm secondary" disabled={recording || diagRows.current.length === 0} onClick={exportDiagnostics}>
              Export diagnostics
            </button>
          </div>
          <p style={{ color: '#8fb0aa', marginTop: '0.5rem' }}>Orange = raw landmarks, cyan = filtered. Exports contain no patient identifiers or images.</p>
        </aside>
      )}
    </div>
  );
}

const STAGE_LABEL = { camera: 'Camera frame', pose: 'Pose output', filter: 'Filter', measurement: 'Measurement' } as const;
const STAGE_COLOR = { ok: '#3ecf8e', warn: '#f5b83d', fail: '#ff6b5e', unknown: '#8fb0aa' } as const;

/** Four pipeline stages; the first non-ok stage is where a problem starts. */
function StagePanel({ snap }: { snap: DiagSnapshot | null }) {
  const first = snap?.verdicts.find((v) => v.status === 'fail' || v.status === 'warn');
  return (
    <div role="group" aria-label="Pipeline stages">
      <strong>Pipeline stages (last {snap?.windowSec ?? 0} s)</strong>
      <table style={{ width: '100%', marginTop: 4 }}>
        <tbody>
          {(snap?.verdicts ?? []).map((v) => (
            <tr key={v.stage} style={first?.stage === v.stage ? { outline: `1px solid ${STAGE_COLOR[v.status]}` } : undefined}>
              <td style={{ whiteSpace: 'nowrap', paddingRight: 6 }}>
                <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: STAGE_COLOR[v.status], marginRight: 6 }} />
                {STAGE_LABEL[v.stage]}
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className="sr-only">{v.status}: </span>
                {v.summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {first && <p style={{ color: STAGE_COLOR[first.status], margin: '4px 0 0' }}>Start with: {STAGE_LABEL[first.stage].toLowerCase()}</p>}
    </div>
  );
}

function LatencyHistogram({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div aria-label="Inference latency distribution" style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }}>
        {counts.map((c, i) => (
          <div key={i} title={`${c} frames`} style={{ flex: 1, height: `${(c / max) * 100}%`, minHeight: c ? 2 : 0, background: '#4fb3a6' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, color: '#8fb0aa', fontSize: 9 }}>
        {LATENCY_BUCKETS.map((b, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center' }}>
            {Number.isFinite(b) ? `≤${b}` : '>'}
          </span>
        ))}
      </div>
    </div>
  );
}

function bodyExtentPx(lms: Landmark[] | null, w: number, h: number): number {
  if (!lms) return 0;
  const vis = lms.filter((l) => l.visibility > 0.5);
  if (vis.length < 4) return h * 0.5;
  const xs = vis.map((l) => l.x * w);
  const ys = vis.map((l) => l.y * h);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

const rnd = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function KV({ k, v }: { k: string; v: string | number }) {
  return (
    <tr>
      <td style={{ color: '#8fb0aa', paddingRight: 8, verticalAlign: 'top' }}>{k}</td>
      <td style={{ textAlign: 'right' }}>{v}</td>
    </tr>
  );
}

function fmt(v: number | null | undefined, d = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d);
}
