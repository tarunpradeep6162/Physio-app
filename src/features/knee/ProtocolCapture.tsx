import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LightingSampler } from '../../camera/camera';
import { useDeviceRoll } from '../../camera/deviceRoll';
import { drawAlignmentFrame, drawSkeleton, label, prepareCanvas } from '../../camera/overlay';
import { useMotionRuntime, type FrameContext } from '../../camera/useMotionRuntime';
import { IconClose, IconMute, IconVolume } from '../../components/icons';
import { Notice } from '../../components/ui';
import type { CaptureSession } from '../../data/models';
import { usePrefs } from '../../data/prefs';
import { CalibrationGate, evaluateCalibration, lightingFromPixels, type CalibrationResult, type LightingSample } from '../../engine/calibration';
import { pauseKey } from '../../engine/feedback';
import type { ProcessedFrame } from '../../engine/pipeline';
import type { SimulatedPoseProvider } from '../../engine/pose/simulated';
import { getProtocol } from '../../engine/protocols/knee';
import { captureConfig, compareConfig, ProtocolRecorder } from '../../engine/protocols/recorder';
import type { CaptureConfig, ConditionMatch, ProtocolResult } from '../../engine/protocols/types';
import type { DeviceContext } from '../../engine/provenance';
import type { PoseProviderInfo, Side } from '../../engine/types';
import { speechLang, useT } from '../../i18n';
import { VoiceCoach } from '../../voice/voiceCoach';
import { CalibrationChecklist, CuePill, RuntimeOverlay, StageMedia } from '../scan/StageParts';
import { Replay } from './Replay';

/**
 * Protocol capture workspace (dark camera screen): setup & calibration (with the baseline
 * alignment guide at reassessment) → countdown → recording with live quality feedback → review
 * with verdict, replay and recapture. Nothing is saved until the patient/clinician saves.
 */

export interface CaptureOutcome {
  result: ProtocolResult;
  config: CaptureConfig | null;
  conditionMatch?: ConditionMatch;
  setupNotes?: string;
  provider: PoseProviderInfo;
  device: DeviceContext;
}

type Phase = 'setup' | 'countdown' | 'recording' | 'review';

const PHASE_TEXT: Record<string, string> = {
  waiting: 'Get into the start position and hold still',
  rest: 'Ready — begin',
  moving: 'Moving…',
  engaged: 'Target position reached',
  returning: 'Returning…',
  paused: 'Measurement paused',
};

export function ProtocolCapture({ protocolId, side, baseline, onSave, onCancel }: { protocolId: string; side: Side | null; baseline?: CaptureSession; onSave: (o: CaptureOutcome) => void; onCancel: () => void }) {
  const { t, locale } = useT();
  const prefs = usePrefs();
  const def = getProtocol(protocolId);
  const [providerId, setProviderId] = useState(prefs.poseProvider);
  const simulated = providerId === 'simulated';
  const [phase, setPhase] = useState<Phase>('setup');
  const [countdown, setCountdown] = useState(3);
  const [calib, setCalib] = useState<CalibrationResult | null>(null);
  const [match, setMatch] = useState<ConditionMatch | null>(null);
  const [live, setLive] = useState<ProtocolRecorder['state'] | null>(null);
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [voiceOn, setVoiceOn] = useState(prefs.voice);
  const [attempt, setAttempt] = useState(0);
  const { roll } = useDeviceRoll();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>('setup');
  phaseRef.current = phase;
  const recorder = useRef<ProtocolRecorder | null>(null);
  const gate = useRef(new CalibrationGate(1500));
  const lighting = useRef<LightingSample | null>(null);
  const lightT = useRef(0);
  const sampler = useRef<LightingSampler | null>(null);
  const lastUi = useRef(0);
  const rollRef = useRef<number | null>(null);
  rollRef.current = roll;
  const config = useRef<CaptureConfig | null>(null);
  const ctxInfo = useRef<{ provider: PoseProviderInfo; device: DeviceContext } | null>(null);
  const voice = useRef<VoiceCoach | null>(null);
  const simRef = useRef<SimulatedPoseProvider | null>(null);
  const focus = useMemo(() => def.requiredLandmarks(side), [def, side]);
  const views = useMemo(() => def.views(side), [def, side]);
  const baseCfg = baseline?.config ?? null;
  const baseGhost = baseline?.result.keyframes.find((k) => k.label === 'start')?.filtered ?? null;

  useEffect(() => {
    const v = new VoiceCoach(speechLang(locale));
    voice.current = v;
    return () => v.stop();
  }, [locale]);
  useEffect(() => voice.current?.setMuted(!voiceOn), [voiceOn]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      recorder.current = new ProtocolRecorder(def, side);
      config.current = null;
      simRef.current?.startProtocol();
      setPhase('recording');
      voice.current?.say(def.cueStart, 'cue_start', 4, 0);
      return;
    }
    voice.current?.say(t(`cue.count.${countdown}`), `cd${countdown}`, 4, 0);
    const id = setTimeout(() => setCountdown((c) => c - 1), 900);
    return () => clearTimeout(id);
  }, [phase, countdown, def, side, t]);

  const finish = useCallback(() => {
    const r = recorder.current;
    if (!r || phaseRef.current !== 'recording') return;
    const result = r.finish(performance.now());
    const cfg = config.current;
    const o: CaptureOutcome = {
      result,
      config: cfg,
      conditionMatch: baseCfg && cfg ? compareConfig(baseCfg, cfg) : undefined,
      provider: ctxInfo.current?.provider ?? { id: providerId, model: 'unknown', version: 'unknown', simulated },
      device: ctxInfo.current?.device ?? { userAgent: navigator.userAgent, platform: navigator.platform, videoWidth: 0, videoHeight: 0, facingMode: 'user', cameraRollDeg: null, meanFps: null, meanInferenceMs: null },
    };
    setOutcome(o);
    setPhase('review');
    voice.current?.say(result.quality.verdict === 'valid' ? 'Capture complete' : 'Capture did not pass the quality check', 'done', 5, 0);
  }, [baseCfg, providerId, simulated]);

  const onFrame = useCallback(
    (f: ProcessedFrame, ctx: FrameContext) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (simulated) {
        const sim = ctx.provider as SimulatedPoseProvider;
        simRef.current = sim;
        sim.scenario = { ...sim.scenario, exercise: def.id, side: side ?? 'left' };
      }
      ctxInfo.current = {
        provider: ctx.provider.info,
        device: { userAgent: navigator.userAgent, platform: navigator.platform, videoWidth: f.width, videoHeight: f.height, facingMode: 'user', cameraRollDeg: rollRef.current, meanFps: Math.round(ctx.stats.fps), meanInferenceMs: Math.round(ctx.stats.inferenceMs * 10) / 10 },
      };
      const c2d = prepareCanvas(canvas, f.width, f.height);
      if (!c2d) return;
      const mirrored = !simulated;
      const p = phaseRef.current;
      if (p === 'review') return;

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
          req: { landmarks: focus, views, heightRange: def.position === 'supine' ? [0.45, 0.98] : [0.4, 0.98], extentAxis: def.position === 'supine' ? 'horizontal' : 'vertical', minConfidence: 0.65, maxRollDeg: 4 },
          lighting: lighting.current,
          cameraRollDeg: simulated ? 0 : rollRef.current,
          facing: 'user',
        });
        const g = gate.current.update(c, ctx.now);
        // Baseline alignment guide: ghost skeleton + body box from the baseline capture.
        if (baseGhost) drawSkeleton(c2d, baseGhost, f.width, f.height, { mirrored, color: 'rgba(124,92,214,0.55)', thin: true, jointRadius: 2, minVisibility: 0 });
        if (baseCfg) {
          const h = baseCfg.bodyHeightFrac * f.height;
          c2d.save();
          c2d.setLineDash([10, 8]);
          c2d.strokeStyle = 'rgba(167,139,250,0.9)';
          c2d.lineWidth = Math.max(2, f.height / 400);
          c2d.strokeRect(baseCfg.bodyCenterX * f.width - h * 0.3, baseCfg.bodyCenterY * f.height - h / 2, h * 0.6, h);
          c2d.restore();
          label(c2d, 'Baseline position', baseCfg.bodyCenterX * f.width, baseCfg.bodyCenterY * f.height - h / 2 - 18, f.height, mirrored, { size: 12, color: '#e9e3ff' });
        } else if (def.position !== 'supine') drawAlignmentFrame(c2d, f.width, f.height, g.ready, g.progress);
        if (f.smoothed) drawSkeleton(c2d, f.smoothed, f.width, f.height, { mirrored, focus, state: c.frameReady ? 'target' : 'tracked' });
        if (p === 'setup' && g.ready) {
          setCountdown(3);
          setPhase('countdown');
          config.current = captureConfig(f, 'user', rollRef.current);
        }
        if (ctx.now - lastUi.current > 200) {
          lastUi.current = ctx.now;
          setCalib(c);
          const cfg = captureConfig(f, 'user', rollRef.current);
          if (baseCfg && cfg) setMatch(compareConfig(baseCfg, cfg));
          if (p === 'setup' && c.instruction !== 'ready') voice.current?.say(t(`calib.${c.instruction}`), c.instruction, 2, 5000);
        }
        return;
      }

      // Recording
      const r = recorder.current!;
      if (!config.current) config.current = captureConfig(f, 'user', rollRef.current);
      const events = r.update(f, ctx.now, ctx.stats.fps);
      for (const e of events) {
        if (e.type === 'complete') voice.current?.say(`${r.state.validCycles}`, `rep${r.state.validCycles}`, 4, 0);
        if (e.type === 'incomplete') voice.current?.say('That one did not count', 'incomplete', 3, 2500);
        if (e.type === 'paused') voice.current?.say(t('cue.paused_reposition'), 'paused', 5, 5000);
      }
      if (f.smoothed) drawSkeleton(c2d, f.smoothed, f.width, f.height, { mirrored, focus, state: r.state.value === null ? 'low' : r.state.phase === 'engaged' ? 'target' : 'tracked' });
      if (ctx.now - lastUi.current > 100) {
        lastUi.current = ctx.now;
        setLive({ ...r.state });
      }
      if (r.state.complete) finish();
    },
    [simulated, def, side, focus, views, baseCfg, baseGhost, t, finish],
  );

  const runtime = useMotionRuntime({ providerId, facing: 'user', filter: prefs.filter, onFrame, enabled: phase !== 'review', onInterrupted: () => phaseRef.current === 'recording' && finish() });

  const recapture = () => {
    setOutcome(null);
    setLive(null);
    gate.current.reset();
    setPhase('setup');
    setAttempt((a) => a + 1);
  };

  const unit = def.signalUnit === 'deg' ? '°' : '%';
  const title = `${def.title}${side && def.sided ? ` — ${side}` : ''}`;

  return (
    <div className="stage" key={attempt}>
      {phase !== 'review' && (
        <StageMedia videoRef={runtime.videoRef} canvasRef={canvasRef} mirrored simulated={simulated}>
          {phase === 'recording' && live && (
            <div className="stage-overlay-top">
              <CuePill tone={live.value === null ? 'warning' : live.phase === 'engaged' ? 'success' : 'info'}>{live.value === null ? t(pauseKey(live.reason)) : PHASE_TEXT[live.phase] ?? def.cueStart}</CuePill>
            </div>
          )}
        </StageMedia>
      )}
      <div className="stage-top">
        <button className="stage-btn" onClick={onCancel} aria-label={t('common.close')}>
          <IconClose width={20} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div className="xs" style={{ color: '#8fb0aa' }}>
            Protocol v{def.version} {baseline && '· reassessment (baseline guide on)'} {simulated && <span className="badge demo">{t('common.simulated')}</span>}
          </div>
        </div>
        <button className="stage-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)} aria-label={voiceOn ? t('mirror.voice_on') : t('mirror.voice_off')}>
          {voiceOn ? <IconVolume width={20} /> : <IconMute width={20} />}
        </button>
      </div>

      {phase !== 'review' && <RuntimeOverlay status={runtime.status} error={runtime.error} onRetry={runtime.retry} onUseDemo={() => setProviderId('simulated')} />}

      {phase === 'countdown' && (
        <div className="stage-center" aria-live="assertive">
          <span className="num" style={{ fontSize: '7rem', fontWeight: 800 }}>
            {Math.max(1, countdown)}
          </span>
        </div>
      )}

      <div className="stage-bottom stack tight" style={phase === 'review' ? { maxHeight: 'none', flex: 1 } : undefined}>
        {phase === 'setup' && runtime.status === 'running' && (
          <div className="glass stack tight" style={{ padding: '1rem' }}>
            <ol className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {def.setup.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div style={{ textAlign: 'center' }}>
              <CuePill tone={calib?.instruction === 'ready' ? 'success' : 'attention'}>{t(`calib.${calib?.instruction ?? 'no_person'}`)}</CuePill>
            </div>
            {calib && <CalibrationChecklist checks={calib.checks} compact />}
            {match && (
              <div className="small" aria-live="polite">
                <strong>Match with baseline setup: {Math.round(match.score * 100)}%</strong>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                  {match.checks.map((c) => (
                    <li key={c.id}>
                      {c.match ? '✓' : '✗'} {c.label}: baseline {c.baseline}, now {c.current}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {def.id === 'knee_sit_to_stand' && (
              <label className="field">
                <span style={{ color: '#bfd9d4' }}>Chair seat height (cm) and footwear</span>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 45 cm, trainers" style={{ background: 'rgba(255,255,255,0.08)', color: '#ecfdfa' }} />
              </label>
            )}
            <button className="btn primary block" disabled={!calib?.frameReady} onClick={() => setPhase('countdown')}>
              I am in position — start
            </button>
          </div>
        )}

        {phase === 'recording' && live && (
          <div className="glass" style={{ padding: '0.85rem 1rem' }}>
            <div className="hud">
              <div className="hud-cell grow">
                <div className="hud-label">{def.signalLabel}</div>
                <div className="hud-value hud-hero num">
                  {live.value === null ? '—' : Math.round(live.value)}
                  <small>{unit}</small>
                </div>
                <div className="estimate-tag">◎ camera-estimated</div>
              </div>
              <div className="hud-cell">
                <div className="hud-label">Valid reps</div>
                <div className="hud-value num">
                  {live.validCycles}
                  <small>/{def.targetCycles}</small>
                </div>
              </div>
              <div className="hud-cell">
                <div className="hud-label">Time</div>
                <div className="hud-value num">
                  {live.elapsedSec.toFixed(0)}
                  <small>s</small>
                </div>
              </div>
            </div>
            <button className="btn secondary block" style={{ marginTop: '0.6rem', background: 'transparent', color: '#ecfdfa' }} onClick={finish}>
              Stop recording
            </button>
          </div>
        )}

        {phase === 'review' && outcome && (
          <div className="glass stack tight" style={{ padding: '1rem', color: '#ecfdfa' }}>
            <div className="row between wrap">
              <strong>{outcome.result.quality.verdict === 'valid' ? '✓ Capture passed quality checks' : '✗ Capture did not pass quality checks'}</strong>
              <span className="xs" style={{ color: '#8fb0aa' }}>
                coverage {Math.round(outcome.result.quality.coverage * 100)}% · {outcome.result.quality.validCycles} valid / {outcome.result.quality.attemptedCycles} attempts
              </span>
            </div>
            {outcome.result.quality.verdict === 'invalid' && (
              <Notice tone="warn">
                {outcome.result.quality.reasons.join('. ')}. No measurement from this capture will be reported — please recapture.
              </Notice>
            )}
            <div className="stack tight">
              {outcome.result.metrics.map((m) => (
                <div key={m.id} className="row between small">
                  <span>{m.label}</span>
                  <strong className="num">{m.validity === 'valid' && m.value !== null ? `${m.value}${m.unit === 'deg' ? '°' : m.unit === 's' ? ' s' : m.unit === 'pct_leg' ? '%' : ''}` : 'not reported'}</strong>
                </div>
              ))}
            </div>
            {outcome.conditionMatch && <span className="xs">Setup match with baseline: {Math.round(outcome.conditionMatch.score * 100)}%</span>}
            <div style={{ background: '#f5f8f7', color: 'var(--ink)', borderRadius: 12, padding: '0.5rem' }}>
              <Replay result={outcome.result} focus={focus} height={180} label={def.signalLabel} unit={unit} />
            </div>
            <div className="row">
              <button className="btn secondary grow" style={{ background: 'transparent', color: '#ecfdfa' }} onClick={recapture}>
                Recapture
              </button>
              <button className="btn primary grow" onClick={() => onSave({ ...outcome, setupNotes: notes || undefined })}>
                Save capture
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
