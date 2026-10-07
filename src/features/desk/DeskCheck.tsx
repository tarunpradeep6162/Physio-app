import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAlignmentFrame, drawAngleArc, drawSkeleton, label, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { Notice } from '../../components/ui';
import { IconClose, IconFlip } from '../../components/icons';
import type { Measurement, Patient } from '../../data/models';
import { usePrefs } from '../../data/prefs';
import { insertMany, useDb, uuid } from '../../data/store';
import { CalibrationGate, evaluateCalibration, lightingFromPixels, type CalibrationMemory, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { DESK_CHECK_VERSION, DESK_METRICS, DeskCapture, deskNearSide, deskReadings, type DeskFrame, type DeskResult } from '../../engine/deskPosture';
import { jointList, LM } from '../../engine/landmarks';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import { cameraProvenance, type DeviceContext } from '../../engine/provenance';
import type { PoseProviderInfo } from '../../engine/types';
import { useT } from '../../i18n';
import { CalibrationChecklist, CuePill, RuntimeOverlay, StageMedia } from '../scan/StageParts';

/**
 * Desk posture check — seated, side view. Shows only the angles the camera can measure from visible
 * landmarks (see engine/deskPosture.ts). No ideal values, no screen-height or chair advice and no
 * severity labels; results are camera estimates saved for the physiotherapist to review.
 */

const CAPTURE_MS = 3000;
type Phase = 'intro' | 'calibrating' | 'capturing' | 'done';

interface Captured {
  results: DeskResult[];
  side: 'left' | 'right' | null;
  provider: PoseProviderInfo;
  device: DeviceContext;
}

/** Patient: /p/desk */
export function PatientDeskCheck() {
  const patient = useCurrentPatient();
  if (!patient) return <div className="content">…</div>;
  return <DeskCheck patient={patient} backTo="/p/home" />;
}

/** Physiotherapist with a patient: /c/patients/:id/desk */
export function ClinicDeskCheck() {
  const { id } = useParams();
  const patient = useDb((d) => d.patients.find((p) => p.id === id), [id]);
  if (!patient) return <div className="content">Patient not found.</div>;
  return <DeskCheck patient={patient} backTo={`/c/patients/${patient.id}`} />;
}

function DeskCheck({ patient, backTo }: { patient: Patient; backTo: string }) {
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const [phase, setPhase] = useState<Phase>('intro');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [saved, setSaved] = useState(false);
  if (phase === 'intro') {
    return (
      <div className="content narrow stack loose">
        <div>
          <p className="eyebrow">{t('desk.eyebrow')}</p>
          <h1>{t('desk.title')}</h1>
          <p className="muted">{t('desk.lede')}</p>
        </div>
        <div className="panel stack">
          <h2 className="h3">{t('desk.setup_title')}</h2>
          <ol className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
            {[1, 2, 3, 4].map((i) => (
              <li key={i}>{t(`desk.setup_${i}`)}</li>
            ))}
          </ol>
        </div>
        <div className="panel stack">
          <h2 className="h3">{t('desk.measures_title')}</h2>
          <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
            {DESK_METRICS.map((m) => (
              <li key={m}>
                <strong>{t(`measure.desk.${m}`)}</strong> — {t(`desk.how.${m}`)}
              </li>
            ))}
          </ul>
          <Notice tone="info">{t('desk.limits')}</Notice>
        </div>
        <div className="row wrap">
          <Link to={backTo} className="btn secondary">
            {t('common.back')}
          </Link>
          <button className="btn primary grow" onClick={() => setPhase('calibrating')}>
            {t('desk.start')}
          </button>
        </div>
      </div>
    );
  }
  if (phase === 'done' && captured) {
    const save = () => {
      if (!user || saved) return;
      const measured = captured.results.filter((r) => r.value !== null);
      const conf = measured.length ? measured.reduce((a, r) => a + r.confidence, 0) / measured.length : 0;
      const prov = cameraProvenance({ createdBy: user.id, provider: captured.provider, confidence: conf, filter: 'none', view: captured.side ? `seated_lateral_${captured.side}` : 'seated_lateral', device: captured.device, exercise: { id: 'desk_check', version: DESK_CHECK_VERSION } });
      const now = new Date().toISOString();
      const rows: Measurement[] = measured.map((r) => ({
        id: uuid(),
        patientId: patient.id,
        type: `desk.${r.id}`,
        value: r.value!,
        unit: 'deg',
        side: captured.side ?? undefined,
        direction: r.id === 'hip_angle' ? undefined : r.value! >= 0 ? 'forward' : 'backward',
        sd: r.sd ?? undefined,
        confidence: r.confidence,
        category: 'camera_estimate',
        metricId: `desk.${r.id}`,
        validity: 'valid',
        provenance: prov,
        reviewStatus: 'pending',
        createdAt: now,
        isDemo: patient.isDemo || captured.provider.simulated || undefined,
      }));
      insertMany('measurements', rows, user.id);
      setSaved(true);
    };
    return (
      <div className="content narrow stack loose">
        <div>
          <p className="eyebrow">{t('desk.eyebrow')}</p>
          <h1>{t('desk.results_title')}</h1>
          {captured.provider.simulated && <span className="badge demo">{t('common.simulated')}</span>}
        </div>
        <DeskResultsTable results={captured.results} />
        <Notice tone="info">{t('desk.result_note')}</Notice>
        {saved ? <Notice tone="ok">{t('desk.saved')}</Notice> : null}
        <div className="row wrap">
          <button
            className="btn secondary"
            onClick={() => {
              setCaptured(null);
              setSaved(false);
              setPhase('calibrating');
            }}
          >
            {t('scan.retake')}
          </button>
          {!saved && (
            <button className="btn primary grow" disabled={!captured.results.some((r) => r.value !== null)} onClick={save}>
              {t('desk.save')}
            </button>
          )}
          {saved && (
            <button className="btn primary grow" onClick={() => nav(backTo)}>
              {t('common.done')}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <DeskStage
      onCancel={() => setPhase('intro')}
      onDone={(c) => {
        setCaptured(c);
        setPhase('done');
      }}
    />
  );
}

export function DeskResultsTable({ results }: { results: DeskResult[] }) {
  const { t } = useT();
  // Stacked cards rather than a table: three columns are unreadable on a 390 px phone.
  return (
    <ul className="desk-results" aria-label={t('desk.results_title')}>
      {results.map((r) => (
        <li key={r.id} className="panel">
          <div className="row between" style={{ alignItems: 'baseline', gap: '0.75rem' }}>
            <strong>{t(`measure.desk.${r.id}`)}</strong>
            <span className="num desk-value">{r.value === null ? '—' : `${r.value.toFixed(1)}°`}</span>
          </div>
          <p className="xs muted" style={{ margin: '0.25rem 0' }}>
            {t(`desk.how.${r.id}`)}
          </p>
          <p className="small" style={{ margin: 0 }}>
            {r.value === null ? (
              <>
                {t('desk.withheld')}: {t(`desk.why.${r.withheld ?? 'too_few_frames'}`)}
              </>
            ) : (
              t('desk.quality', { n: r.frames, sd: (r.sd ?? 0).toFixed(1), c: Math.round(r.confidence * 100) })
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DeskStage({ onCancel, onDone }: { onCancel: () => void; onDone: (c: Captured) => void }) {
  const { t } = useT();
  const prefs = usePrefs();
  const [providerId, setProviderId] = useState(prefs.poseProvider);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [phase, setPhase] = useState<'calibrating' | 'capturing'>('calibrating');
  const [ui, setUi] = useState<{ calib: CalibrationResult | null; progress: number; frame: DeskFrame | null }>({ calib: null, progress: 0, frame: null });
  const simulated = providerId === 'simulated';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<'calibrating' | 'capturing'>('calibrating');
  const gate = useRef(new CalibrationGate(1200));
  const memory = useRef<CalibrationMemory>({});
  const capture = useRef<DeskCapture | null>(null);
  const started = useRef(0);
  const lighting = useRef<LightingSample | null>(null);
  const lightingT = useRef(0);
  const sampler = useRef<LightingSampler | null>(null);
  const lastUi = useRef(0);
  const finished = useRef(false);
  const { roll, needsPermission, request } = useDeviceRoll();
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;

  const onFrame = useCallback(
    (f: ProcessedFrame, ctx: FrameContext) => {
      const canvas = canvasRef.current;
      if (!canvas || finished.current) return;
      if (simulated) {
        const sim = ctx.provider as unknown as SimulatedPoseProvider;
        sim.scenario = { ...sim.scenario, exercise: 'posture_desk', side: 'left' };
      }
      if (ctx.now - lightingT.current > 500) {
        lightingT.current = ctx.now;
        if (simulated) lighting.current = { meanLuma: 140, clippedFraction: 0 };
        else {
          sampler.current ??= new LightingSampler();
          const px = sampler.current.sample(ctx.video);
          lighting.current = px ? lightingFromPixels(px) : null;
        }
      }
      const lms = f.smoothed;
      const side = (lms && deskNearSide(lms)) ?? 'left';
      const n = side === 'left' ? { ear: LM.leftEar, sh: LM.leftShoulder, hip: LM.leftHip, knee: LM.leftKnee } : { ear: LM.rightEar, sh: LM.rightShoulder, hip: LM.rightHip, knee: LM.rightKnee };
      const calib = evaluateCalibration({
        memory: memory.current,
        frame: f,
        req: { landmarks: [n.ear, n.sh, n.hip], views: ['lateral_left', 'lateral_right'], heightRange: [0.25, 0.92], extentLandmarks: [n.ear, n.hip], minConfidence: 0.6, maxRollDeg: 3 },
        lighting: lighting.current,
        cameraRollDeg: simulated ? 0 : rollRef.current,
        facing,
      });
      const g = gate.current.update(calib, ctx.now);
      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (!c2d) return;
      const mirrored = facing === 'user' && !simulated;
      drawAlignmentFrame(c2d, f.width, f.height, g.ready, g.progress);
      const frame = lms ? deskReadings(lms, f.width, f.height) : null;
      if (lms) {
        drawSkeleton(c2d, lms, f.width, f.height, { mirrored, minVisibility: 0.5 });
        // Angles are drawn only once setup passes, and only through the visible landmarks they use.
        if (calib.frameReady && frame) {
          const val = (id: string) => frame.readings.find((r) => r.id === id)?.value ?? null;
          const vertical = (i: number) => ({ ...lms[i], y: lms[i].y - 0.12 });
          const fmt = (v: number | null) => (v === null ? null : `${v.toFixed(0)}°`);
          if (val('head_line') !== null) drawAngleArc(c2d, vertical(n.sh), lms[n.sh], lms[n.ear], f.width, f.height, fmt(val('head_line')), mirrored);
          if (val('trunk_lean') !== null) drawAngleArc(c2d, vertical(n.hip), lms[n.hip], lms[n.sh], f.width, f.height, fmt(val('trunk_lean')), mirrored);
          if (val('hip_angle') !== null) drawAngleArc(c2d, lms[n.sh], lms[n.hip], lms[n.knee], f.width, f.height, fmt(val('hip_angle')), mirrored, 'target');
        }
      }
      if (phaseRef.current === 'calibrating' && g.ready) {
        capture.current = new DeskCapture();
        started.current = ctx.now;
        phaseRef.current = 'capturing';
        setPhase('capturing');
      }
      if (phaseRef.current === 'capturing') {
        if (!calib.frameReady || !frame) {
          // Setup lost mid-capture (e.g. an arm or the phone hid the body): discard the window.
          capture.current = null;
          gate.current.reset();
          phaseRef.current = 'calibrating';
          setPhase('calibrating');
        } else {
          capture.current!.add(frame);
          const prog = (ctx.now - started.current) / CAPTURE_MS;
          label(c2d, `${Math.min(100, Math.round(prog * 100))}%`, f.width / 2, f.height * 0.08, f.height, mirrored, { size: 16 });
          if (prog >= 1) {
            finished.current = true;
            onDone({
              results: capture.current!.result(),
              side: capture.current!.side,
              provider: ctx.provider.info,
              device: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                videoWidth: f.width,
                videoHeight: f.height,
                facingMode: facing,
                cameraRollDeg: rollRef.current,
                meanFps: Math.round(ctx.stats.fps),
                meanInferenceMs: Math.round(ctx.stats.inferenceMs * 10) / 10,
                displayMirrored: mirrored,
                inferenceThread: ctx.stats.thread,
              },
            });
            return;
          }
        }
      }
      if (ctx.now - lastUi.current > 150) {
        lastUi.current = ctx.now;
        setUi({ calib, progress: phaseRef.current === 'capturing' ? (ctx.now - started.current) / CAPTURE_MS : 0, frame });
      }
    },
    [facing, simulated, onDone],
  );

  const runtime = useMotionRuntime({ providerId, facing, filter: prefs.filter, onFrame });
  const instruction = ui.calib?.instruction ?? 'no_person';
  const hidden = ui.frame?.readings.filter((r) => r.withheld === 'landmarks_hidden') ?? [];

  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored={facing === 'user'} simulated={simulated}>
        {runtime.status === 'running' && (
          <div className="stage-overlay-top">
            {phase === 'capturing' ? <CuePill tone="success">{t('scan.capturing')}</CuePill> : <CuePill tone={instruction === 'ready' ? 'success' : 'attention'}>{t(`calib.${instruction}`, ui.calib?.instructionParams)}</CuePill>}
          </div>
        )}
      </StageMedia>
      <div className="stage-top">
        <button className="stage-btn" onClick={onCancel} aria-label={t('common.close')}>
          <IconClose width={20} />
        </button>
        <div className="grow">
          <div style={{ fontWeight: 700 }}>{t('desk.title')}</div>
          <div className="xs" style={{ color: '#8fb0aa' }}>
            {t('desk.view')} {simulated && <span className="badge demo">{t('common.simulated')}</span>}
          </div>
        </div>
        {!simulated && (
          <button className="stage-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera">
            <IconFlip width={20} />
          </button>
        )}
      </div>
      <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} onUseDemo={() => setProviderId('simulated')} />
      {runtime.status === 'running' && (
        <div className="stage-bottom stack">
          <div className="glass" style={{ padding: '0.75rem 1rem' }}>
            <p className="small" style={{ marginBottom: '0.5rem' }}>
              {t('desk.instruction')}
            </p>
            {ui.calib && <CalibrationChecklist checks={ui.calib.checks} compact />}
            {hidden.length > 0 && (
              <p className="xs" style={{ color: '#f5b84a', margin: '0.4rem 0 0' }} role="status">
                {hidden.map((r) => `${t(`measure.desk.${r.id}`)}: ${t('desk.why.landmarks_hidden')} (${jointList(r.missing)})`).join(' · ')}
              </p>
            )}
            {needsPermission && !simulated && (
              <button className="btn sm secondary" style={{ marginTop: '0.5rem' }} onClick={request}>
                {t('calib.enable_sensor')}
              </button>
            )}
            {phase === 'capturing' && (
              <div className="meter" style={{ marginTop: '0.6rem', background: 'rgba(255,255,255,0.1)' }}>
                <span style={{ width: `${Math.min(100, ui.progress * 100)}%`, background: 'var(--green)' }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
