import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareCanvas } from '../../camera/overlay';
import { drawRegionPanel, type ImageTone, type SceneLabels } from '../../camera/postureGrid';
import { usePrefs } from '../../data/prefs';
import { jointList } from '../../engine/landmarks';
import type { PostureMetricStatus } from '../../engine/posture';
import { POSTURE_REGIONS, regionBox, type PostureRegion } from '../../engine/postureGeometry';
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
function Panel({ p, region, labels, tone }: { p: BoardProps; region: PostureRegion | null; labels: SceneLabels; tone: ImageTone }) {
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
    // The stored still may be downscaled; the crop box is normalised, so it maps onto any size.
    drawRegionPanel(ctx, {
      source: img,
      sourceW: img?.naturalWidth ?? 0,
      sourceH: img?.naturalHeight ?? 0,
      lms: p.landmarks,
      view: p.view,
      statuses: p.statuses,
      box: box.value,
      region,
      width: PW,
      height: PH,
      mirrored: false,
      tone,
      labels,
    });
  }, [box, img, p, PW, PH, labels, region, tone]);
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
  const prefs = usePrefs();
  const [tone, setTone] = useState<ImageTone>(prefs.scanTone ?? 'colour');
  return (
    <div className="posture-board">
      {p.image && (
        <div className="row wrap" style={{ gap: '0.5rem', alignItems: 'center' }}>
          <div className="scan-tools">
            <div className="seg" role="group" aria-label={t('grid.tone')}>
              {(['colour', 'grey', 'negative'] as ImageTone[]).map((v) => (
                <button key={v} type="button" aria-pressed={tone === v} onClick={() => setTone(v)}>
                  {t(`grid.tone_${v}`)}
                </button>
              ))}
            </div>
          </div>
          {tone !== 'colour' && <span className="xs muted">{t(`grid.tone_note_${tone}`)}</span>}
        </div>
      )}
      <div className="posture-board-main">
        <Panel p={p} region={null} labels={labels} tone={tone} />
        <PostureHud view={p.view} statuses={p.statuses} />
      </div>
      <p className="xs muted">{t('grid.regions_note')}</p>
      <div className="posture-regions">
        {POSTURE_REGIONS.map((r) => (
          <Panel key={r} p={p} region={r} labels={labels} tone={tone} />
        ))}
      </div>
    </div>
  );
}

const VIEW_LETTER: Partial<Record<ViewOrientation, string>> = { anterior: 'A', posterior: 'P', lateral_left: 'L', lateral_right: 'R' };

/** In-camera overlays: view badge (top-left) and a compact HUD (top-right). Withheld values show "—". */
export function StageHud({ view, statuses }: { view: ViewOrientation; statuses: PostureMetricStatus[] }) {
  const { t } = useT();
  return (
    <>
      <div className="stage-view-badge" aria-hidden="true">
        <span className="letter">{VIEW_LETTER[view] ?? '?'}</span>
        <span className="name">{t(`scan.view.${view}`)}</span>
      </div>
      {statuses.length > 0 && (
        <div className="stage-hud" aria-hidden="true">
          <div className="stage-hud-title">{t('grid.hud_short_title')}</div>
          {statuses.map((s) => (
            <div key={s.id} className={`row-item ${s.state}`}>
              <span>{t(`posture.short.${s.id}`)}</span>
              <b className="num">{s.state === 'measured' ? formatMetric(s) : '—'}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
