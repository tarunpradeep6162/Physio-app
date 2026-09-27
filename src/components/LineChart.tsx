import { useId, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';

/**
 * Lightweight SVG line chart (no charting dependency — keeps the camera bundle small).
 * - One y-axis only; 2px lines; ≥8px markers with distinct SHAPES per series (identity is never
 *   colour-alone); legend always shown for ≥2 series; crosshair + tooltip on hover/touch;
 *   a table view for screen readers and anyone who prefers numbers.
 * Series colours validated for CVD separation on the light surface (#0D9488 / #7C5CD6).
 */

export interface ChartPoint {
  x: number;
  y: number | null;
  note?: string;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  marker: 'circle' | 'square' | 'diamond' | 'none';
  dashed?: boolean;
  points: ChartPoint[];
}

export interface LineChartProps {
  series: ChartSeries[];
  title: string;
  yUnit?: string;
  yDomain?: [number, number];
  band?: { min: number; max: number; label: string };
  formatX: (x: number) => string;
  height?: number;
  showTableToggle?: boolean;
  xLabel?: string;
}

const W = 480;
const PAD = { l: 44, r: 14, t: 16, b: 30 };

export function LineChart({ series, title, yUnit = '', yDomain, band, formatX, height = 240, showTableToggle = true, xLabel }: LineChartProps) {
  const { t } = useT();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const H = height;

  const all = series.flatMap((s) => s.points.filter((p) => p.y !== null));
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y as number);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const [y0, y1] = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    const lo = Math.min(...ys, band?.min ?? Infinity);
    const hi = Math.max(...ys, band?.max ?? -Infinity);
    const pad = Math.max(2, (hi - lo) * 0.12);
    return [Math.floor((lo - pad) / 5) * 5, Math.ceil((hi + pad) / 5) * 5];
  }, [yDomain, ys, band]);

  if (all.length === 0) return <p className="muted small">{t('progress.no_data')}</p>;

  const sx = (x: number) => PAD.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const ticks = niceTicks(y0, y1, 4);
  const xTicks = [x0, x0 + (x1 - x0) / 2, x1].filter((v, i, a) => a.indexOf(v) === i);

  // Unique x positions for crosshair snapping.
  const uniqueX = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let bestD = Infinity;
    uniqueX.forEach((x, i) => {
      const d = Math.abs(sx(x) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hx = hover !== null ? uniqueX[hover] : null;
  const hoverRows = hx === null ? [] : series.map((s) => ({ s, p: s.points.find((p) => p.x === hx && p.y !== null) })).filter((r) => r.p);

  return (
    <figure className="stack tight" style={{ margin: 0 }} aria-labelledby={`${id}-title`}>
      <div className="row between wrap">
        <figcaption id={`${id}-title`} style={{ fontWeight: 650 }}>
          {title}
        </figcaption>
        {showTableToggle && (
          <button type="button" className="btn ghost sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
            {table ? t('progress.chart_view') : t('progress.table_view')}
          </button>
        )}
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.id}>
              <svg width="26" height="12" aria-hidden="true">
                <line x1="1" y1="6" x2="25" y2="6" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
                <Marker kind={s.marker} x={13} y={6} color={s.color} />
              </svg>
              {s.label}
            </span>
          ))}
          {band && (
            <span>
              <svg width="18" height="12" aria-hidden="true">
                <rect x="1" y="1" width="16" height="10" fill="rgba(49,196,141,0.18)" stroke="rgba(28,127,88,0.5)" />
              </svg>
              {band.label}
            </span>
          )}
        </div>
      )}
      {table ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{xLabel ?? t('progress.date')}</th>
                {series.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uniqueX.map((x) => (
                <tr key={x}>
                  <td>{formatX(x)}</td>
                  {series.map((s) => {
                    const p = s.points.find((q) => q.x === x);
                    return (
                      <td key={s.id} className="num">
                        {p?.y != null ? `${round(p.y)}${yUnit}` : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            ref={svgRef}
            className="chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${title}. ${series.map((s) => `${s.label}: ${s.points.filter((p) => p.y !== null).length} points`).join('; ')}`}
            onPointerMove={(e) => onMove(e.clientX)}
            onPointerDown={(e) => onMove(e.clientX)}
            onPointerLeave={() => setHover(null)}
          >
            {band && (
              <rect x={PAD.l} width={W - PAD.l - PAD.r} y={sy(Math.min(band.max, y1))} height={Math.max(0, sy(Math.max(band.min, y0)) - sy(Math.min(band.max, y1)))} fill="rgba(49,196,141,0.14)" />
            )}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#e3ebe8" strokeWidth="1" />
                <text x={PAD.l - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle" fontSize="13" fill="#62736f">
                  {v}
                  {yUnit}
                </text>
              </g>
            ))}
            {xTicks.map((x, i) => (
              <text key={x} x={sx(x)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize="13" fill="#62736f">
                {formatX(x)}
              </text>
            ))}
            {series.map((s) => {
              const segs = segments(s.points);
              return (
                <g key={s.id}>
                  {segs.map((seg, i) => (
                    <polyline
                      key={i}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray={s.dashed ? '6 4' : undefined}
                      points={seg.map((p) => `${sx(p.x)},${sy(p.y as number)}`).join(' ')}
                    />
                  ))}
                  {s.marker !== 'none' &&
                    s.points.map((p, i) => (p.y === null ? null : <Marker key={i} kind={s.marker} x={sx(p.x)} y={sy(p.y)} color={s.color} ring />))}
                </g>
              );
            })}
            {/* Direct label on the last point of each series (≤4 series). */}
            {series.length <= 4 &&
              series.map((s) => {
                const last = [...s.points].reverse().find((p) => p.y !== null);
                if (!last || s.marker === 'none') return null;
                return (
                  <text key={s.id} x={Math.min(sx(last.x) + 8, W - PAD.r)} y={sy(last.y as number) - 10} fontSize="14" fontWeight="700" fill="#10201d" textAnchor={sx(last.x) > W - 60 ? 'end' : 'start'}>
                    {round(last.y as number)}
                    {yUnit}
                  </text>
                );
              })}
            {hx !== null && (
              <line x1={sx(hx)} x2={sx(hx)} y1={PAD.t} y2={H - PAD.b} stroke="#10201d" strokeOpacity="0.35" strokeWidth="1" />
            )}
          </svg>
          {hx !== null && hoverRows.length > 0 && (
            <div className="chart-tooltip" style={{ left: `${(sx(hx) / W) * 100}%`, top: `${(Math.min(...hoverRows.map((r) => sy(r.p!.y as number))) / H) * 100}%` }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatX(hx)}</div>
              {hoverRows.map(({ s, p }) => (
                <div key={s.id}>
                  {s.label}: <strong className="num">{round(p!.y as number)}{yUnit}</strong>
                  {p!.note ? ` · ${p!.note}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function Marker({ kind, x, y, color, ring }: { kind: ChartSeries['marker']; x: number; y: number; color: string; ring?: boolean }) {
  const stroke = ring ? '#ffffff' : 'none';
  if (kind === 'square') return <rect x={x - 4.5} y={y - 4.5} width="9" height="9" rx="1.5" fill={color} stroke={stroke} strokeWidth="2" />;
  if (kind === 'diamond') return <rect x={x - 4.5} y={y - 4.5} width="9" height="9" fill={color} stroke={stroke} strokeWidth="2" transform={`rotate(45 ${x} ${y})`} />;
  if (kind === 'circle') return <circle cx={x} cy={y} r="4.5" fill={color} stroke={stroke} strokeWidth="2" />;
  return null;
}

function segments(points: ChartPoint[]): ChartPoint[][] {
  const out: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function round(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
}

export const SERIES_COLORS = { camera: '#0D9488', clinician: '#7C5CD6', neutral: '#3C4D49' };
