import { LineChart, SERIES_COLORS } from '../../components/LineChart';
import { CategoryBadge, DemoBadge, fmtDeg, Notice, Stat } from '../../components/ui';
import type { TrainingSession } from '../../data/models';
import { getDefinition } from '../../engine/exercises/definitions';
import type { ExerciseId } from '../../engine/exercises/types';
import { useT } from '../../i18n';

/**
 * Session results: interpretable measurements only — repetitions, estimated ROM, holds, tempo,
 * pain before/after and exertion. Deliberately no composite "AI score".
 */
export function SessionSummary({ session, showTrajectory = true }: { session: TrainingSession; showTrajectory?: boolean }) {
  const { t } = useT();
  const pain = session.painBefore !== undefined && session.painAfter !== undefined;
  const painUp = pain && session.painAfter! - session.painBefore! >= 2;
  const simulated = session.provenance.source === 'simulated_demo';
  return (
    <div className="stack loose">
      <div className="row wrap">
        <CategoryBadge kind="camera" />
        <CategoryBadge kind="pro" />
        <DemoBadge show={!!session.isDemo || simulated} simulated={simulated && !session.isDemo} />
        {session.status === 'interrupted' && <span className="badge warn">{t('session.ended_early')}</span>}
      </div>
      {painUp && <Notice tone="warn">{t('session.pain_increase')}</Notice>}
      <div className="grid cols-4">
        <div className="panel">
          <Stat label={t('session.exercises')} value={session.results.length} />
        </div>
        <div className="panel">
          <Stat label={t('session.sets')} value={session.results.reduce((a, r) => a + r.setsCompleted, 0)} />
        </div>
        <div className="panel">
          <Stat label={t('session.reps')} value={session.results.reduce((a, r) => a + r.repsCompleted, 0)} sub={t('session.attempts', { n: session.results.reduce((a, r) => a + r.repsAttempted, 0) })} />
        </div>
        <div className="panel">
          <Stat
            label={t('session.pain_before_after')}
            value={pain ? `${session.painBefore} → ${session.painAfter}` : '–'}
            sub={
              <>
                <span aria-hidden="true">✎ </span>
                {t('cat.patient_reported')}
              </>
            }
          />
        </div>
        {session.rpe !== undefined && (
          <div className="panel">
            <Stat label={t('session.exertion')} value={session.rpe} unit="/10" sub={t('cat.patient_reported')} />
          </div>
        )}
      </div>

      {session.results.map((r) => {
        const def = getDefinition(r.definitionId as ExerciseId, r.definitionVersion);
        const rx = r.prescription;
        const pts = r.trajectory.map((p) => ({ x: p.t, y: p.angle }));
        return (
          <section key={r.programExerciseId + r.side} className="panel stack">
            <div className="row between wrap">
              <div>
                <h3>{t(def.nameKey)}</h3>
                <p className="small muted">
                  {r.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')} · {t('train.target_range', { min: rx.target.min, max: rx.target.max })} · v{r.definitionVersion}
                </p>
              </div>
              {r.endedEarly && <span className="badge warn">{t('session.ended_early')}</span>}
            </div>
            {r.repsAttempted === 0 ? (
              <p className="muted">{t('session.no_reps')}</p>
            ) : (
              <div className="grid cols-4">
                <Stat label={t('session.reps')} value={`${r.repsCompleted}/${rx.reps * rx.sets}`} sub={t('session.attempts', { n: r.repsAttempted })} />
                <Stat label={t('session.peak_rom')} value={fmtDeg(r.peakRom)} sub={`${t('session.mean_rom')} ${fmtDeg(r.meanPeakRom)}`} />
                <Stat label={t('session.hold_perf')} value={rx.holdSeconds > 0 ? `${r.holdsAchieved}/${r.holdsRequired}` : '–'} sub={rx.holdSeconds > 0 ? `${rx.holdSeconds} s` : undefined} />
                <Stat
                  label={t('session.tempo_up')}
                  value={r.meanConcentricMs ? `${(r.meanConcentricMs / 1000).toFixed(1)} s` : '–'}
                  sub={`${t('session.tempo_down')} ${r.meanEccentricMs ? (r.meanEccentricMs / 1000).toFixed(1) + ' s' : '–'} · ${t('session.fast_reps', { n: r.fastReps })}`}
                />
              </div>
            )}
            <div className="row wrap small muted">
              <span>
                {t('session.tracking')}: <strong className="num">{Math.round(r.trackingCoverage * 100)}%</strong>
              </span>
              {Object.keys(r.formCues).length > 0 && (
                <span>
                  {t('session.form_cues')}: {Object.entries(r.formCues).map(([k, n]) => `${k.replace(/_/g, ' ')} ×${n}`).join(', ')}
                </span>
              )}
            </div>
            {showTrajectory && pts.length > 5 && (
              <LineChart
                title={t('session.trajectory')}
                series={[{ id: 'angle', label: t(`measure.${def.primary}`), color: SERIES_COLORS.camera, marker: 'none', points: pts }]}
                band={{ min: rx.target.min, max: rx.target.max, label: t('session.target_band') }}
                yUnit="°"
                formatX={(x) => `${x.toFixed(0)} s`}
                xLabel="s"
                height={180}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
