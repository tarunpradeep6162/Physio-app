import { LineChart, SERIES_COLORS } from '../../components/LineChart';
import { CategoryBadge, DemoBadge, Stat } from '../../components/ui';
import { adherence, activeProgram, fmtDate, measurementSeries, painSeries, programExercises } from '../../data/queries';
import { useDb } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { useT } from '../../i18n';

/**
 * Longitudinal progress: baseline vs current, with camera-derived estimates and clinician
 * (goniometer) measurements drawn as separate, differently-marked series — never merged.
 */
export function ProgressView({ patientId }: { patientId: string }) {
  const { t } = useT();
  const db = useDb((d) => d);
  const program = activeProgram(db, patientId);
  const types = new Set<string>();
  if (program) programExercises(db, program.id).forEach((e) => types.add(getDefinition(e.prescription.definitionId).primary));
  db.measurements.filter((m) => m.patientId === patientId && !m.type.startsWith('posture.') && m.sessionId).forEach((m) => types.add(m.type));
  const pain = painSeries(db, patientId);
  const adh = adherence(db, patientId, 28);
  const isDemo = db.patients.find((p) => p.id === patientId)?.isDemo;
  const dateFmt = (x: number) => fmtDate(new Date(x).toISOString());

  return (
    <div className="stack loose">
      {isDemo && (
        <div>
          <DemoBadge />
        </div>
      )}
      {[...types].map((type) => {
        const s = measurementSeries(db, patientId, type);
        if (s.camera.length === 0 && s.clinician.length === 0) return null;
        const base = s.camera[0];
        const cur = s.camera.at(-1);
        const change = base && cur ? cur.value - base.value : null;
        const cBase = s.clinician[0];
        const cCur = s.clinician.at(-1);
        return (
          <section key={type} className="panel stack">
            <div className="row between wrap">
              <h2>{t(`measure.${type}`)}</h2>
              <div className="row wrap">
                <CategoryBadge kind="camera" />
                {s.clinician.length > 0 && <CategoryBadge kind="clinician" />}
              </div>
            </div>
            <div className="grid cols-3">
              <Stat label={`${t('progress.baseline')} · ${base ? fmtDate(base.at) : ''}`} value={base ? `${Math.round(base.value)}°` : '–'} sub={t('cat.camera_estimate')} />
              <Stat label={`${t('progress.current')} · ${cur ? fmtDate(cur.at) : ''}`} value={cur ? `${Math.round(cur.value)}°` : '–'} sub={t('cat.camera_estimate')} />
              <Stat
                label={t('progress.change')}
                value={
                  change === null ? (
                    '–'
                  ) : (
                    <span className={change >= 0 ? 'delta-up' : 'delta-down'}>
                      {change >= 0 ? '▲ +' : '▼ '}
                      {Math.round(change)}°
                    </span>
                  )
                }
                sub={cBase && cCur && cBase !== cCur ? `${t('cat.clinician_measured')}: ${Math.round(cBase.value)}° → ${Math.round(cCur.value)}°` : undefined}
              />
            </div>
            <LineChart
              title={t(`measure.${type}`)}
              yUnit="°"
              formatX={dateFmt}
              series={[
                { id: 'camera', label: t('progress.legend_camera'), color: SERIES_COLORS.camera, marker: 'circle', points: s.camera.map((p) => ({ x: new Date(p.at).getTime(), y: p.value })) },
                ...(s.clinician.length
                  ? [{ id: 'clinician', label: t('progress.legend_clinician'), color: SERIES_COLORS.clinician, marker: 'square' as const, dashed: true, points: s.clinician.map((p) => ({ x: new Date(p.at).getTime(), y: p.value })) }]
                  : []),
              ]}
            />
          </section>
        );
      })}

      <div className="grid cols-2">
        <section className="panel stack">
          <div className="row between">
            <h2>{t('progress.pain')}</h2>
            <CategoryBadge kind="pro" />
          </div>
          {pain.length >= 2 ? (
            <>
              <p className="num" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                {weeklyPain(pain).join(' → ')}
              </p>
              <LineChart title={t('progress.pain')} yDomain={[0, 10]} formatX={dateFmt} series={[{ id: 'pain', label: t('progress.pain'), color: SERIES_COLORS.neutral, marker: 'diamond', points: pain.map((p) => ({ x: new Date(p.at).getTime(), y: p.value })) }]} height={170} />
            </>
          ) : (
            <p className="muted">{t('progress.no_data')}</p>
          )}
        </section>
        <section className="panel stack">
          <h2>{t('progress.adherence')}</h2>
          <Stat big label={t('home.sessions_done', { done: adh.done, planned: adh.planned })} value={adh.pct === null ? '–' : `${Math.round(adh.pct * 100)}%`} sub="28 days" />
          {adh.pct !== null && (
            <div className="meter" role="meter" aria-valuenow={Math.round(adh.pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t('progress.adherence')}>
              <span style={{ width: `${adh.pct * 100}%` }} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Pain summarised per week (median), e.g. 6 → 5 → 3. */
function weeklyPain(pts: { at: string; value: number }[]): number[] {
  const start = new Date(pts[0].at).getTime();
  const weeks = new Map<number, number[]>();
  for (const p of pts) {
    const w = Math.floor((new Date(p.at).getTime() - start) / (7 * 86_400_000));
    weeks.set(w, [...(weeks.get(w) ?? []), p.value]);
  }
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]);
}
