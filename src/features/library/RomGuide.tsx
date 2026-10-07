import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';

/**
 * Clinician reference: how to take the manual (goniometer / inclinometer) measurement that a camera
 * estimate can be checked against. Placement only — no normal ranges are given here; the clinic
 * chooses its own published reference. Draft content awaiting clinical-lead review.
 */

interface Entry {
  joint: string;
  movement: string;
  position: string;
  axis: string;
  stationary: string;
  moving: string;
  tip?: string;
  /** The camera test this can validate, if any. */
  camera?: string;
}

const ENTRIES: Entry[] = [
  { joint: 'Knee', movement: 'Flexion and extension', position: 'Lying on the back; for flexion slide the heel towards the buttock.', axis: 'Outer side of the knee, over the lateral femoral epicondyle.', stationary: 'Along the thigh towards the greater trochanter.', moving: 'Along the lower leg towards the lateral malleolus.', tip: 'Keep the hip from rotating; read extension with the heel supported.', camera: 'Supported knee flexion (heel slide)' },
  { joint: 'Hip', movement: 'Flexion', position: 'Lying on the back, opposite leg straight on the bed.', axis: 'Over the greater trochanter.', stationary: 'Along the side of the trunk and pelvis.', moving: 'Along the outer thigh towards the lateral femoral epicondyle.', tip: 'Stop when the pelvis starts to tilt backwards.', camera: 'Active hip flexion, standing (side view)' },
  { joint: 'Hip', movement: 'Abduction', position: 'Lying on the back, pelvis level.', axis: 'Over the front of the pelvis (ASIS) on the tested side.', stationary: 'Across to the opposite ASIS.', moving: 'Down the middle of the thigh towards the kneecap.', tip: 'Read the angle between the two arms and subtract the starting 90°.', camera: 'Active hip abduction, standing (front view)' },
  { joint: 'Shoulder', movement: 'Flexion', position: 'Lying on the back or sitting upright, thumb pointing up.', axis: 'Outer side of the shoulder, just below the acromion.', stationary: 'Along the side of the trunk.', moving: 'Along the outer upper arm towards the lateral epicondyle of the elbow.', tip: 'Watch for the back arching or the trunk leaning.', camera: 'Active shoulder flexion (side view)' },
  { joint: 'Shoulder', movement: 'Abduction', position: 'Lying on the back or sitting, palm facing forward.', axis: 'Front of the shoulder, below the acromion.', stationary: 'Parallel to the breastbone.', moving: 'Along the front of the upper arm.', tip: 'Turn the palm up past shoulder height so the arm can keep rising.', camera: 'Active shoulder abduction (front view)' },
  { joint: 'Elbow', movement: 'Flexion and extension', position: 'Lying on the back or sitting, upper arm supported.', axis: 'Over the lateral epicondyle.', stationary: 'Along the upper arm towards the acromion.', moving: 'Along the forearm towards the radial styloid at the wrist.' },
  { joint: 'Ankle', movement: 'Dorsiflexion', position: 'Sitting with the knee bent, or standing in a lunge facing a wall.', axis: 'Over the lateral malleolus.', stationary: 'Along the fibula towards the fibular head.', moving: 'Parallel to the outer edge of the foot (5th metatarsal).', tip: 'In the knee-to-wall lunge, record the toe-to-wall distance or the shin angle with an inclinometer, and note which.', camera: 'Knee-to-wall lunge (side view)' },
  { joint: 'Neck', movement: 'Flexion and extension', position: 'Sitting upright, back supported, looking ahead.', axis: 'Over the ear canal (external auditory meatus).', stationary: 'Vertical.', moving: 'Towards the base of the nose.', tip: 'An inclinometer on the top of the head is an alternative; keep the shoulders still.', camera: 'Neck forward and backward movement (side view)' },
  { joint: 'Lower back', movement: 'Forward bending', position: 'Standing, feet hip-width apart, knees straight.', axis: 'Not a goniometer measure.', stationary: 'Inclinometers at T12 and S1, or skin marks for a Schober-type test.', moving: 'Record the difference between the two inclinometers, or the increase in distance between the skin marks.', tip: 'State the method used; the two methods are not interchangeable.', camera: 'Standing forward bend (side view)' },
];

export function RomGuide() {
  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Reference</p>
          <h1>Range-of-motion measurement guide</h1>
          <p className="muted">How to take the manual measurement that a camera estimate is checked against. Record it under Captures &amp; replay → Reference measurement.</p>
        </div>
        <Link className="btn secondary" to="/c/library">
          Library
        </Link>
      </div>
      <Notice tone="warn">
        Draft reference awaiting clinical-lead review. It describes instrument placement only. Normal ranges are not shown: use the published reference your clinic has chosen and name it in your notes.
      </Notice>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data">
          <thead>
            <tr>
              <th>Joint · movement</th>
              <th>Patient position</th>
              <th>Axis</th>
              <th>Stationary arm</th>
              <th>Moving arm</th>
              <th>Practical points</th>
            </tr>
          </thead>
          <tbody>
            {ENTRIES.map((e) => (
              <tr key={`${e.joint}-${e.movement}`}>
                <td>
                  <strong>{e.joint}</strong>
                  <div className="small">{e.movement}</div>
                  {e.camera && <div className="xs muted">Camera test: {e.camera}</div>}
                </td>
                <td className="small">{e.position}</td>
                <td className="small">{e.axis}</td>
                <td className="small">{e.stationary}</td>
                <td className="small">{e.moving}</td>
                <td className="small">{e.tip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
