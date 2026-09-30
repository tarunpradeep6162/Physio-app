import { useCallback, useEffect, useRef, useState } from 'react';
import { captureStill, LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAlignmentFrame, drawSkeleton, label, prepareCanvas } from '../../camera/overlay';
import { drawFaceCover, drawGrid, drawPostureScene, drawRegionPanel, drawReportedArea, type ImageTone } from '../../camera/postureGrid';
import { POSTURE_REGIONS, regionBox, reportedAreaBox, zoomToBox } from '../../engine/postureGeometry';
import { useMotionRuntime } from '../../camera/useMotionRuntime';
import { CalibrationGate, evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample, type CalibrationMemory } from '../../engine/calibration';
import { FULL_BODY_LANDMARKS, jointList } from '../../engine/landmarks';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import { capturedStatuses, computePostureMetrics, gateStatuses, PostureCapture, postureMetricStatus, type PostureMetricResult, type PostureMetricStatus } from '../../engine/posture';
import type { DeviceContext } from '../../engine/provenance';
import type { Landmark, PoseProviderInfo, ViewOrientation } from '../../engine/types';
import { setPrefs, usePrefs } from '../../data/prefs';
import { IconClose, IconFlip, IconVolume, IconMute } from '../../components/icons';
import { speechLang, useT } from '../../i18n';
import { VoiceCoach } from '../../voice/voiceCoach';
import { PostureBoard, PostureHud, StageHud, useSceneLabels } from './PostureGrid';
import { CalibrationChecklist, CuePill, RuntimeOverlay, StageMedia } from './StageParts';

/**
 * Static posture scan: calibration → hold-still capture per standard view → per-view results,
 * shown on the clinical posture grid. No number is drawn until calibration has passed and remained
 * stable; every saved metric is the median of a 3-second window with its variability and
 * confidence. Two modes: self-scan (captures automatically once the checks hold, voice coaching)
 * and therapist-guided (rear camera, the therapist taps Capture — still only once the checks pass).
 */

export type ScanMode = 'self' | 'therapist';

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

export interface ReportedArea {
  /** Body-map region id the patient marked (e.g. "neck_side_left"). */
  id: string;
  label: string;
}

type Layout = 'single' | 'regions';
const ZOOMS = [1, 1.5, 2.2] as const;

export function StaticScan({ onComplete, onCancel, storeImages, defaultMode = 'self', reported = [] }: { onComplete: (results: ScanViewResult[]) => void; onCancel: () => void; storeImages: boolean; defaultMode?: ScanMode; reported?: ReportedArea[] }) {
  const { t, locale } = useT();
  const prefs = usePrefs();
  const labels = useSceneLabels();
  const [providerId, setProviderId] = useState(prefs.poseProvider);
  const [mode, setModeState] = useState<ScanMode>(defaultMode);
  const [facing, setFacing] = useState<'user' | 'environment'>(defaultMode === 'therapist' ? 'environment' : 'user');
  const [viewIdx, setViewIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('calibrating');
  const [ui, setUi] = useState<{ calib: CalibrationResult | null; gate: number; capture: number; ready: boolean; statuses: PostureMetricStatus[] }>({ calib: null, gate: 0, capture: 0, ready: false, statuses: [] });
  const [results, setResults] = useState<ScanViewResult[]>([]);
  const [voiceOn, setVoiceOn] = useState(defaultMode === 'therapist' ? false : prefs.voice);
  const modeRef = useRef<ScanMode>(mode);
  modeRef.current = mode;
  const manualStart = useRef(false);
  // Display tools: zoom (display only), region layout, monochrome, face cover (privacy).
  const [zoom, setZoom] = useState<{ scale: number; fx: number; fy: number; pain?: boolean } | null>(null);
  const [layout, setLayout] = useState<Layout>('single');
  const [tone, setToneState] = useState<ImageTone>(prefs.scanTone ?? 'colour');
  const setTone = (v: ImageTone) => {
    setToneState(v);
    setPrefs({ scanTone: v });
  };
  const [coverFace, setCoverFace] = useState(false);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const display = useRef({ layout, tone, coverFace });
  display.current = { layout, tone, coverFace };
  const regionCanvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const latestLms = useRef<{ lm: Landmark[]; w: number; h: number; support?: number[] | null } | null>(null);
  const reportedRef = useRef(reported);
  reportedRef.current = reported;
  const { roll, needsPermission, request } = useDeviceRoll();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;
  const phaseRef = useRef<Phase>('calibrating');
  phaseRef.current = phase;
  const gate = useRef(new CalibrationGate(1200));
  const calibMemory = useRef<CalibrationMemory>({});
  const capture = useRef<PostureCapture | null>(null);
  const captureStart = useRef(0);
  const lastLm = useRef<{ lm: Landmark[]; w: number; h: number } | null>(null);
  const lighting = useRef<LightingSample | null>(null);
  const lightingT = useRef(0);
  const sampler = useRef<LightingSampler | null>(null);
  const lastUi = useRef(0);
  const latestStatuses = useRef<PostureMetricStatus[]>([]);
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
        memory: calibMemory.current,
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
      // Every metric of this view: measured, or withheld with the reason. Numbers stay hidden until
      // the setup checks pass; reference lines are drawn only through visible, validated joints.
      const statuses = lms ? gateStatuses(postureMetricStatus(lms, f.width, f.height, view, 0.6, f.support), calib.frameReady) : [];
      latestStatuses.current = statuses;
      if (lms) latestLms.current = { lm: lms, w: f.width, h: f.height, support: f.support };
      const { layout: lay, tone: tn, coverFace: cover } = display.current;
      // Privacy: the face cover sits on the overlay canvas above the video (and on the region crops).
      if (lms && cover && !simulated) drawFaceCover(c2d, lms, f.width, f.height);
      if (lms && calib.frameReady) {
        drawPostureScene(c2d, { lms, width: f.width, height: f.height, view, statuses, mirrored, support: f.support, labels });
      } else {
        drawGrid(c2d, f.width, f.height);
        if (lms) drawSkeleton(c2d, lms, f.width, f.height, { mirrored, minVisibility: 0.5 });
      }
      // Outline the area the PATIENT marked on the pain map — a patient report, not a finding.
      if (lms) {
        for (const area of reportedRef.current) {
          const b = reportedAreaBox(lms, area.id, f.width, f.height, undefined, f.support);
          if (b.ok) drawReportedArea(c2d, b.value, f.width, f.height, mirrored, `${t('grid.reported')}: ${area.label}`);
        }
      }
      // Region layout: four live zoomed crops of this one camera frame.
      if (lay === 'regions' && lms) {
        POSTURE_REGIONS.forEach((r, i) => {
          const rc = regionCanvases.current[i];
          if (!rc) return;
          const rctx = prepareCanvas(rc, 480, 360);
          if (!rctx) return;
          const b = regionBox(lms, r, view, f.width, f.height, 480 / 360, f.support);
          if (!b.ok) {
            rctx.fillStyle = '#0b1a1f';
            rctx.fillRect(0, 0, 480, 360);
            // Short enough for a small panel: two joints, then a count.
            const joints = b.missing.length > 2 ? `${jointList(b.missing.slice(0, 2))} +${b.missing.length - 2}` : jointList(b.missing);
            label(rctx, t('grid.region_not_in_view'), 240, 165, 360, mirrored, { size: 13 });
            label(rctx, joints, 240, 195, 360, mirrored, { size: 10, color: '#8fb0aa' });
            return;
          }
          drawRegionPanel(rctx, { source: simulated ? null : ctx.video, sourceW: ctx.video.videoWidth, sourceH: ctx.video.videoHeight, lms, view, statuses, box: b.value, region: r, width: 480, height: 360, mirrored, tone: tn, coverFace: cover, support: f.support, labels });
        });
      }

      // Self-scan starts on its own; therapist-guided waits for the Capture tap (which needs the same checks).
      if (phaseRef.current === 'calibrating' && g.ready && (modeRef.current === 'self' || manualStart.current)) {
        manualStart.current = false;
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
          label(c2d, `${Math.min(100, Math.round(prog * 100))}%`, f.width / 2, f.height * 0.08, f.height, mirrored, { size: 16 });
          if (prog >= 1) {
            // Do not save a scan containing only unstable or insufficient-confidence readings.
            const metrics = capture.current!.result().filter((m) => m.level === 'high' || m.level === 'moderate');
            if (!metrics.length) {
              capture.current = null;
              gate.current.reset();
              phaseRef.current = 'calibrating';
              setPhase('calibrating');
              setUi({ calib, gate: 0, capture: 0, ready: false, statuses: latestStatuses.current });
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
              image: storeImages && !simulated ? captureStill(ctx.video, 360, cover ? (c, w, h) => drawFaceCover(c, lms, w, h) : undefined) ?? undefined : undefined,
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
        setUi({ calib, gate: g.progress, capture: phaseRef.current === 'capturing' ? (ctx.now - captureStart.current) / CAPTURE_MS : 0, ready: g.ready, statuses: latestStatuses.current });
        if (phaseRef.current === 'calibrating' && calib.instruction !== 'ready') voice.current?.say(t(`calib.${calib.instruction}`, calib.instructionParams), calib.instruction, 2, 5000);
      }
    },
    [view, facing, simulated, storeImages, t, labels],
  );

  const runtime = useMotionRuntime({ providerId, facing, filter: prefs.filter, onFrame });

  const current = results.find((r) => r.view === view);
  const goTo = (i: number) => {
    gate.current.reset();
    calibMemory.current = {};
    manualStart.current = false;
    setViewIdx(i);
    setPhase(results.some((r) => r.view === VIEWS[i]) ? 'captured' : 'calibrating');
  };
  const next = () => {
    gate.current.reset();
    calibMemory.current = {};
    manualStart.current = false;
    if (viewIdx < VIEWS.length - 1) {
      setViewIdx(viewIdx + 1);
      setPhase('calibrating');
    } else onComplete(results);
  };
  const retake = () => {
    gate.current.reset();
    calibMemory.current = {};
    manualStart.current = false;
    setResults((r) => r.filter((x) => x.view !== view));
    setPhase('calibrating');
  };
  const setMode = (m: ScanMode) => {
    setModeState(m);
    manualStart.current = false;
    if (!simulated) setFacing(m === 'therapist' ? 'environment' : 'user');
    if (m === 'therapist') setVoiceOn(false);
  };
  const zoomToPain = () => {
    const l = latestLms.current;
    const target = reported[0];
    if (!l || !target) return;
    // Same aspect as the displayed frame, so the zoom factor fits the marked area on screen.
    const b = reportedAreaBox(l.lm, target.id, l.w, l.h, l.w / l.h, l.support);
    if (!b.ok) {
      setToolMsg(t('grid.zoom_pain_unavailable', { joints: jointList(b.missing) }));
      return;
    }
    setToolMsg(null);
    setZoom({ ...zoomToBox(b.value), pain: true });
  };
  const frameSize = latestLms.current ? { frameW: latestLms.current.w, frameH: latestLms.current.h } : { frameW: 0, frameH: 0 };
  const currentStatuses = current ? capturedStatuses(view, current.metrics, current.landmarks, current.frameWidth, current.frameHeight) : [];

  const instruction = ui.calib?.instruction ?? 'no_person';
  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored={facing === 'user'} simulated={simulated} tone={tone} zoom={zoom && layout === 'single' ? { ...zoom, ...frameSize } : null}>
        {phase !== 'captured' && runtime.status === 'running' && layout === 'single' && <StageHud view={view} statuses={ui.statuses} />}
        {tone !== 'colour' && layout === 'single' && <div className="stage-mono-note">{t(`grid.tone_note_${tone}`)}</div>}
        {layout === 'regions' && phase !== 'captured' && (
          <div className="stage-regions" aria-label={t('grid.layout_regions')}>
            {POSTURE_REGIONS.map((r, i) => (
              <figure key={r}>
                <canvas
                  ref={(el) => {
                    regionCanvases.current[i] = el;
                  }}
                  className={facing === 'user' && !simulated ? 'mirrored' : ''}
                  aria-hidden="true"
                />
                <figcaption>{t(`grid.region.${r}`)}</figcaption>
              </figure>
            ))}
          </div>
        )}
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
        <div className="row between wrap" style={{ gap: '0.5rem' }}>
          <div className="scan-mode" role="group" aria-label={t('grid.mode_label')}>
            {(['therapist', 'self'] as ScanMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`grid.mode_${m}`)}
              </button>
            ))}
          </div>
          <nav className="scan-views" aria-label={t('grid.views_label')}>
            {VIEWS.map((v, i) => (
              <button key={v} type="button" aria-current={i === viewIdx ? 'step' : undefined} onClick={() => goTo(i)}>
                {t(`scan.view.${v}`)}
                {results.some((r) => r.view === v) && <span className="done" aria-label={t('scan.captured')}>✓</span>}
              </button>
            ))}
          </nav>
        </div>
        {phase !== 'captured' && runtime.status === 'running' && (
          <div className="scan-tools" role="toolbar" aria-label={t('grid.tools_label')}>
            <div className="seg" role="group" aria-label={t('grid.zoom')}>
              {ZOOMS.map((z) => (
                <button key={z} type="button" aria-pressed={(zoom?.scale ?? 1) === z && !zoom?.pain} disabled={layout !== 'single'} onClick={() => setZoom(z === 1 ? null : { scale: z, fx: 0.5, fy: 0.5 })}>
                  {z}×
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={!!zoom?.pain} disabled={!reported.length || layout !== 'single'} onClick={zoomToPain} title={reported.length ? undefined : t('grid.zoom_pain_none')}>
              {t('grid.zoom_pain')}
            </button>
            <button type="button" aria-pressed={layout === 'regions'} onClick={() => setLayout((l) => (l === 'regions' ? 'single' : 'regions'))}>
              {t('grid.layout_regions')}
            </button>
            <div className="seg" role="group" aria-label={t('grid.tone')}>
              {(['colour', 'grey', 'negative'] as ImageTone[]).map((v) => (
                <button key={v} type="button" aria-pressed={tone === v} onClick={() => setTone(v)}>
                  {t(`grid.tone_${v}`)}
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={coverFace} onClick={() => setCoverFace((v) => !v)}>
              {t('grid.cover_face')}
            </button>
            {toolMsg && (
              <span className="small" role="status" style={{ color: '#f5b84a' }}>
                {toolMsg}
              </span>
            )}
          </div>
        )}
        {phase !== 'captured' && runtime.status === 'running' && (
          <>
            <div className="glass" style={{ padding: '0.75rem 1rem' }}>
              <p className="small" style={{ marginBottom: '0.5rem' }}>
                {mode === 'therapist' ? t('grid.mode_therapist_hint') : t(`scan.instruction.${view}`)}
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
            {ui.statuses.length > 0 && <PostureHud view={view} statuses={ui.statuses} live />}
            <div className="row" style={{ justifyContent: 'center', gap: '0.5rem' }}>
              {mode === 'therapist' && phase === 'calibrating' && (
                <button
                  className="btn primary"
                  disabled={!ui.ready}
                  onClick={() => {
                    manualStart.current = true;
                  }}
                >
                  {ui.ready ? t('grid.capture') : t('grid.capture_locked')}
                </button>
              )}
              <button className="stage-btn" onClick={next}>
                {t('scan.skip_view')}
              </button>
            </div>
          </>
        )}
        {phase === 'captured' && current && (
          <div className="glass stack tight" style={{ padding: '0.75rem' }}>
            <div className="row between">
              <strong>
                {t('scan.results')} · {t(`scan.view.${view}`)}
              </strong>
              <span className="badge camera">◎ {t('cat.camera_estimate')}</span>
            </div>
            <PostureBoard view={view} landmarks={current.landmarks} frameWidth={current.frameWidth} frameHeight={current.frameHeight} image={current.image} statuses={currentStatuses} />
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
