import { lazy, Suspense, useId, useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent } from 'react';
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
const BodyMap3D = lazy(() => import('./BodyMap3D'));

export function BodyMap({ selected, onToggle, readOnly, initialView = 'front', compact, paths = [], drawing, onViewChange }: BodyMapProps) {
  const { t } = useT();
  const artId = useId().replace(/:/g, '');
  const [view, setViewState] = useState<BodyView>(initialView);
  const [mode, setMode] = useState<'3d' | '2d'>(readOnly ? '2d' : '3d');
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
      {!drawing && <div className="bodymap-mode" role="group" aria-label="Anatomy display">
        <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D body</button>
        <button type="button" aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>2D map</button>
      </div>}
      {mode === '3d' && !drawing ? <Suspense fallback={<div className="bodymap-3d-loading" role="status">Loading 3D anatomy…</div>}>
        <BodyMap3D selected={selected} onToggle={onToggle} onUnavailable={() => setMode('2d')} readOnly={readOnly} compact={compact} initialView={initialView} />
      </Suspense> : <>
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
            <linearGradient id={`${artId}-tissue`} x1="0" x2="1" y1="0.15" y2="0.8">
              <stop offset="0" stopColor="#7f3831" />
              <stop offset="0.22" stopColor="#b86858" />
              <stop offset="0.48" stopColor="#d99076" />
              <stop offset="0.7" stopColor="#a95448" />
              <stop offset="1" stopColor="#6c322f" />
            </linearGradient>
            <linearGradient id={`${artId}-bone`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f3dec9" />
              <stop offset="0.5" stopColor="#e1c6af" />
              <stop offset="1" stopColor="#aa8177" />
            </linearGradient>
            <filter id={`${artId}-volume`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodColor="#3b2220" floodOpacity="0.24" />
            </filter>
          </defs>
          <g ref={gRef} transform={`translate(${110 + pan.x} ${240 + pan.y}) scale(${zoom}) translate(-110 -240)`}>
            <ellipse cx="110" cy="467" rx="43" ry="5" fill="#172e2d" opacity="0.13" />
            {regions.map((r) => {
              const on = sel.has(r.id);
              const isHover = hover === r.id && !drawing;
              return (
                <g key={r.id}>
                  {shapeEl(r.shape, {
                    className: 'region',
                    fill: on ? '#eaa48c' : isHover ? '#dda78c' : r.id.startsWith('head') || r.id.startsWith('hand') || r.id.startsWith('foot') ? `url(#${artId}-bone)` : `url(#${artId}-tissue)`,
                    stroke: on ? '#b43d43' : isHover ? '#087f79' : '#78423b',
                    strokeWidth: on ? 2.1 : isHover ? 1.6 : 0.65,
                    filter: `url(#${artId}-volume)`,
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
            <g stroke="#f0c4ab" strokeWidth="1" fill="none" opacity="0.8" pointerEvents="none" strokeLinecap="round">
              {view === 'front' && <>
                <path d="M110 88 L110 206 M78 110 Q88 125 108 123 M142 110 Q132 125 112 123 M80 134 Q94 146 108 140 M140 134 Q126 146 112 140" />
                <path d="M89 150 Q102 156 108 151 M111 151 Q119 157 131 150 M87 163 Q99 170 108 163 M112 163 Q121 170 133 163 M85 179 Q98 186 108 180 M112 180 Q123 186 135 179" />
                <path d="M83 95 Q74 108 70 120 M137 95 Q146 108 150 120 M58 122 Q61 150 54 168 M162 122 Q159 150 166 168 M46 206 Q50 230 44 247 M174 206 Q170 230 176 247" />
                <path d="M94 251 Q83 281 91 308 M126 251 Q137 281 129 308 M82 359 Q94 388 92 409 M138 359 Q126 388 128 409" />
                <path d="M99 57 Q110 64 121 57 M101 45 Q105 43 108 45 M112 45 Q115 43 119 45" strokeWidth="0.6" />
              </>}
              {view === 'back' && <>
                <path d="M110 84 L110 209 M83 96 Q97 108 107 115 M137 96 Q123 108 113 115 M78 115 Q91 137 106 145 M142 115 Q129 137 114 145" />
                <path d="M79 152 Q95 161 108 155 M112 155 Q125 161 141 152 M83 184 Q98 190 108 185 M112 185 Q122 190 137 184" />
                <path d="M80 212 Q94 224 107 234 M140 212 Q126 224 113 234 M94 255 Q84 283 91 311 M126 255 Q136 283 129 311 M83 354 Q92 385 94 412 M137 354 Q128 385 126 412" />
                <path d="M60 126 Q58 150 54 168 M160 126 Q162 150 166 168" />
              </>}
              {(view === 'left' || view === 'right') && <>
                <path d="M110 86 Q126 116 120 145 M110 150 Q123 175 120 196 M107 250 Q118 279 107 307 M108 356 Q115 383 107 410" />
                <path d="M109 48 Q104 51 101 48 M111 98 Q117 131 114 160 M114 198 Q117 225 111 243" />
              </>}
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
      </>}
    </div>
  );
}
