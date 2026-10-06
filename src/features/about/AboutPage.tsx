import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../../components/icons';
import { Notice } from '../../components/ui';
import { useT } from '../../i18n';

/**
 * Public trust pages: how the app works, where data goes, what has (and has not) been validated, and
 * a privacy notice DRAFT. Statements here describe this codebase as it is; anything that depends on
 * the clinic (legal entity, grievance officer, hosting region) is a visible placeholder to complete.
 */

function PublicShell({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="public-page">
      <header className="public-head">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <BrandMark />
          {t('app.name')}
        </Link>
        <nav className="row wrap" style={{ gap: '1rem' }} aria-label="About">
          <Link to="/about">How it works</Link>
          <Link to="/privacy">Privacy notice (draft)</Link>
        </nav>
      </header>
      <main className="content narrow stack loose">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="panel stack" aria-labelledby={id}>
      <h2 id={id} className="h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Boxes and arrows drawn as SVG: what happens to a camera frame and to the numbers it produces. */
function DataFlowDiagram() {
  const boxes = [
    { x: 10, y: 20, w: 150, title: 'Camera', sub: 'live frames' },
    { x: 200, y: 20, w: 170, title: 'On-device pose model', sub: 'frames discarded' },
    { x: 410, y: 20, w: 170, title: 'Points + angles', sub: 'withheld if hidden' },
    { x: 410, y: 140, w: 170, title: 'Saved record', sub: 'numbers + provenance' },
    { x: 200, y: 140, w: 170, title: 'Physio review', sub: 'accept / reject' },
    { x: 10, y: 140, w: 150, title: 'Report', sub: 'draft until reviewed' },
  ];
  const arrow = (x1: number, y1: number, x2: number, y2: number, k: number) => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={2} markerEnd="url(#arr)" />;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 590 230" role="img" aria-labelledby="flow-title flow-desc" style={{ width: '100%', height: 'auto', color: 'var(--ink-2, #475569)' }}>
        <title id="flow-title">Data flow</title>
        <desc id="flow-desc">Camera frames go to a pose model running on the device and are discarded. Body points and angles pass a quality gate; the numbers, questionnaire answers and their provenance are saved. A physiotherapist reviews them before a report is final. Optional still images are saved only with separate consent.</desc>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {boxes.map((b) => (
          <g key={b.title}>
            <rect x={b.x} y={b.y} width={b.w} height={64} rx={10} fill="var(--surface-2, #f1f5f9)" stroke="var(--teal, #0d9488)" strokeWidth={1.5} />
            <text x={b.x + b.w / 2} y={b.y + 27} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--ink, #0f172a)">
              {b.title}
            </text>
            <text x={b.x + b.w / 2} y={b.y + 46} textAnchor="middle" fontSize={11} fill="var(--ink-2, #475569)">
              {b.sub}
            </text>
          </g>
        ))}
        {arrow(160, 52, 198, 52, 1)}
        {arrow(370, 52, 408, 52, 2)}
        {arrow(495, 84, 495, 138, 3)}
        {arrow(410, 172, 372, 172, 4)}
        {arrow(200, 172, 162, 172, 5)}
      </svg>
      <figcaption className="small muted">Raw video is never uploaded or stored. A still image is kept only when the patient gives the separate, optional image consent.</figcaption>
    </figure>
  );
}

export function AboutPage() {
  return (
    <PublicShell eyebrow="About Dheepika Lab" title="How it works, and what it cannot do">
      <Notice tone="warn">Pilot build. Not approved for clinical use with real patients. The demo accounts use simulated people and are labelled SIMULATED throughout.</Notice>

      <Section id="how" title="How it works">
        <ol className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>The patient answers an intake: body map, pain intensity and character, duration, aggravating activities, and a safety (red-flag) screen. Their answers are stored exactly as given.</li>
          <li>The camera checks the set-up (lighting, phone level, distance, which body points are visible) before any number is shown.</li>
          <li>A pose model running on the phone or laptop finds body points; the app calculates 2D angles, symmetry and movement quality from them. If a required point is hidden, that number is withheld and a recapture is requested.</li>
          <li>Threshold crossings are shown as <strong>algorithmic observations</strong> with the measurement, view, confidence, calculation and version — never as a diagnosis.</li>
          <li>A physiotherapist reviews every camera estimate and observation, records their own findings, and only then is a report final.</li>
        </ol>
      </Section>

      <Section id="flow" title="Where the data goes">
        <DataFlowDiagram />
        <p className="small" style={{ margin: 0 }}>
          In the local demo, records stay in this browser only. In the clinic deployment, records are stored in the clinic&apos;s database with row-level access rules: patients see their own records; physiotherapists of the same clinic see their patients. Every change is written to an audit log.
        </p>
      </Section>

      <Section id="accuracy" title="Accuracy and validation status">
        <p style={{ margin: 0 }}>
          <strong>Not yet validated.</strong> The angles are camera estimates. They have been checked against synthetic skeletons in automated tests, but they have not yet been compared with goniometer or inclinometer readings on real, consenting volunteers using the phones a clinic would use. Until that study is done, no accuracy figure is claimed.
        </p>
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>Clothing, lighting, camera height and angle all change the estimate.</li>
          <li>A 2D camera cannot see rotation out of the image plane or identify which tissue causes pain.</li>
          <li>The app gives no disease probabilities, population norms or severity categories.</li>
        </ul>
      </Section>

      <Section id="regulatory" title="Regulatory status">
        <p style={{ margin: 0 }}>
          This software has not been assessed, registered or approved as a medical device by any regulator, including the Central Drugs Standard Control Organisation (CDSCO) in India. It is not intended to diagnose, treat or prevent any condition. Clinical decisions remain with the treating physiotherapist.
        </p>
      </Section>

      <Section id="guidelines" title="Guidance we refer to">
        <p className="small muted" style={{ margin: 0 }}>
          Listed so you can see the sources behind the rules. None of these organisations has reviewed or endorsed this app.
        </p>
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>NICE guideline NG226 (2022), Osteoarthritis in over 16s — cited by the knee reasoning rule as context for the clinician, who decides.</li>
          <li>Digital Personal Data Protection Act, 2023 (India) — the basis for the privacy notice draft.</li>
          <li>Published studies attached to treatment plans are shown with their PubMed ID and DOI so they can be checked.</li>
        </ul>
        <p className="small" style={{ margin: 0 }}>All safety rules and clinical reasoning rules are drafts until a clinical lead records approval.</p>
      </Section>

      <Section id="devices" title="Device requirements">
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>A recent version of Chrome, Edge, Safari or Firefox with camera access allowed for this site.</li>
          <li>A phone or laptop camera; a stand or something to prop the phone upright and level.</li>
          <li>About 1.5–3 m of clear space so the needed body points are in view, and light in front of you rather than behind.</li>
          <li>Older or low-power phones may run slowly; the app shows the frame rate and warns when tracking is too slow to measure.</li>
        </ul>
      </Section>

      <Section id="faq" title="Questions">
        <dl className="stack" style={{ margin: 0 }}>
          <div>
            <dt>
              <strong>Is my video recorded?</strong>
            </dt>
            <dd style={{ margin: 0 }}>No. Frames are processed in memory and discarded. Only body-point coordinates and calculated numbers are saved, plus a still image if you separately agree to that.</dd>
          </div>
          <div>
            <dt>
              <strong>Can the app tell me what is wrong?</strong>
            </dt>
            <dd style={{ margin: 0 }}>No. It measures movement and records your answers. Your physiotherapist examines you and decides.</dd>
          </div>
          <div>
            <dt>
              <strong>Why was a number not shown?</strong>
            </dt>
            <dd style={{ margin: 0 }}>A required body point was hidden, the set-up check failed, or the reading was unstable. The app withholds the number rather than guess, and asks you to recapture.</dd>
          </div>
          <div>
            <dt>
              <strong>Can I delete my data?</strong>
            </dt>
            <dd style={{ margin: 0 }}>Yes — Profile → Delete my account. Financial records the clinic must keep by law may be retained in pseudonymised form if the clinic has turned that setting on.</dd>
          </div>
        </dl>
      </Section>
      <p className="small">
        <Link to="/privacy">Read the privacy notice (draft)</Link> · <Link to="/">Back to start</Link>
      </p>
    </PublicShell>
  );
}

const TBC = ({ children }: { children: ReactNode }) => <mark className="tbc">[{children}]</mark>;

export function PrivacyNotice() {
  return (
    <PublicShell eyebrow="Privacy notice · DRAFT for legal review" title="How Dheepika Lab handles your personal data">
      <Notice tone="warn">
        <strong>Draft — not in force.</strong> Written against the Digital Personal Data Protection Act, 2023 for review by a qualified lawyer. Items in [brackets] must be completed by the clinic. Until this notice is reviewed and the deployment approved, do not enter real patient information.
      </Notice>

      <Section id="who" title="1. Who is responsible">
        <p style={{ margin: 0 }}>
          The Data Fiduciary is <TBC>clinic legal name, registered address</TBC>. Grievance / data protection contact: <TBC>name, email, phone</TBC>. Software and hosting providers process data on the clinic&apos;s instructions as Data Processors.
        </p>
      </Section>

      <Section id="what" title="2. What we collect and why">
        <table className="data compact">
          <thead>
            <tr>
              <th>Data</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Name, contact, age, sex, account login</td>
              <td>Identify you, book appointments, contact you about your care</td>
            </tr>
            <tr>
              <td>Intake answers (pain map, intensity, character, duration, activities, safety screen)</td>
              <td>Physiotherapy assessment by your physiotherapist</td>
            </tr>
            <tr>
              <td>Body-point coordinates and calculated angles from the camera</td>
              <td>Movement measurement reviewed by your physiotherapist</td>
            </tr>
            <tr>
              <td>Still images (only with the separate image consent)</td>
              <td>Visual review of a posture scan by your physiotherapist</td>
            </tr>
            <tr>
              <td>Exercise sessions, pain before/after, step counts (only with activity consent)</td>
              <td>Monitoring your home programme</td>
            </tr>
            <tr>
              <td>Appointments, treatment courses, payments</td>
              <td>Running the clinic, billing and legal record-keeping</td>
            </tr>
          </tbody>
        </table>
        <p className="small" style={{ margin: 0 }}>Raw video is never stored. We do not sell data or use it for advertising.</p>
      </Section>

      <Section id="consent" title="3. Consent">
        <p style={{ margin: 0 }}>Each consent is asked separately, recorded with the version of the text you saw, and can be withdrawn at any time in Profile:</p>
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>
            <strong>Camera processing</strong> (required for camera tests) — processing on your device.
          </li>
          <li>
            <strong>Storage and sharing with your physiotherapist</strong> (required to use the app).
          </li>
          <li>
            <strong>Image storage</strong> (optional, separate) — a still image with posture scans.
          </li>
          <li>
            <strong>Research / validation use</strong> (optional) — anonymised measurements to check accuracy.
          </li>
          <li>
            <strong>Activity data</strong> (optional) — step counts or walking data you import.
          </li>
        </ul>
        <p className="small" style={{ margin: 0 }}>
          Withdrawing consent stops future processing for that purpose; it does not undo processing already done lawfully. For a person under 18, verifiable consent of a parent or lawful guardian is required <TBC>age-verification process to be defined</TBC>.
        </p>
      </Section>

      <Section id="retention" title="4. How long we keep it">
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>Clinical records: <TBC>period required by applicable clinical record rules</TBC>, then deleted.</li>
          <li>Body-point streams and key frames: <TBC>e.g. 90 days</TBC>; the calculated numbers and audit trail are kept with the clinical record.</li>
          <li>Financial records: as required by tax law <TBC>period</TBC>. If you delete your account, these may be kept in pseudonymised form when the clinic has enabled that setting.</li>
          <li>Audit log entries: <TBC>period</TBC>.</li>
        </ul>
      </Section>

      <Section id="rights" title="5. Your rights">
        <ul className="stack tight" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          <li>Get a summary of your personal data and the processing (Profile → Export my data).</li>
          <li>Correct or complete inaccurate data — ask your physiotherapist or the contact above.</li>
          <li>Erase your data (Profile → Delete my account), subject to records the law requires us to keep.</li>
          <li>Nominate another person to exercise your rights if you die or become incapable <TBC>process</TBC>.</li>
          <li>Raise a grievance with the contact above; we will respond within <TBC>period</TBC>. If unresolved, you may complain to the Data Protection Board of India.</li>
        </ul>
      </Section>

      <Section id="security" title="6. Security, location and breaches">
        <p style={{ margin: 0 }}>
          Access is limited by role with row-level database rules, sign-in is required, and changes are audit-logged. Data is hosted by <TBC>hosting provider and region</TBC>. If a personal data breach occurs, we will inform the Data Protection Board and affected people as the Act and its rules require.
        </p>
      </Section>

      <Section id="changes" title="7. Changes to this notice">
        <p style={{ margin: 0 }}>
          Version <TBC>version, effective date</TBC>. When it changes materially, you will be shown the new version and asked again where consent is needed.
        </p>
      </Section>
      <p className="small">
        <Link to="/about">How the app works</Link> · <Link to="/">Back to start</Link>
      </p>
    </PublicShell>
  );
}
