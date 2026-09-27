import type { ReactNode, RefObject } from 'react';
import type { CameraErrorCode } from '../../camera/camera';
import type { RuntimeStatus } from '../../camera/useMotionRuntime';
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

const ORDER: CalibrationCheck['id'][] = ['person', 'single_person', 'framing', 'distance', 'centering', 'orientation', 'camera_level', 'lighting', 'confidence'];

export function CalibrationChecklist({ checks, compact }: { checks: CalibrationCheck[]; compact?: boolean }) {
  const { t } = useT();
  const byId = new Map(checks.map((c) => [c.id, c]));
  const shown = ORDER.filter((id) => byId.has(id)).filter((id) => !compact || ['person', 'framing', 'orientation', 'camera_level', 'lighting'].includes(id));
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
