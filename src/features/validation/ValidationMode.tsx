import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAngleArc, drawSkeleton, OVERLAY_COLORS, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { IconClose } from '../../components/icons';
import { Segmented } from '../../components/ui';
import { usePrefs } from '../../data/prefs';
import { uuid } from '../../data/store';
import { evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { ExerciseRunner, type RunnerSnapshot } from '../../engine/exerciseRunner';
import { defaultPrescription, EXERCISE_LIST, getDefinition } from '../../engine/exercises/definitions';
import { requiredView, type ExerciseId } from '../../engine/exercises/types';
import type { FilterKind } from '../../engine/filters';
import { LANDMARK_NAMES } from '../../engine/landmarks';
import { estimate3d, MEASUREMENTS } from '../../engine/measurements';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { PoseProviderId } from '../../engine/pose/provider';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import type { Side } from '../../engine/types';
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

  useEffect(() => {
    runner.current = new ExerciseRunner(defaultPrescription(exercise, side), filter);
    hist.current = { raw: [], filt: [] };
  }, [exercise, side, filter]);

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
        req: { landmarks: MEASUREMENTS[def.primary].landmarks(side), views: requiredView(def, side), heightRange: def.position === 'supine' ? [0.05, 0.98] : [0.45, 0.98], minConfidence: 0.65, maxRollDeg: 4 },
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
      }
    },
    [exercise, side, simulated, includeLm],
  );

  const runtime = useMotionRuntime({ providerId, facing: 'user', filter, onFrame });

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
            <Segmented<PoseProviderId> label="Provider" value={providerId} onChange={setProviderId} options={[{ id: 'mediapipe-lite', label: 'Lite' }, { id: 'mediapipe-full', label: 'Full' }, { id: 'simulated', label: 'Sim' }]} />
            <Segmented<ExerciseId> label="Exercise" value={exercise} onChange={setExercise} options={EXERCISE_LIST.map((d) => ({ id: d.id, label: d.id.replace(/_/g, ' ') }))} />
            <Segmented<Side> label="Side" value={side} onChange={setSide} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
            <Segmented<FilterKind> label="Filter" value={filter} onChange={setFilter} options={[{ id: 'one_euro', label: '1€' }, { id: 'ema', label: 'EMA' }, { id: 'kalman', label: 'Kalman' }, { id: 'none', label: 'Raw' }]} />
          </div>
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
          </div>
          <p style={{ color: '#8fb0aa', marginTop: '0.5rem' }}>Orange = raw landmarks, cyan = filtered. Exports contain no patient identifiers or images.</p>
        </aside>
      )}
    </div>
  );
}

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
