import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareCanvas } from '../../camera/overlay';
import { drawPostureScene, type SceneLabels } from '../../camera/postureGrid';
import { jointList } from '../../engine/landmarks';
import type { PostureMetricStatus } from '../../engine/posture';
import { plumbX, POSTURE_REGIONS, regionBox, type PostureRegion } from '../../engine/postureGeometry';
import type { Landmark, ViewOrientation } from '../../engine/types';
import { ConfidenceBadge } from '../../components/ui';
import { useT } from '../../i18n';

/**
 * Clinical posture grid views. The HUD lists every metric of the view: the number when it was
 * measured, otherwise the reason it was withheld. The board redraws one captured view on the grid
 * with zoomed panels of body regions — crops of that single camera image, not separate cameras.
 */

type Measured = Extract<PostureMetricStatus, { state: 'measured' }>;

export function formatMetric(m: Measured): string {
  return m.unit === 'deg' ? `${m.value.toFixed(1)}°` : `${m.value.toFixed(1)}%`;
}

export function useSceneLabels(): SceneLabels {
  const { t } = useT();
  return useMemo(
    () => ({ plumb: t('grid.plumb'), head: t('grid.level_head'), shoulders: t('grid.level_shoulders'), pelvis: t('grid.level_pelvis'), format: formatMetric }),
    [t],
  );
}

export function PostureHud({ view, statuses, live }: { view: ViewOrientation; statuses: PostureMetricStatus[]; live?: boolean }) {
  const { t } = useT();
  return (
    <section className="posture-hud" aria-label={t('grid.hud_title')}>
      <div className="posture-hud-head">
        <strong>{t('grid.hud_title')}</strong>
        <span>{t(`scan.view.${view}`)} · {live ? t('grid.live') : t('grid.captured')}</span>
      </div>
      <ul>
        {statuses.map((s) => (
          <li key={s.id} className={s.state === 'measured' ? 'measured' : 'withheld'}>
            <span className="name">{t(`posture.${s.id}`)}</span>
            {s.state === 'measured' ? (
              <span className="val">
                <b className="num">{formatMetric(s)}</b>
                {s.direction && <small>{t(`posture.dir.${s.direction}`)}</small>}
                {!live && (
                  <small className="row" style={{ gap: '0.35rem', justifyContent: 'flex-end' }}>
                    {s.sd !== undefined && <span>±{s.sd.toFixed(1)}</span>}
                    <ConfidenceBadge value={s.confidence} />
                  </small>
                )}
              </span>
            ) : (
              <span className="why">
                <b>—</b>
                <small>{t(`grid.withheld.${s.reason}`, { joints: jointList(s.missing) })}</small>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="posture-hud-note">
        {t('grid.legend')} {t('grid.hud_note')}
      </p>
    </section>
  );
}

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

interface BoardProps {
  view: ViewOrientation;
  landmarks: Landmark[];
  frameWidth: number;
  frameHeight: number;
  image?: string;
  statuses: PostureMetricStatus[];
}

/** One panel: the full frame, or a region crop re-mapped into the panel. */
function Panel({ p, region, labels }: { p: BoardProps; region: PostureRegion | null; labels: SceneLabels }) {
  const { t } = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useImage(p.image);
  const PW = region ? 480 : Math.round((p.frameWidth / p.frameHeight) * 720);
  const PH = region ? 360 : 720;
  const box = useMemo(
    () => (region ? regionBox(p.landmarks, region, p.view, p.frameWidth, p.frameHeight, PW / PH) : ({ ok: true, value: { x: 0, y: 0, w: 1, h: 1 } } as const)),
    [p.landmarks, region, p.view, p.frameWidth, p.frameHeight, PW, PH],
  );
  useEffect(() => {
    const c = ref.current;
    if (!c || !box.ok) return;
    const ctx = prepareCanvas(c, PW, PH);
    if (!ctx) return;
    const b = box.value;
    ctx.fillStyle = '#0b1a1f';
    ctx.fillRect(0, 0, PW, PH);
    if (img) {
      // The stored still may be downscaled; the crop box is normalised, so it maps onto any size.
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, b.x * iw, b.y * ih, b.w * iw, b.h * ih, 0, 0, PW, PH);
      ctx.globalAlpha = 1;
    }
    const remap = p.landmarks.map((l) => ({ ...l, x: (l.x - b.x) / b.w, y: (l.y - b.y) / b.h }));
    const full = plumbX(p.landmarks, p.view);
    drawPostureScene(ctx, {
      lms: remap,
      width: PW,
      height: PH,
      view: p.view,
      statuses: p.statuses,
      mirrored: false,
      ruler: region === null || region === 'full_body',
      plumbOverride: full.ok ? (full.value - b.x) / b.w : null,
      plumbLabel: region === null,
      labels,
    });
  }, [box, img, p, PW, PH, labels, region]);
  const title = region ? t(`grid.region.${region}`) : t(`scan.view.${p.view}`);
  return (
    <figure className={`posture-panel ${region ? 'region' : 'main'}`}>
      {box.ok ? (
        <canvas ref={ref} role="img" aria-label={`${title} — ${t('grid.panel_alt')}`} />
      ) : (
        <div className="posture-panel-empty" style={{ aspectRatio: `${PW} / ${PH}` }}>
          <span>{t('grid.region_withheld', { joints: jointList(box.missing) })}</span>
        </div>
      )}
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export function PostureBoard(p: BoardProps) {
  const { t } = useT();
  const labels = useSceneLabels();
  return (
    <div className="posture-board">
      <div className="posture-board-main">
        <Panel p={p} region={null} labels={labels} />
        <PostureHud view={p.view} statuses={p.statuses} />
      </div>
      <p className="xs muted">{t('grid.regions_note')}</p>
      <div className="posture-regions">
        {POSTURE_REGIONS.map((r) => (
          <Panel key={r} p={p} region={r} labels={labels} />
        ))}
      </div>
    </div>
  );
}
