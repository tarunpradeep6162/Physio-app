import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { CameraErrorCode } from '../../camera/camera';
import type { RuntimeStatus } from '../../camera/useMotionRuntime';
import { jointLabel } from '../../engine/landmarks';
import type { JointState } from '../../engine/measurements';
import type { CalibrationCheck } from '../../engine/calibration';
import { useT } from '../../i18n';

/** Shared building blocks for every full-screen camera experience. */

/**
 * Camera + overlay canvas. Only the inner layer is mirrored (front camera) so that `children`
 * (cue pills, captions) render normally on top.
 */
export function StageMedia({ videoRef, canvasRef, mirrored, simulated, children }: { videoRef: RefObject<HTMLVideoElement | null>; canvasRef: RefObject<HTMLCanvasElement | null>; mirrored: boolean; simulated: boolean; children?: ReactNode }) {
  return (
    <div className="stage-media">
      <div className={`stage-media-inner ${mirrored && !simulated ? 'mirrored' : ''}`}>
        <video ref={videoRef} playsInline muted aria-hidden="true" style={{ display: simulated ? 'none' : undefined }} />
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}

export function RuntimeOverlay({ status, error, onRetry, onUseDemo }: { status: RuntimeStatus; error: CameraErrorCode | 'model' | null; onRetry: () => void; onUseDemo?: () => void }) {
  const { t } = useT();
  if (status === 'running' || status === 'paused' || status === 'idle') return null;
  if (status === 'error' && error) {
    return (
      <div className="stage-center">
        <div className="glass stack" style={{ padding: '1.25rem', maxWidth: 420 }} role="alert">
          <strong style={{ fontSize: '1.1rem' }}>{t(error === 'model' ? 'camerr.model' : `camerr.${error}`)}</strong>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={onRetry}>
              {t('camerr.retry')}
            </button>
            {onUseDemo && (
              <button className="btn secondary" style={{ background: 'transparent', color: '#ecfdfa' }} onClick={onUseDemo}>
                {t('camerr.use_demo')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="stage-center" role="status">
      <div className="stack tight" style={{ alignItems: 'center' }}>
        <div className="spinner" />
        <span>{t(status === 'starting_camera' ? 'calib.starting_camera' : 'calib.loading_model')}</span>
      </div>
    </div>
  );
}

const ORDER: CalibrationCheck['id'][] = ['person', 'single_person', 'stable', 'framing', 'distance', 'centering', 'orientation', 'hands_clear', 'camera_level', 'lighting', 'confidence'];

export function CalibrationChecklist({ checks, compact }: { checks: CalibrationCheck[]; compact?: boolean }) {
  const { t } = useT();
  const byId = new Map(checks.map((c) => [c.id, c]));
  // Compact: the key checks plus ANY failing check (an occluded joint must never be hidden from view).
  const shown = ORDER.filter((id) => byId.has(id)).filter((id) => !compact || ['person', 'framing', 'orientation', 'camera_level', 'lighting'].includes(id) || byId.get(id)!.status === 'fail');
  return (
    <div className="checklist">
      <ul>
        {shown.map((id) => {
          const c = byId.get(id)!;
          return (
            <li key={id}>
              <span className={`check-icon ${c.status}`} aria-hidden="true">
                {c.status === 'pass' ? '✓' : c.status === 'fail' ? '!' : '?'}
              </span>
              <span>
                {t(`calib.check.${id}`)}
                <span className="sr-only">: {c.status}</span>
                {id === 'camera_level' && c.status === 'unknown' && <span style={{ color: '#8fb0aa' }}> — {t('calib.level_unknown')}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CuePill({ tone, children, live = true }: { tone: 'info' | 'success' | 'attention' | 'warning'; children: ReactNode; live?: boolean }) {
  const icon = tone === 'success' ? '✓' : tone === 'warning' ? '⏸' : tone === 'attention' ? '!' : '›';
  return (
    <div className={`cue ${tone}`} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <span className="cue-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

const JOINT_STATE_TEXT: Record<JointState, string> = { ok: 'visible', out_of_frame: 'out of frame', not_on_body: 'covered', occluded: 'hidden', no_person: 'not found' };

/** Required joints, each with its live status (never colour alone: icon + text). */
export function JointStatusBar({ joints }: { joints: { index: number; state: JointState }[] }) {
  if (!joints.length) return null;
  return (
    <ul className="joint-status" aria-label="Required joints">
      {joints.map((j) => (
        <li key={j.index} className={`joint-chip ${j.state === 'ok' ? 'ok' : 'bad'}`}>
          <span aria-hidden="true">{j.state === 'ok' ? '✓' : '✕'}</span> {jointLabel(j.index)}
          {j.state !== 'ok' && <span className="joint-chip-state"> · {JOINT_STATE_TEXT[j.state]}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Holds an instruction on screen for at least `minMs` before another replaces it, so the text never
 * flickers at a threshold. A pause/warning is shown IMMEDIATELY (safety first).
 */
export function useStableCue<T extends { key: string; tone: string; text?: string }>(cue: T | null, minMs = 700): T | null {
  const [shown, setShown] = useState<T | null>(cue);
  const since = useRef(0);
  const latest = useRef(cue);
  latest.current = cue;
  const sig = cue ? `${cue.key}|${cue.tone}|${cue.text ?? ''}` : null;
  const shownSig = shown ? `${shown.key}|${shown.tone}|${shown.text ?? ''}` : null;
  useEffect(() => {
    if (sig === null || sig === shownSig) return;
    const next = latest.current!;
    const now = performance.now();
    const sameKey = shown && next.key === shown.key;
    if (!shown || sameKey || next.tone === 'warning' || now - since.current >= minMs) {
      if (!sameKey) since.current = now;
      setShown(next);
      return;
    }
    const id = setTimeout(() => {
      since.current = performance.now();
      setShown(latest.current);
    }, minMs - (now - since.current));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, shownSig, minMs]);
  return shown;
}
