import { useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent } from 'react';
import { IconMinus, IconPlus, IconRotate } from '../../components/icons';
import { Segmented } from '../../components/ui';
import { useT } from '../../i18n';
import { capsulePath, regionLabel, VIEW_ORDER, VIEWS, type BodyView, type Shape } from './regions';

/**
 * Pain body map — interim 2D anatomical renderer.
 *
 * The component contract (`selected`, `onToggle`, view state) is renderer-agnostic: a WebGL/3D
 * anatomy renderer can implement the same props and reuse the same region ids, so assessment
 * data stays compatible when the 3D asset is introduced. Rotation here moves between the four
 * standard clinical views (drag horizontally or press Rotate); zoom scales the figure.
 */

export interface BodyMapProps {
  selected: string[];
  onToggle: (regionId: string) => void;
  readOnly?: boolean;
  initialView?: BodyView;
  compact?: boolean;
}

function shapeEl(s: Shape, props: Record<string, unknown>) {
  if (s.kind === 'ellipse') return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={s.rotate ? `rotate(${s.rotate} ${s.cx} ${s.cy})` : undefined} {...props} />;
  if (s.kind === 'capsule') return <path d={capsulePath(s.x1, s.y1, s.x2, s.y2, s.r1, s.r2)} {...props} />;
  return <path d={s.d} {...props} />;
}

export function BodyMap({ selected, onToggle, readOnly, initialView = 'front', compact }: BodyMapProps) {
  const { t } = useT();
  const [view, setView] = useState<BodyView>(initialView);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: { x: number; y: number } } | null>(null);
  // Remembers whether the last pointer gesture was a drag, so it does not also toggle a region.
  const lastGestureMoved = useRef(false);
  const sel = new Set(selected);

  const rotate = (dir: 1 | -1) => {
    const i = VIEW_ORDER.indexOf(view);
    setView(VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length]);
  };

  const onPointerDown = (e: RPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 8) d.moved = true;
    if (zoom > 1 && d.moved) setPan({ x: d.pan.x + dx / zoom, y: d.pan.y + dy / zoom });
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    lastGestureMoved.current = !!d?.moved;
    if (!d || zoom > 1) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 50) rotate(dx < 0 ? 1 : -1);
  };

  const onKey = (e: KeyboardEvent, id: string) => {
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(id);
    }
  };

  const regions = VIEWS[view];
  const viewLabels: Record<BodyView, string> = { front: t('body.view.front'), back: t('body.view.back'), left: t('body.view.left'), right: t('body.view.right') };
  // Patient-perspective side labels, so nobody has to mentally mirror the figure.
  const sideLabels: Partial<Record<BodyView, [string, string]>> = {
    front: [t('body.patient_right'), t('body.patient_left')],
    back: [t('body.patient_left'), t('body.patient_right')],
  };

  return (
    <div className="stack tight">
      <div className="row between wrap">
        <Segmented label={t('body.rotate')} options={VIEW_ORDER.map((v) => ({ id: v, label: viewLabels[v] }))} value={view} onChange={setView} />
      </div>
      <div
        className="bodymap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => setZoom((z) => Math.min(2.6, Math.max(1, z - e.deltaY * 0.0015)))}
      >
        {sideLabels[view] && (
          <>
            <span className="bodymap-side-label" style={{ left: '0.75rem' }}>
              ← {sideLabels[view]![0]}
            </span>
            <span className="bodymap-side-label" style={{ right: '0.75rem' }}>
              {sideLabels[view]![1]} →
            </span>
          </>
        )}
        <svg viewBox="0 0 220 480" role="group" aria-label={`${t('body.title')} — ${viewLabels[view]}`} style={{ maxHeight: compact ? '44vh' : undefined }}>
          <defs>
            <linearGradient id="skin" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#e9efed" />
              <stop offset="1" stopColor="#d6e0dd" />
            </linearGradient>
          </defs>
          <g transform={`translate(${110 + pan.x} ${240 + pan.y}) scale(${zoom}) translate(-110 -240)`}>
            <ellipse cx="110" cy="468" rx="46" ry="6" fill="#071012" opacity="0.08" />
            {regions.map((r) => {
              const on = sel.has(r.id);
              const isHover = hover === r.id;
              return (
                <g key={r.id}>
                  {shapeEl(r.shape, {
                    className: 'region',
                    fill: on ? 'rgba(230,90,90,0.62)' : isHover ? '#cfeee9' : 'url(#skin)',
                    stroke: on ? '#b53131' : isHover ? '#0d9488' : '#aebfba',
                    strokeWidth: on ? 2.2 : 1,
                    tabIndex: readOnly ? -1 : 0,
                    role: readOnly ? 'img' : 'button',
                    'aria-pressed': readOnly ? undefined : on,
                    'aria-label': regionLabel(r.id) + (on ? ` — ${t('common.done')}` : ''),
                    onClick: () => !readOnly && !lastGestureMoved.current && onToggle(r.id),
                    onKeyDown: (e: KeyboardEvent) => onKey(e, r.id),
                    onPointerEnter: () => setHover(r.id),
                    onPointerLeave: () => setHover((h) => (h === r.id ? null : h)),
                    onFocus: () => setHover(r.id),
                    onBlur: () => setHover(null),
                  })}
                </g>
              );
            })}
            {/* Subtle anatomical contour lines (non-interactive). */}
            <g stroke="#9fb3ad" strokeWidth="0.7" fill="none" opacity="0.6" pointerEvents="none">
              {view === 'front' && <path d="M110,92 L110,206 M86,120 Q98,128 110,124 Q122,128 134,120 M96,160 L124,160 M96,178 L124,178" />}
              {view === 'back' && <path d="M110,86 L110,212 M88,108 Q96,126 104,110 M132,108 Q124,126 116,110" />}
            </g>
          </g>
        </svg>
        {hover && (
          <div className="glass" style={{ position: 'absolute', left: '0.6rem', bottom: '0.6rem', padding: '0.4rem 0.65rem', color: '#ecfdfa', fontSize: '0.85rem', fontWeight: 600 }}>
            {regionLabel(hover)}
            {!readOnly && <span style={{ color: '#8fb0aa', fontWeight: 500 }}> · {sel.has(hover) ? '✓' : '+'}</span>}
          </div>
        )}
        <div className="bodymap-controls">
          <button type="button" className="icon-btn" onClick={() => rotate(1)} aria-label={t('body.rotate')} title={t('body.rotate')}>
            <IconRotate width={20} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.min(2.6, z + 0.4))} aria-label={t('body.zoom_in')}>
            <IconPlus width={20} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setZoom((z) => Math.max(1, z - 0.4));
              if (zoom <= 1.4) setPan({ x: 0, y: 0 });
            }}
            aria-label={t('body.zoom_out')}
          >
            <IconMinus width={20} />
          </button>
        </div>
      </div>
      <p className="xs muted">{t('body.interim')}</p>
    </div>
  );
}
