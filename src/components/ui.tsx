import type { ReactNode } from 'react';
import { confidenceLevel } from '../engine/types';
import { useT } from '../i18n';

/**
 * Shared UI primitives. Data-category badges exist so that patient-reported data, camera
 * estimates, algorithmic observations and clinical interpretation are always visibly distinct.
 */

export type DataCategory = 'pro' | 'camera' | 'observation' | 'clinical' | 'clinician' | 'review';

const CATEGORY: Record<DataCategory, { key: string; glyph: string }> = {
  pro: { key: 'cat.patient_reported', glyph: '✎' },
  camera: { key: 'cat.camera_estimate', glyph: '◎' },
  observation: { key: 'cat.observation', glyph: '△' },
  clinical: { key: 'cat.clinical', glyph: '✓' },
  clinician: { key: 'cat.clinician_measured', glyph: '⊾' },
  review: { key: 'cat.requires_review', glyph: '⋯' },
};

export function CategoryBadge({ kind }: { kind: DataCategory }) {
  const { t } = useT();
  const c = CATEGORY[kind];
  return (
    <span className={`badge ${kind}`}>
      <span className="glyph" aria-hidden="true">
        {c.glyph}
      </span>
      {t(c.key)}
    </span>
  );
}

export function DemoBadge({ show = true, simulated = false }: { show?: boolean; simulated?: boolean }) {
  const { t } = useT();
  if (!show) return null;
  return (
    <span className="badge demo" title={t('common.demo_banner')}>
      {simulated ? t('common.simulated') : t('common.demo')}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const { t } = useT();
  const level = confidenceLevel(value);
  const cls = level === 'high' ? 'ok' : level === 'moderate' ? '' : level === 'low' ? 'warn' : 'danger';
  const bars = level === 'high' ? '▮▮▮' : level === 'moderate' ? '▮▮▯' : level === 'low' ? '▮▯▯' : '▯▯▯';
  return (
    <span className={`badge ${cls}`} title={`${t('measure.confidence')} ${value.toFixed(2)}`}>
      <span aria-hidden="true" className="glyph">
        {bars}
      </span>
      {t(`measure.conf.${level}`)}
      <span className="sr-only">({value.toFixed(2)})</span>
    </span>
  );
}

export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  const glyph = icon ?? (tone === 'danger' ? '!' : tone === 'warn' ? '!' : tone === 'ok' ? '✓' : 'i');
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="icon" aria-hidden="true">
        {glyph}
      </span>
      <div>{children}</div>
    </div>
  );
}

/** 0–10 Numeric Pain Rating Scale as a radio group with large touch targets. */
export function NprsInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  const { t } = useT();
  const sev = (n: number) => (n <= 3 ? 'var(--green)' : n <= 6 ? 'var(--amber)' : 'var(--red)');
  return (
    <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="row between" style={{ width: '100%', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 650 }}>{label}</span>
        <span className="num" style={{ fontWeight: 750, fontSize: '1.25rem' }}>
          {value === null ? '–' : value}
          <span className="muted small">/10</span>
        </span>
      </legend>
      <div className="nprs" role="radiogroup" aria-label={label}>
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}`}
            style={{ ['--sev' as string]: sev(n) }}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="nprs-scale" aria-hidden="true">
        <span>{t('pain.scale_0')}</span>
        <span>{t('pain.scale_5')}</span>
        <span>{t('pain.scale_10')}</span>
      </div>
    </fieldset>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  multi,
  label,
}: {
  options: { id: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  multi?: boolean;
  label: string;
}) {
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className="chip"
            role={multi ? undefined : 'radio'}
            aria-pressed={multi ? on : undefined}
            aria-checked={multi ? undefined : on}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.id) : [...value, o.id]) : [o.id])}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="steps" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < current ? 'done' : i === current ? 'current' : ''} />
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, sub, big }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${big ? 'xl' : ''}`}>
        {value}
        {unit && <span style={{ fontSize: '0.5em', color: 'var(--ink-3)', fontWeight: 600, marginLeft: 2 }}>{unit}</span>}
      </span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

export function Loader({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div className="skeleton-loader" role="status">
      <div className="stack tight" style={{ alignItems: 'center' }}>
        <div className="spinner" />
        <span className="small">{label ?? t('common.loading')}</span>
      </div>
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}

export function fmtDeg(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)}°`;
}
