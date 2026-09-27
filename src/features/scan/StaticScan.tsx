import { useCallback, useEffect, useRef, useState } from 'react';
import { captureStill, LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAlignmentFrame, drawLevelLine, drawPlumbLine, drawSkeleton, label, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime } from '../../camera/useMotionRuntime';
import { CalibrationGate, evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { FULL_BODY_LANDMARKS, LM } from '../../engine/landmarks';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import { computePostureMetrics, PostureCapture, type PostureMetricResult } from '../../engine/posture';
import type { DeviceContext } from '../../engine/provenance';
import type { Landmark, PoseProviderInfo, ViewOrientation } from '../../engine/types';
import { usePrefs } from '../../data/prefs';
import { IconClose, IconFlip, IconVolume, IconMute } from '../../components/icons';
import { ConfidenceBadge } from '../../components/ui';
import { speechLang, useT } from '../../i18n';
import { VoiceCoach } from '../../voice/voiceCoach';
import { CalibrationChecklist, CuePill, RuntimeOverlay, StageMedia } from './StageParts';

/**
 * Static posture scan: calibration → hold-still capture per standard view → per-view results.
 * No number is drawn until calibration has passed and remained stable; every metric is the
 * median of a 3-second window with its variability and confidence.
 */

export interface ScanViewResult {
  view: ViewOrientation;
  metrics: PostureMetricResult[];
  landmarks: Landmark[];
  frameWidth: number;
  frameHeight: number;
  provider: PoseProviderInfo;
  confidence: number;
  image?: string;
  device: DeviceContext;
}

const VIEWS: ViewOrientation[] = ['anterior', 'lateral_left', 'lateral_right', 'posterior'];
const CAPTURE_MS = 3000;

type Phase = 'calibrating' | 'capturing' | 'captured';

export function StaticScan({ onComplete, onCancel, storeImages }: { onComplete: (results: ScanViewResult[]) => void; onCancel: () => void; storeImages: boolean }) {
  const { t, locale } = useT();
  const prefs = usePrefs();
  const [providerId, setProviderId] = useState(prefs.poseProvider);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [viewIdx, setViewIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('calibrating');
  const [ui, setUi] = useState<{ calib: CalibrationResult | null; gate: number; capture: number }>({ calib: null, gate: 0, capture: 0 });
  const [results, setResults] = useState<ScanViewResult[]>([]);
  const [voiceOn, setVoiceOn] = useState(prefs.voice);
  const { roll, needsPermission, request } = useDeviceRoll();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;
  const phaseRef = useRef<Phase>('calibrating');
  phaseRef.current = phase;
  const gate = useRef(new CalibrationGate(1200));
  const capture = useRef<PostureCapture | null>(null);
  const captureStart = useRef(0);
  const lastLm = useRef<{ lm: Landmark[]; w: number; h: number } | null>(null);
  const lighting = useRef<LightingSample | null>(null);
  const lightingT = useRef(0);
  const sampler = useRef<LightingSampler | null>(null);
  const lastUi = useRef(0);
  const voice = useRef<VoiceCoach | null>(null);
  const view = VIEWS[viewIdx];
  const simulated = providerId === 'simulated';

  useEffect(() => {
    voice.current = new VoiceCoach(speechLang(locale));
    return () => voice.current?.stop();
  }, [locale]);
  useEffect(() => voice.current?.setMuted(!voiceOn), [voiceOn]);

  const onFrame = useCallback(
    (f: ProcessedFrame, ctx: { video: HTMLVideoElement; now: number; stats: { fps: number; inferenceMs: number }; provider: { info: PoseProviderInfo } }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (simulated) {
        const sim = ctx.provider as unknown as SimulatedPoseProvider;
        sim.scenario = { ...sim.scenario, exercise: view === 'anterior' ? 'posture_anterior' : view === 'posterior' ? 'posture_posterior' : 'posture_lateral', side: view === 'lateral_right' ? 'right' : 'left' };
      }
      if (phaseRef.current === 'captured') return;
      if (ctx.now - lightingT.current > 500) {
        lightingT.current = ctx.now;
        if (simulated) lighting.current = { meanLuma: 140, clippedFraction: 0 };
        else {
          sampler.current ??= new LightingSampler();
          const px = sampler.current.sample(ctx.video);
          lighting.current = px ? lightingFromPixels(px) : null;
        }
      }
      const calib = evaluateCalibration({
        frame: f,
        req: { landmarks: FULL_BODY_LANDMARKS, views: [view], heightRange: [0.5, 0.97], minConfidence: 0.7, maxRollDeg: 3, handsFree: view === 'anterior' || view === 'posterior' },
        lighting: lighting.current,
        cameraRollDeg: simulated ? 0 : rollRef.current,
        facing,
      });
      const g = gate.current.update(calib, ctx.now);

      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (!c2d) return;
      const mirrored = facing === 'user' && !simulated;
      drawAlignmentFrame(c2d, f.width, f.height, g.ready, g.progress);
      const lms = f.smoothed;
      if (lms) {
        drawSkeleton(c2d, lms, f.width, f.height, { mirrored, minVisibility: 0.5 });
        if (calib.frameReady) {
          // Reference geometry — only drawn once calibration holds, and numbers come straight from landmarks.
          const lateral = view.startsWith('lateral');
          const near = view === 'lateral_right' ? 'right' : 'left';
          const ankleX = lateral ? lms[near === 'left' ? LM.leftAnkle : LM.rightAnkle].x : (lms[LM.leftAnkle].x + lms[LM.rightAnkle].x) / 2;
          drawPlumbLine(c2d, ankleX, f.width, f.height);
          if (!lateral) {
            const m = computePostureMetrics(lms, f.width, f.height, view, 0.6, f.support);
            const sh = m.find((x) => x.id === 'shoulder_level');
            const pv = m.find((x) => x.id === 'pelvic_level');
            // Reference lines only for metrics that passed validation — never through hidden joints.
            if (sh) drawLevelLine(c2d, lms[LM.rightShoulder], lms[LM.leftShoulder], f.width, f.height, `${sh.value.toFixed(1)}°`, mirrored);
            if (pv) drawLevelLine(c2d, lms[LM.rightHip], lms[LM.leftHip], f.width, f.height, `${pv.value.toFixed(1)}°`, mirrored);
          }
        }
      }

      if (phaseRef.current === 'calibrating' && g.ready) {
        capture.current = new PostureCapture();
        captureStart.current = ctx.now;
        phaseRef.current = 'capturing';
        setPhase('capturing');
        voice.current?.say(t('calib.hold_still'), 'hold_still', 3, 2000);
      }
      if (phaseRef.current === 'capturing') {
        if (!calib.frameReady || !lms) {
          // Calibration lost mid-capture: discard the window rather than mixing in bad frames.
          capture.current = null;
          gate.current.reset();
          phaseRef.current = 'calibrating';
          setPhase('calibrating');
        } else {
          capture.current!.add(computePostureMetrics(lms, f.width, f.height, view, 0.6, f.support));
          lastLm.current = { lm: lms, w: f.width, h: f.height };
          const prog = (ctx.now - captureStart.current) / CAPTURE_MS;
          label(c2d, `${Math.round(prog * 100)}%`, f.width / 2, f.height * 0.08, f.height, mirrored, { size: 16 });
          if (prog >= 1) {
            // Do not save a scan containing only unstable or insufficient-confidence readings.
            const metrics = capture.current!.result().filter((m) => m.level === 'high' || m.level === 'moderate');
            if (!metrics.length) {
              capture.current = null;
              gate.current.reset();
              phaseRef.current = 'calibrating';
              setPhase('calibrating');
              setUi({ calib, gate: 0, capture: 0 });
              return;
            }
            const conf = metrics.length ? metrics.reduce((a, m) => a + m.confidence, 0) / metrics.length : 0;
            const res: ScanViewResult = {
              view,
              metrics,
              landmarks: lastLm.current.lm,
              frameWidth: lastLm.current.w,
              frameHeight: lastLm.current.h,
              provider: ctx.provider.info,
              confidence: conf,
              image: storeImages && !simulated ? captureStill(ctx.video) ?? undefined : undefined,
              device: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                videoWidth: f.width,
                videoHeight: f.height,
                facingMode: facing,
                cameraRollDeg: rollRef.current,
                meanFps: Math.round(ctx.stats.fps),
                meanInferenceMs: Math.round(ctx.stats.inferenceMs * 10) / 10,
              },
            };
            setResults((r) => [...r.filter((x) => x.view !== view), res]);
            phaseRef.current = 'captured';
            setPhase('captured');
            voice.current?.say(t('scan.captured'), 'captured', 3, 0);
          }
        }
      }

      if (ctx.now - lastUi.current > 150) {
        lastUi.current = ctx.now;
        setUi({ calib, gate: g.progress, capture: phaseRef.current === 'capturing' ? (ctx.now - captureStart.current) / CAPTURE_MS : 0 });
        if (phaseRef.current === 'calibrating' && calib.instruction !== 'ready') voice.current?.say(t(`calib.${calib.instruction}`, calib.instructionParams), calib.instruction, 2, 5000);
      }
    },
    [view, facing, simulated, storeImages, t],
  );

  const runtime = useMotionRuntime({ providerId, facing, filter: prefs.filter, onFrame });

  const current = results.find((r) => r.view === view);
  const next = () => {
    gate.current.reset();
    if (viewIdx < VIEWS.length - 1) {
      setViewIdx(viewIdx + 1);
      setPhase('calibrating');
    } else onComplete(results);
  };
  const retake = () => {
    gate.current.reset();
    setResults((r) => r.filter((x) => x.view !== view));
    setPhase('calibrating');
  };

  const instruction = ui.calib?.instruction ?? 'no_person';
  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored={facing === 'user'} simulated={simulated}>
        {phase !== 'captured' && runtime.status === 'running' && (
          <div className="stage-overlay-top">
            {phase === 'capturing' ? (
              <CuePill tone="success">{t('scan.capturing')}</CuePill>
            ) : (
              <CuePill tone={instruction === 'ready' ? 'success' : 'attention'}>{t(`calib.${instruction}`, ui.calib?.instructionParams)}</CuePill>
            )}
          </div>
        )}
      </StageMedia>
      <div className="stage-top">
        <button className="stage-btn" onClick={onCancel} aria-label={t('common.close')}>
          <IconClose width={20} />
        </button>
        <div className="grow">
          <div style={{ fontWeight: 700 }}>
            {t('scan.title')} · {t(`scan.view.${view}`)}
          </div>
          <div className="xs" style={{ color: '#8fb0aa' }}>
            {viewIdx + 1}/{VIEWS.length} {simulated && <span className="badge demo">{t('common.simulated')}</span>}
          </div>
        </div>
        <button className="stage-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)} aria-label={voiceOn ? t('mirror.voice_on') : t('mirror.voice_off')}>
          {voiceOn ? <IconVolume width={20} /> : <IconMute width={20} />}
        </button>
        {!simulated && (
          <button className="stage-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera">
            <IconFlip width={20} />
          </button>
        )}
      </div>

      <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} onUseDemo={() => setProviderId('simulated')} />

      <div className="stage-bottom stack">
        {phase !== 'captured' && runtime.status === 'running' && (
          <>
            <div className="glass" style={{ padding: '0.75rem 1rem' }}>
              <p className="small" style={{ marginBottom: '0.5rem' }}>
                {t(`scan.instruction.${view}`)}
              </p>
              {ui.calib && <CalibrationChecklist checks={ui.calib.checks} compact />}
              {needsPermission && !simulated && (
                <button className="btn sm secondary" style={{ marginTop: '0.5rem' }} onClick={request}>
                  {t('calib.enable_sensor')}
                </button>
              )}
              {phase === 'capturing' && (
                <div className="meter" style={{ marginTop: '0.6rem', background: 'rgba(255,255,255,0.1)' }}>
                  <span style={{ width: `${Math.min(100, ui.capture * 100)}%`, background: 'var(--green)' }} />
                </div>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="stage-btn" onClick={next}>
                {t('scan.skip_view')}
              </button>
            </div>
          </>
        )}
        {phase === 'captured' && current && (
          <div className="glass stack tight" style={{ padding: '1rem', maxHeight: '55vh', overflowY: 'auto' }}>
            <div className="row between">
              <strong>
                {t('scan.results')} · {t(`scan.view.${view}`)}
              </strong>
              <span className="badge camera">◎ {t('cat.camera_estimate')}</span>
            </div>
            {current.metrics.length === 0 && <p className="small">{t('progress.no_data')}</p>}
            {current.metrics.map((m) => (
              <div key={m.id} className="row between" style={{ gap: '0.5rem', padding: '0.2rem 0' }}>
                <span className="small grow">
                  {t(`posture.${m.id}`)}
                  {m.direction && <span style={{ color: '#8fb0aa' }}> · {t(`posture.dir.${m.direction}`)}</span>}
                </span>
                <span className="num" style={{ fontWeight: 750, fontSize: '1.1rem' }}>
                  {m.value.toFixed(1)}
                  {m.unit === 'deg' ? '°' : '%'}
                </span>
                <span className="xs" style={{ color: '#8fb0aa', minWidth: 48 }}>
                  ±{m.sd.toFixed(1)}
                </span>
                <ConfidenceBadge value={m.confidence} />
              </div>
            ))}
            <p className="xs" style={{ color: '#8fb0aa' }}>
              {t('scan.estimate_note')}
            </p>
            <div className="row">
              <button className="btn secondary grow" style={{ background: 'transparent', color: '#ecfdfa' }} onClick={retake}>
                {t('scan.retake')}
              </button>
              <button className="btn primary grow" onClick={next}>
                {viewIdx < VIEWS.length - 1 ? t('scan.next_view') : t('scan.finish')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
