import { useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent } from 'react';
import { IconMinus, IconPlus } from '../../components/icons';
import { Segmented } from '../../components/ui';
import { useT } from '../../i18n';
import { capsulePath, regionLabel, VIEW_ORDER, VIEWS, type BodyView, type Shape } from './regions';

/**
 * Symptom body map — interim 2D anatomical renderer.
 *
 * The component contract (`selected`, `onToggle`, paths) is renderer-agnostic: a WebGL/3D
 * anatomy renderer can implement the same props and reuse the same region ids.
 * One view control only: the view selector (plus swipe and ←/→ keys as alternatives).
 * `drawing` switches pointer input from region selection to drawing a radiation path.
 */

export interface MapPath {
  id: string;
  view: string;
  points: [number, number][];
  color: string;
  label: string;
}

export interface BodyMapProps {
  selected: string[];
  onToggle: (regionId: string) => void;
  readOnly?: boolean;
  initialView?: BodyView;
  compact?: boolean;
  paths?: MapPath[];
  drawing?: { color: string; onStroke: (points: [number, number][], view: BodyView) => void } | null;
  onViewChange?: (v: BodyView) => void;
}

function shapeEl(s: Shape, props: Record<string, unknown>) {
  if (s.kind === 'ellipse') return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={s.rotate ? `rotate(${s.rotate} ${s.cx} ${s.cy})` : undefined} {...props} />;
  if (s.kind === 'capsule') return <path d={capsulePath(s.x1, s.y1, s.x2, s.y2, s.r1, s.r2)} {...props} />;
  return <path d={s.d} {...props} />;
}

const pathD = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export function BodyMap({ selected, onToggle, readOnly, initialView = 'front', compact, paths = [], drawing, onViewChange }: BodyMapProps) {
  const { t } = useT();
  const [view, setViewState] = useState<BodyView>(initialView);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  // Points accumulate in a ref: pointer events can arrive faster than React re-renders.
  const strokeRef = useRef<[number, number][] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: { x: number; y: number } } | null>(null);
  const lastGestureMoved = useRef(false);
  const sel = new Set(selected);

  const setView = (v: BodyView) => {
    setViewState(v);
    onViewChange?.(v);
  };
  const rotate = (dir: 1 | -1) => {
    const i = VIEW_ORDER.indexOf(view);
    setView(VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length]);
  };

  /** Pointer position in the figure's own (untransformed) coordinates. */
  const toFigure = (e: RPointerEvent): [number, number] | null => {
    const g = gRef.current;
    const svg = svgRef.current;
    if (!g || !svg) return null;
    const m = g.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (drawing && !readOnly) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const p = toFigure(e);
      strokeRef.current = p ? [p] : null;
      setStroke(strokeRef.current);
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan };
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (drawing && strokeRef.current) {
      const p = toFigure(e);
      const pts = strokeRef.current;
      const last = pts[pts.length - 1];
      if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) > 2.5) {
        strokeRef.current = [...pts, p];
        setStroke(strokeRef.current);
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 8) d.moved = true;
    if (zoom > 1 && d.moved) setPan({ x: d.pan.x + dx / zoom, y: d.pan.y + dy / zoom });
  };
  const onPointerUp = (e: RPointerEvent) => {
    if (drawing && strokeRef.current) {
      if (strokeRef.current.length >= 3) drawing.onStroke(strokeRef.current, view);
      strokeRef.current = null;
      setStroke(null);
      return;
    }
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
  const sideLabels: Partial<Record<BodyView, [string, string]>> = {
    front: [t('body.patient_right'), t('body.patient_left')],
    back: [t('body.patient_left'), t('body.patient_right')],
  };
  const visiblePaths = paths.filter((p) => p.view === view);

  return (
    <div className="stack tight">
      <Segmented label={t('body.rotate')} options={VIEW_ORDER.map((v) => ({ id: v, label: viewLabels[v] }))} value={view} onChange={setView} />
      <div
        className={`bodymap ${drawing ? 'drawing' : ''}`}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') rotate(1);
          if (e.key === 'ArrowLeft') rotate(-1);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          strokeRef.current = null;
          setStroke(null);
        }}
        onWheel={(e) => setZoom((z) => Math.min(2.6, Math.max(1, z - e.deltaY * 0.0015)))}
        style={{ cursor: drawing ? 'crosshair' : undefined }}
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
        <svg ref={svgRef} viewBox="0 0 220 480" role="group" aria-label={`${t('body.title')} — ${viewLabels[view]}`} style={{ maxHeight: compact ? '44vh' : undefined }}>
          <defs>
            <linearGradient id="skin" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#e9efed" />
              <stop offset="1" stopColor="#d6e0dd" />
            </linearGradient>
          </defs>
          <g ref={gRef} transform={`translate(${110 + pan.x} ${240 + pan.y}) scale(${zoom}) translate(-110 -240)`}>
            <ellipse cx="110" cy="468" rx="46" ry="6" fill="#071012" opacity="0.08" />
            {regions.map((r) => {
              const on = sel.has(r.id);
              const isHover = hover === r.id && !drawing;
              return (
                <g key={r.id}>
                  {shapeEl(r.shape, {
                    className: 'region',
                    fill: on ? 'rgba(230,90,90,0.62)' : isHover ? '#cfeee9' : 'url(#skin)',
                    stroke: on ? '#b53131' : isHover ? '#0d9488' : '#aebfba',
                    strokeWidth: on ? 2.2 : 1,
                    tabIndex: readOnly || drawing ? -1 : 0,
                    role: readOnly ? 'img' : 'button',
                    'aria-pressed': readOnly ? undefined : on,
                    'aria-label': regionLabel(r.id) + (on ? ' — selected' : ''),
                    onClick: () => !readOnly && !drawing && !lastGestureMoved.current && onToggle(r.id),
                    onKeyDown: (e: KeyboardEvent) => onKey(e, r.id),
                    onPointerEnter: () => setHover(r.id),
                    onPointerLeave: () => setHover((h) => (h === r.id ? null : h)),
                    onFocus: () => setHover(r.id),
                    onBlur: () => setHover(null),
                  })}
                </g>
              );
            })}
            <g stroke="#9fb3ad" strokeWidth="0.7" fill="none" opacity="0.6" pointerEvents="none">
              {view === 'front' && <path d="M110,92 L110,206 M86,120 Q98,128 110,124 Q122,128 134,120 M96,160 L124,160 M96,178 L124,178" />}
              {view === 'back' && <path d="M110,86 L110,212 M88,108 Q96,126 104,110 M132,108 Q124,126 116,110" />}
            </g>
            {/* Radiation paths: dashed line + arrow end so the pattern never relies on colour alone. */}
            <g pointerEvents="none" fill="none" strokeLinecap="round" strokeLinejoin="round">
              {visiblePaths.map((p) => (
                <g key={p.id}>
                  <path d={pathD(p.points)} stroke="#fff" strokeWidth="5" opacity="0.8" />
                  <path d={pathD(p.points)} stroke={p.color} strokeWidth="2.6" strokeDasharray="5 3" />
                  <circle cx={p.points[p.points.length - 1][0]} cy={p.points[p.points.length - 1][1]} r="3.5" fill={p.color} />
                  <title>{p.label}</title>
                </g>
              ))}
              {stroke && <path d={pathD(stroke)} stroke={drawing?.color ?? '#7c5cd6'} strokeWidth="2.6" />}
            </g>
          </g>
        </svg>
        {hover && !drawing && (
          <div className="glass" style={{ position: 'absolute', left: '0.6rem', bottom: '0.6rem', padding: '0.4rem 0.65rem', color: '#ecfdfa', fontSize: '0.85rem', fontWeight: 600, pointerEvents: 'none' }}>
            {regionLabel(hover)}
            {!readOnly && <span style={{ color: '#8fb0aa', fontWeight: 500 }}> · {sel.has(hover) ? '✓' : '+'}</span>}
          </div>
        )}
        {!compact && (
          <div className="bodymap-controls">
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
        )}
      </div>
      {!readOnly && !drawing && (
        <details className="bodymap-list">
          <summary>{t('body.list_toggle')}</summary>
          <div className="chips" role="group" aria-label={`${t('body.list_toggle')} — ${viewLabels[view]}`}>
            {regions.map((r) => (
              <button key={r.id} type="button" className="chip" aria-pressed={sel.has(r.id)} onClick={() => onToggle(r.id)}>
                {regionLabel(r.id)}
              </button>
            ))}
          </div>
        </details>
      )}
      <p className="xs muted">{t('body.interim')}</p>
    </div>
  );
}
