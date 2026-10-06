import { courseProgress, localDay } from '../clinic/backoffice';
import type { DB, Discharge, ID } from '../data/models';
import { activeProgram, age, fmtDate } from '../data/queries';
import { patientCode } from './directory';
import { buildReport, evidenceBlocks, lastDataChange, type Block, type ReportModel, type ReportSection } from './report';

/**
 * Discharge summary (Oct 2026). Assembled from recorded data only:
 * attendance from the schedule, pain from the patient's own scores, measurements from the latest
 * assessment's report sections (camera estimates keep their labels and quality rules), the signed
 * clinical impression, and the physiotherapist's discharge text. It is preliminary until signed, and
 * returns to preliminary when the patient's data changes after signing.
 */

export const DISCHARGE_TEMPLATE = 'discharge-1.0.0';

export interface DischargeDraft {
  summary: string;
  advice: string;
  followUp: string;
}

function patientAssessments(db: DB, patientId: ID) {
  return db.assessments.filter((a) => a.patientId === patientId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function nprs(db: DB, patientId: ID) {
  return db.pros
    .filter((p) => p.patientId === patientId && p.type === 'nprs_now' && typeof p.value === 'number')
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Changes whenever anything shown in the summary changes (including status updates that carry no timestamp). */
export function dischargeFingerprint(db: DB, patientId: ID): string {
  const assessments = patientAssessments(db, patientId);
  const parts = [
    assessments.map((a) => `${a.id}:${lastDataChange(db, a.id)}`).join(','),
    (db.appointments ?? []).filter((a) => a.patientId === patientId).map((a) => `${a.id}:${a.status}`).sort().join(','),
    (db.treatmentCourses ?? []).filter((c) => c.patientId === patientId).map((c) => `${c.id}:${c.status}:${c.plannedSessions}`).sort().join(','),
    db.sessions.filter((s) => s.patientId === patientId).length,
    nprs(db, patientId).map((p) => p.id).join(','),
    db.impressions.filter((i) => assessments.some((a) => a.id === i.assessmentId)).map((i) => i.id).join(','),
  ];
  return parts.join('|');
}

export function dischargeStatus(db: DB, patientId: ID): { latest?: Discharge; signed: boolean; stale: boolean; nextVersion: number } {
  const rows = (db.discharges ?? []).filter((d) => d.patientId === patientId).sort((a, b) => b.version - a.version);
  const latest = rows[0];
  const stale = !!latest && latest.fingerprint !== dischargeFingerprint(db, patientId);
  return { latest, signed: !!latest && !stale, stale, nextVersion: (latest?.version ?? 0) + 1 };
}

export function buildDischarge(db: DB, patientId: ID, draft?: DischargeDraft): ReportModel {
  const p = db.patients.find((x) => x.id === patientId);
  if (!p) throw new Error('Unknown patient');
  const st = dischargeStatus(db, patientId);
  const text: DischargeDraft | undefined = draft ?? (st.latest ? { summary: st.latest.summary, advice: st.latest.advice, followUp: st.latest.followUp } : undefined);
  const assessments = patientAssessments(db, patientId);
  const first = assessments[0];
  const last = assessments.at(-1);
  const visits = (db.appointments ?? []).filter((a) => a.patientId === patientId);
  const attended = visits.filter((a) => a.status === 'done').sort((a, b) => a.at.localeCompare(b.at));
  const signer = st.latest ? db.clinicians.find((c) => c.id === st.latest!.signedBy) : undefined;
  const S: ReportSection[] = [];
  const add = (n: number, title: string, blocks: Block[], label?: string) => S.push({ n, title, blocks, label });

  add(1, 'Patient and episode', [
    {
      kind: 'kv',
      rows: [
        ['Patient', `${p.name} · ${patientCode(p.id)}`],
        ['Age', p.dob ? `${age(p.dob)} years` : 'not recorded'],
        ['First assessment', first ? fmtDate(first.createdAt) : 'none recorded'],
        ['Latest assessment', last ? fmtDate(last.createdAt) : 'none recorded'],
        ['Visits attended', attended.length ? `${attended.length} (first ${localDay(attended[0].at)}, last ${localDay(attended.at(-1)!.at)})` : 'none recorded'],
        ['Main concern (patient’s words)', p.concern ?? 'not recorded'],
      ],
    },
  ]);

  const courses = (db.treatmentCourses ?? []).filter((c) => c.patientId === patientId);
  const homeSessions = db.sessions.filter((s) => s.patientId === patientId).length;
  add(
    2,
    'Treatment and attendance',
    [
      courses.length
        ? {
            kind: 'table',
            head: ['Course', 'Start', 'Planned', 'Attended', 'Missed', 'Status'],
            rows: courses.map((c) => {
              const pr = courseProgress(db, c);
              return [c.title, c.startDate, String(c.plannedSessions), String(pr.attended), String(pr.missed), c.status];
            }),
          }
        : { kind: 'missing', text: 'No treatment course recorded.' },
      { kind: 'para', text: `Home exercise sessions recorded in the app: ${homeSessions}.`, tone: 'muted' },
    ],
    'Recorded by the clinic',
  );

  const scores = nprs(db, patientId);
  add(
    3,
    'Pain',
    scores.length >= 2
      ? [
          {
            kind: 'kv',
            rows: [
              ['First score', `${scores[0].value as number}/10 on ${fmtDate(scores[0].recordedAt)}`],
              ['Latest score', `${scores.at(-1)!.value as number}/10 on ${fmtDate(scores.at(-1)!.recordedAt)}`],
            ],
          },
          { kind: 'para', text: 'Pain right now (0–10) as the patient reported it.', tone: 'muted' },
        ]
      : [{ kind: 'missing', text: scores.length === 1 ? `Only one pain score recorded (${scores[0].value as number}/10 on ${fmtDate(scores[0].recordedAt)}).` : 'No pain scores recorded.' }],
    'Patient-reported',
  );

  // Measurements: the latest assessment's own report sections, unchanged (baseline vs current, quality rules).
  if (last) {
    const r = buildReport(db, last.id, 'clinician');
    const pick = (n: number) => r.sections.find((s) => s.n === n);
    for (const [n, sec] of [[4, pick(5)], [5, pick(8)]] as const) if (sec) add(n, sec.title, sec.blocks, sec.label);
    const impression = db.impressions.filter((i) => i.assessmentId === last.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    add(6, 'Clinical impression', [impression ? { kind: 'para', text: `${impression.text} (signed ${fmtDate(impression.at)})`, tone: 'strong' } : { kind: 'missing', text: 'No signed clinical impression on the latest assessment.' }], 'Clinician');
  } else {
    add(4, 'Measurements', [{ kind: 'missing', text: 'No assessment recorded.' }]);
  }

  add(
    7,
    'Discharge summary',
    text && (text.summary.trim() || text.advice.trim() || text.followUp.trim())
      ? [
          { kind: 'kv', rows: [['Summary', text.summary.trim() || '—'], ['Home advice', text.advice.trim() || '—'], ['Follow-up', text.followUp.trim() || '—']] },
        ]
      : [{ kind: 'missing', text: 'Not yet written by the physiotherapist.' }],
    'Clinician',
  );

  const prog = activeProgram(db, patientId) ?? db.programs.filter((x) => x.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const ev = evidenceBlocks(prog?.evidence);
  if (ev.length) add(8, 'Evidence used in the plan', ev);

  return {
    audience: 'clinician',
    state: st.signed && !draft ? 'clinician_reviewed' : 'preliminary',
    staleApproval: st.stale,
    documentVersion: draft ? st.nextVersion : (st.latest?.version ?? 1),
    generatedAt: new Date().toISOString(),
    assessmentId: patientId,
    title: 'Discharge summary',
    templateVersion: DISCHARGE_TEMPLATE,
    patientLabel: `${p.name} · ${patientCode(p.id)}`,
    clinicianName: signer?.name ?? '',
    approvedBy: st.signed && !draft ? signer?.name : undefined,
    approvedAt: st.signed && !draft ? st.latest?.signedAt : undefined,
    sections: S,
  };
}
