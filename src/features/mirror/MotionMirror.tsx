import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAlignmentFrame, drawAngleArc, drawSkeleton, prepareCanvas, type OverlayState } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { IconCC, IconClose, IconMute, IconPause, IconPlay, IconVolume } from '../../components/icons';
import { usePrefs } from '../../data/prefs';
import { CalibrationGate, evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { ExerciseRunner, type ExerciseResult, type RunnerSnapshot } from '../../engine/exerciseRunner';
import { getDefinition } from '../../engine/exercises/definitions';
import { requiredView, type ExercisePrescription } from '../../engine/exercises/types';
import { FeedbackEngine, type Cue } from '../../engine/feedback';
import { MEASUREMENTS } from '../../engine/measurements';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import type { DeviceContext } from '../../engine/provenance';
import type { PoseProviderInfo } from '../../engine/types';
import { speechLang, useT } from '../../i18n';
import { vibrate, VoiceCoach } from '../../voice/voiceCoach';
import { CalibrationChecklist, CuePill, RuntimeOverlay, StageMedia } from '../scan/StageParts';

/**
 * AI Motion Mirror — immersive guided exercise.
 *
 * The camera fills the screen; the overlay shows only what matters for THIS exercise: current
 * camera-estimated angle, the clinician's target, rep count and hold timer, plus one short cue.
 * The prescription is executed exactly as approved — the engine never alters targets.
 */

export interface MirrorOutcome {
  result: ExerciseResult;
  provider: PoseProviderInfo;
  device: DeviceContext;
  filter: string;
}

type Phase = 'setup' | 'countdown' | 'active' | 'done';

export function MotionMirror({
  rx,
  mode = 'train',
  onDone,
  onCancel,
}: {
  rx: ExercisePrescription;
  mode?: 'train' | 'test';
  onDone: (o: MirrorOutcome) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useT();
  const prefs = usePrefs();
  const def = getDefinition(rx.definitionId, rx.definitionVersion);
  const [providerId, setProviderId] = useState(prefs.poseProvider);
  const simulated = providerId === 'simulated';
  const [phase, setPhase] = useState<Phase>('setup');
  const [countdown, setCountdown] = useState(3);
  const [snap, setSnap] = useState<RunnerSnapshot | null>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [voiceOn, setVoiceOn] = useState(prefs.voice);
  const [captionsOn, setCaptionsOn] = useState(prefs.captions);
  const [caption, setCaption] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const { roll } = useDeviceRoll();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>('setup');
  phaseRef.current = phase;
  const runner = useRef(new ExerciseRunner(rx, prefs.filter));
  const feedback = useRef(new FeedbackEngine(def));
  const voice = useRef<VoiceCoach | null>(null);
  const gate = useRef(new CalibrationGate(1500));
  const lighting = useRef<LightingSample | null>(null);
  const lightT = useRef(0);
  const sampler = useRef<LightingSampler | null>(null);
  const lastUi = useRef(0);
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;
  const lastCtx = useRef<{ provider: PoseProviderInfo; device: DeviceContext } | null>(null);
  const finished = useRef(false);

  const views = useMemo(() => requiredView(def, rx.side), [def, rx.side]);
  const focus = useMemo(() => MEASUREMENTS[def.primary].landmarks(rx.side), [def.primary, rx.side]);
  const reqLandmarks = useMemo(() => {
    const extra = def.formRules.flatMap((r) => MEASUREMENTS[r.measurement].landmarks(r.on === 'same' ? rx.side : rx.side === 'left' ? 'right' : 'left'));
    return [...new Set([...focus, ...extra])];
  }, [def, focus, rx.side]);

  useEffect(() => {
    const v = new VoiceCoach(speechLang(locale));
    v.onCaption = (text) => setCaption(text);
    voice.current = v;
    return () => v.stop();
  }, [locale]);
  useEffect(() => voice.current?.setMuted(!voiceOn), [voiceOn]);
  useEffect(() => {
    if (!caption) return;
    const id = setTimeout(() => setCaption(null), 2600);
    return () => clearTimeout(id);
  }, [caption]);

  const finish = useCallback(
    (endedEarly: boolean) => {
      if (finished.current) return;
      finished.current = true;
      setPhase('done');
      const ctx = lastCtx.current;
      onDone({
        result: runner.current.result(endedEarly),
        provider: ctx?.provider ?? { id: providerId, model: 'unknown', version: 'unknown', simulated },
        device: ctx?.device ?? { userAgent: navigator.userAgent, platform: navigator.platform, videoWidth: 0, videoHeight: 0, facingMode: 'user', cameraRollDeg: null, meanFps: null, meanInferenceMs: null },
        filter: prefs.filter,
      });
    },
    [onDone, prefs.filter, providerId, simulated],
  );

  // Countdown 3-2-1 before the active phase.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      setPhase('active');
      return;
    }
    voice.current?.say(t(`cue.count.${countdown}`), `cd${countdown}`, 4, 0);
    const id = setTimeout(() => setCountdown((c) => c - 1), 900);
    return () => clearTimeout(id);
  }, [phase, countdown, t]);

  const onFrame = useCallback(
    (f: ProcessedFrame, ctx: FrameContext) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (simulated) {
        const sim = ctx.provider as SimulatedPoseProvider;
        sim.scenario = { exercise: def.id, side: rx.side, peak: rx.target.min + 8, holdSeconds: rx.holdSeconds };
      }
      lastCtx.current = {
        provider: ctx.provider.info,
        device: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          videoWidth: f.width,
          videoHeight: f.height,
          facingMode: 'user',
          cameraRollDeg: rollRef.current,
          meanFps: Math.round(ctx.stats.fps),
          meanInferenceMs: Math.round(ctx.stats.inferenceMs * 10) / 10,
        },
      };
      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (!c2d) return;
      const mirrored = !simulated;
      const p = phaseRef.current;

      if (p === 'setup' || p === 'countdown') {
        if (ctx.now - lightT.current > 500) {
          lightT.current = ctx.now;
          if (simulated) lighting.current = { meanLuma: 140, clippedFraction: 0 };
          else {
            sampler.current ??= new LightingSampler();
            const px = sampler.current.sample(ctx.video);
            lighting.current = px ? lightingFromPixels(px) : null;
          }
        }
        const c = evaluateCalibration({
          frame: f,
          req: { landmarks: reqLandmarks, views, heightRange: [0.45, 0.98], extentAxis: def.position === 'supine' ? 'horizontal' : 'vertical', minConfidence: 0.65, maxRollDeg: 4 },
          lighting: lighting.current,
          cameraRollDeg: simulated ? 0 : rollRef.current,
          facing: 'user',
        });
        const g = gate.current.update(c, ctx.now);
        if (def.position !== 'supine') drawAlignmentFrame(c2d, f.width, f.height, g.ready, g.progress);
        if (f.smoothed) drawSkeleton(c2d, f.smoothed, f.width, f.height, { mirrored, focus, state: c.frameReady ? 'target' : 'tracked' });
        if (p === 'setup' && g.ready) {
          setCountdown(3);
          setPhase('countdown');
        }
        if (ctx.now - lastUi.current > 150) {
          lastUi.current = ctx.now;
          setCalib(c);
          if (p === 'setup' && c.instruction !== 'ready') voice.current?.say(t(`calib.${c.instruction}`), c.instruction, 2, 5000);
        }
        return;
      }
      if (p !== 'active') return;

      const r = runner.current;
      const events = r.update(f, ctx.now);
      const s = r.snapshot;
      const fb = feedback.current.handle(events, s, ctx.now);
      if (fb.speech.length) voice.current?.cues(fb.speech, t);
      if (prefs.haptics && events.some((e) => e.type === 'rep_complete')) vibrate(60);

      // Overlay
      if (f.smoothed) {
        const val = s.estimate.value;
        let state: OverlayState = 'tracked';
        if (val === null) state = 'low';
        else if (s.activeFormCue || val > rx.target.max + def.thresholds.overTolerance) state = 'attention';
        else if (val >= rx.target.min) state = 'target';
        drawSkeleton(c2d, f.smoothed, f.width, f.height, { mirrored, focus, state, minVisibility: 0.5 });
        const [a, b, c] = def.primary === 'hip_flexion_slr' ? [focus[0], focus[1], focus[2]] : focus;
        if (val !== null) drawAngleArc(c2d, f.smoothed[a], f.smoothed[b], f.smoothed[c], f.width, f.height, `${Math.round(val)}°`, mirrored, state);
      }
      if (ctx.now - lastUi.current > 66) {
        lastUi.current = ctx.now;
        setSnap(s);
        setCue(fb.display);
      }
      const testDone = mode === 'test' && s.attempts >= 3 && s.state === 'ready';
      if (s.phase === 'complete' || testDone) finish(false);
    },
    [simulated, def, rx, views, focus, reqLandmarks, t, prefs.haptics, mode, finish],
  );

  const runtime = useMotionRuntime({
    providerId,
    facing: 'user',
    filter: prefs.filter,
    onFrame,
    enabled: phase !== 'done',
    onInterrupted: () => setPaused(true),
  });

  const togglePause = () => {
    const p = !paused;
    setPaused(p);
    runtime.setPaused(p);
    voice.current?.stop();
  };
  useEffect(() => {
    runtime.setPaused(paused);
  }, [paused, runtime.setPaused]);

  const rangeMax = Math.max(rx.target.max + 30, 120);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / rangeMax) * 100))}%`;
  const cur = snap?.estimate.value ?? null;

  return (
    <div className="stage">
      <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored simulated={simulated}>
        {/* Cue: one short instruction at the top of the camera area, never over the measured joint. */}
        {runtime.status === 'running' && phase === 'active' && cue && !paused && (
          <div className="stage-overlay-top">
            <CuePill tone={cue.tone}>{t(cue.key, cue.params)}</CuePill>
          </div>
        )}
        {captionsOn && caption && (
          <div className="stage-overlay-bottom" aria-hidden="true">
            <span className="caption">{caption}</span>
          </div>
        )}
      </StageMedia>
      <div className="stage-top">
        <button className="stage-btn" onClick={() => (phase === 'active' ? finish(true) : onCancel())} aria-label={t('mirror.end')}>
          <IconClose width={20} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(def.nameKey)}</div>
          <div className="xs" style={{ color: '#8fb0aa' }}>
            {rx.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')} · {t('mirror.set')} {snap?.set ?? 1}/{rx.sets}
            {simulated && (
              <>
                {' '}
                <span className="badge demo">{t('common.simulated')}</span>
              </>
            )}
          </div>
        </div>
        <button className="stage-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)} aria-label={voiceOn ? t('mirror.voice_on') : t('mirror.voice_off')}>
          {voiceOn ? <IconVolume width={20} /> : <IconMute width={20} />}
        </button>
        <button className="stage-btn" aria-pressed={captionsOn} onClick={() => setCaptionsOn((v) => !v)} aria-label={t('mirror.captions')}>
          <IconCC width={20} />
        </button>
        {phase === 'active' && (
          <button className="stage-btn" onClick={togglePause} aria-label={paused ? t('mirror.resume') : t('mirror.pause')}>
            {paused ? <IconPlay width={20} /> : <IconPause width={20} />}
          </button>
        )}
      </div>

      <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} onUseDemo={() => setProviderId('simulated')} />

      {paused && (
        <div className="stage-center" style={{ background: 'rgba(7,16,18,0.7)' }}>
          <div className="stack" style={{ alignItems: 'center' }}>
            <strong style={{ fontSize: '1.6rem' }}>{t('mirror.paused_overlay')}</strong>
            <button className="btn primary lg" onClick={togglePause}>
              <IconPlay width={20} /> {t('mirror.resume')}
            </button>
          </div>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="stage-center" aria-live="assertive">
          <span className="num" style={{ fontSize: '7rem', fontWeight: 800, textShadow: '0 4px 30px rgba(0,0,0,0.5)' }}>
            {Math.max(1, countdown)}
          </span>
        </div>
      )}

      <div className="stage-bottom stack tight">
        {phase === 'setup' && runtime.status === 'running' && (
          <div className="glass stack tight" style={{ padding: '1rem' }}>
            <strong>{t('mirror.setup_title')}</strong>
            <ol className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {def.setupKeys.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ol>
            <div style={{ textAlign: 'center' }}>
              <CuePill tone={calib?.instruction === 'ready' ? 'success' : 'attention'}>{t(`calib.${calib?.instruction ?? 'no_person'}`)}</CuePill>
            </div>
            {calib && <CalibrationChecklist checks={calib.checks} compact />}
            <button
              className="btn primary block"
              disabled={!calib?.frameReady}
              onClick={() => {
                setCountdown(3);
                setPhase('countdown');
              }}
            >
              {t('mirror.ready_start')}
            </button>
          </div>
        )}

        {phase === 'active' && snap && (
          <div className="glass" style={{ padding: '0.85rem 1rem' }}>
            {snap.phase === 'rest' ? (
              <div className="row between">
                <div>
                  <div className="hud-label">{t('cue.rest', { s: '' }).replace('·', '').trim()}</div>
                  <div className="hud-value hud-hero num">
                    {snap.restRemaining}
                    <small> s</small>
                  </div>
                </div>
                <button className="btn primary" onClick={() => runner.current.skipRest(performance.now())}>
                  {t('mirror.skip_rest')}
                </button>
              </div>
            ) : (
              <>
                <div className="hud">
                  <div className="hud-cell grow">
                    <div className="hud-label">{t('mirror.current')}</div>
                    <div className="hud-value hud-hero num" aria-live="off">
                      {cur === null ? '—' : Math.round(cur)}
                      <small>°</small>
                    </div>
                    <div className="estimate-tag">◎ {t('mirror.estimate_label')}</div>
                  </div>
                  <div className="hud-cell">
                    <div className="hud-label">{t('mirror.rep')}</div>
                    <div className="hud-value num">
                      {String(snap.repsCounted).padStart(2, '0')}
                      <small>/{rx.reps}</small>
                    </div>
                  </div>
                  {rx.holdSeconds > 0 && (
                    <div className="hud-cell">
                      <div className="hud-label">{t('mirror.hold')}</div>
                      <HoldRing value={snap.state === 'hold' ? snap.holdElapsed : snap.state === 'returning' ? rx.holdSeconds : 0} total={rx.holdSeconds} />
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '0.7rem' }}>
                  <div className="rom-bar" role="meter" aria-valuemin={0} aria-valuemax={rangeMax} aria-valuenow={cur ?? undefined} aria-label={t('mirror.current')}>
                    <div className="band" style={{ left: pct(rx.target.min), width: `calc(${pct(rx.target.max)} - ${pct(rx.target.min)})` }} />
                    {cur !== null && <div className="marker" style={{ left: pct(cur) }} />}
                  </div>
                  <div className="rom-labels">
                    <span>0°</span>
                    <span>
                      {t('mirror.target')} <strong>{rx.target.min}–{rx.target.max}°</strong>
                    </span>
                    <span>{rangeMax}°</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {runtime.stats.slow && <p className="xs" style={{ color: '#f5c46b', textAlign: 'center' }}>{t('camerr.slow', { fps: Math.round(runtime.stats.fps) })}</p>}
      </div>
    </div>
  );
}

function HoldRing({ value, total }: { value: number; total: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, value / Math.max(0.001, total));
  return (
    <div style={{ position: 'relative', width: 50, height: 50 }}>
      <svg width="50" height="50" viewBox="0 0 50 50" aria-hidden="true">
        <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(236,253,250,0.15)" strokeWidth="5" />
        <circle
          className="hold-ring"
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke={frac >= 1 ? '#31C48D' : '#22D3C5'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 25 25)"
        />
      </svg>
      <span className="num" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 750, fontSize: '0.85rem' }}>
        {Math.min(value, total).toFixed(1)}
      </span>
      <span className="sr-only">
        {Math.min(value, total).toFixed(1)} / {total} s
      </span>
    </div>
  );
}
