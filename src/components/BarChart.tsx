import { useId, useState } from 'react';

/**
 * Lightweight grouped SVG bar chart (no charting dependency). Each bar carries its value as text,
 * series differ by colour AND pattern (solid vs hatched) so identity never relies on colour alone,
 * a legend is always shown, and a table view gives the same numbers for screen readers.
 * Colours are the same CVD-checked pair as the line chart (#0D9488 / #7C5CD6).
 */

export interface BarSeries {
  id: string;
  label: string;
  color: string;
  hatched?: boolean;
}

export interface BarChartProps {
  title: string;
  categories: string[];
  series: BarSeries[];
  /** values[seriesIndex][categoryIndex] */
  values: number[][];
  height?: number;
}

const W = 560;
const PAD = { l: 34, r: 10, t: 18, b: 30 };

export function BarChart({ title, categories, series, values, height = 220 }: BarChartProps) {
  const id = `bc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...values.flat());
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const plotW = W - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const groupW = plotW / Math.max(1, categories.length);
  const barW = Math.min(22, (groupW * 0.7) / series.length);
  const y = (v: number) => PAD.t + plotH - (v / niceMax) * plotH;
  // Counts: whole-number ticks only.
  const ticks = [...new Set([0, Math.round(niceMax / 2), niceMax])];
  const summary = categories.map((c, ci) => `${c}: ${series.map((s, si) => `${s.label} ${values[si][ci]}`).join(', ')}`).join('; ');

  return (
    <figure className="stack tight" style={{ margin: 0 }}>
      <div className="row between wrap">
        <figcaption className="small" style={{ fontWeight: 650 }}>
          {title}
        </figcaption>
        <button type="button" className="btn ghost sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      <div className="row wrap" style={{ gap: '0.9rem' }} aria-hidden="true">
        {series.map((s) => (
          <span key={s.id} className="row xs" style={{ gap: '0.35rem' }}>
            <svg width="14" height="14">
              {s.hatched && <Hatch id={`${id}-l-${s.id}`} color={s.color} />}
              <rect width="14" height="14" rx="2" fill={s.hatched ? `url(#${id}-l-${s.id})` : s.color} stroke={s.color} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      {table ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={`${title} — table`}>
          <table className="data">
            <thead>
              <tr>
                <th>Month</th>
                {series.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, ci) => (
                <tr key={c}>
                  <td>{c}</td>
                  {series.map((s, si) => (
                    <td key={s.id} className="num">
                      {values[si][ci]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}. ${summary}`} style={{ width: '100%', height: 'auto' }}>
          {series.map((s) => (s.hatched ? <Hatch key={s.id} id={`${id}-h-${s.id}`} color={s.color} /> : null))}
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(tv)} y2={y(tv)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(tv)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--ink-3)">
                {tv}
              </text>
            </g>
          ))}
          {categories.map((c, ci) => {
            const gx = PAD.l + ci * groupW + (groupW - barW * series.length) / 2;
            return (
              <g key={c}>
                {series.map((s, si) => {
                  const v = values[si][ci];
                  const top = y(v);
                  return (
                    <g key={s.id}>
                      <rect x={gx + si * barW} y={top} width={barW - 2} height={Math.max(0, PAD.t + plotH - top)} fill={s.hatched ? `url(#${id}-h-${s.id})` : s.color} stroke={s.color} strokeWidth={1} rx={2} />
                      {v > 0 && (
                        <text x={gx + si * barW + (barW - 2) / 2} y={top - 4} textAnchor="middle" fontSize="10" fill="var(--ink-2)">
                          {v}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={PAD.l + ci * groupW + groupW / 2} y={height - 10} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                  {c}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}

function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={color} opacity="0.25" />
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
      </pattern>
    </defs>
  );
}
