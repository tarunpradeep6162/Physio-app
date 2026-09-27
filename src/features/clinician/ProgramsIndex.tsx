import { Link } from 'react-router-dom';
import { IconPlus } from '../../components/icons';
import { DemoBadge } from '../../components/ui';
import { fmtDate, programExercises } from '../../data/queries';
import { useDb } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { useT } from '../../i18n';

export function ProgramsIndex() {
  const { t } = useT();
  const db = useDb((d) => d);
  const programs = [...db.programs].sort((a, b) => (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
  const pname = (id: string) => db.patients.find((p) => p.id === id)?.name ?? '—';
  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <h1>{t('nav.programs')}</h1>
        <Link to="/c/programs/new" className="btn primary">
          <IconPlus width={18} /> New program
        </Link>
      </div>
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Program</th>
              <th>Exercises</th>
              <th>Period</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/c/patients/${p.patientId}?tab=programs`}>{pname(p.patientId)}</Link> {p.isDemo && <DemoBadge />}
                </td>
                <td>{p.title}</td>
                <td className="small">
                  {programExercises(db, p.id)
                    .map((e) => `${t(getDefinition(e.prescription.definitionId).nameKey)} (${e.prescription.side[0].toUpperCase()})`)
                    .join(', ')}
                </td>
                <td className="small">
                  {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                </td>
                <td>
                  <span className={`badge ${p.status === 'active' ? 'clinical' : ''}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
