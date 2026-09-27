import { useParams } from 'react-router-dom';
import { useDb } from '../../data/store';
import { AssessmentReview } from '../clinician/AssessmentReview';
import { KneeWorkspace } from './ClinicianWorkspace';

/** Knee-pathway assessments open the clinician workspace; legacy assessments keep the earlier review. */
export function AssessmentRoute() {
  const { id } = useParams();
  const a = useDb((d) => d.assessments.find((x) => x.id === id), [id]);
  if (a?.region === 'knee') return <KneeWorkspace a={a} />;
  return <AssessmentReview />;
}
