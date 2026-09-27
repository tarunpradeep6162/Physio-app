import { isPathwayRegion } from '../../clinical/pathways';
import { useParams } from 'react-router-dom';
import { useDb } from '../../data/store';
import { AssessmentReview } from '../clinician/AssessmentReview';
import { KneeWorkspace } from './ClinicianWorkspace';

/** Pathway assessments (knee, shoulder) open the clinician workspace; legacy assessments keep the earlier review. */
export function AssessmentRoute() {
  const { id } = useParams();
  const a = useDb((d) => d.assessments.find((x) => x.id === id), [id]);
  if (isPathwayRegion(a?.region)) return <KneeWorkspace a={a!} />;
  return <AssessmentReview />;
}
