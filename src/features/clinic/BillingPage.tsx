import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { BarChart } from '../../components/BarChart';
import { DemoBadge, Notice } from '../../components/ui';
import { patientCode } from '../../clinical/directory';
import { courseProgress, csvRupees, formatINR, localDay, monthlyStatement, parseRupees, patientLedger, toCsv } from '../../clinic/backoffice';
import type { DB, ExpenseCategory, PaymentMethod, TreatmentCourse } from '../../data/models';
import { insert, recordAudit, update, useDb, uuid } from '../../data/store';

/**
 * Billing: treatment courses (agreed sessions and fee), payments received, clinic expenses and a
 * monthly statement. Every amount is entered by staff; balances and totals are sums of those rows.
 */

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };
const CATEGORY_LABEL: Record<ExpenseCategory, string> = { rent: 'Rent', salaries: 'Salaries', utilities: 'Utilities', equipment: 'Equipment', supplies: 'Supplies', software: 'Software', other: 'Other' };

const compactINR = (rupees: number) => (rupees >= 100000 ? `₹${+(rupees / 100000).toFixed(1)}L` : rupees >= 1000 ? `₹${+(rupees / 1000).toFixed(1)}k` : `₹${Math.round(rupees)}`);
const today = () => localDay(new Date().toISOString());
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function download(name: string, csv: string, actorId: string, what: string, rows: number) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  recordAudit(actorId, 'export', what, 'csv', `${rows} rows`);
}

export function BillingPage() {
  const user = useCurrentUser();
  const db = useDb((d) => d);
  if (!user) return null;
  const month = today().slice(0, 7);
  const statement = monthlyStatement(db, month, 12);
  const thisMonth = statement[0];
  const dues = db.patients
    .map((p) => ({ p, l: patientLedger(db, p.id) }))
    .filter((x) => x.l.balancePaise > 0)
    .sort((a, b) => b.l.balancePaise - a.l.balancePaise);
  const totalDue = dues.reduce((s, x) => s + x.l.balancePaise, 0);

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Clinic</p>
          <h1>Billing</h1>
          <p className="muted">Treatment courses, payments, expenses and monthly statements. Figures are totals of what staff record here.</p>
        </div>
        <Link className="btn secondary" to="/c/schedule">
          Schedule
        </Link>
      </div>
      <div className="grid cols-4 overview-stats billing-stats">
        <div className="panel stat-card">
          <div className="small muted">Received in {monthLabel(month)}</div>
          <div className="stat-value num">{formatINR(thisMonth.incomePaise)}</div>
        </div>
        <div className="panel stat-card">
          <div className="small muted">Expenses in {monthLabel(month)}</div>
          <div className="stat-value num">{formatINR(thisMonth.expensePaise)}</div>
        </div>
        <div className="panel stat-card">
          <div className="small muted">Net in {monthLabel(month)}</div>
          <div className="stat-value num">{formatINR(thisMonth.netPaise)}</div>
        </div>
        <div className="panel stat-card">
          <div className="small muted">Outstanding dues</div>
          <div className="stat-value num">{formatINR(totalDue)}</div>
          <div className="xs muted">{dues.length} patient(s)</div>
        </div>
      </div>
      <CoursesPanel db={db} actorId={user.id} />
      <section className="panel stack tight" aria-labelledby="dues-h">
        <h2 id="dues-h">Outstanding dues</h2>
        {dues.length === 0 ? (
          <p className="small muted">No outstanding balances.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th className="num">Agreed fees</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {dues.map(({ p, l }) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/c/patients/${p.id}`}>{p.name}</Link> <span className="xs muted mono">{patientCode(p.id)}</span> {p.isDemo && <DemoBadge />}
                    </td>
                    <td className="num">{formatINR(l.billedPaise)}</td>
                    <td className="num">{formatINR(l.paidPaise)}</td>
                    <td className="num">
                      <strong>{formatINR(l.balancePaise)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PaymentsPanel db={db} actorId={user.id} />
      <ExpensesPanel db={db} actorId={user.id} />
      <section className="panel stack tight" aria-labelledby="stmt-h">
        <div className="row between wrap">
          <h2 id="stmt-h">Monthly statement (last 12 months)</h2>
          <button
            className="btn ghost sm"
            onClick={() =>
              download(
                `statement-${month}.csv`,
                toCsv(['Month', 'Received (INR)', 'Expenses (INR)', 'Net (INR)'], statement.map((r) => [r.month, csvRupees(r.incomePaise), csvRupees(r.expensePaise), csvRupees(r.netPaise)])),
                user.id,
                'statement',
                statement.length,
              )
            }
          >
            Export CSV
          </button>
        </div>
        <BarChart
          title="Money received and expenses per month (₹)"
          categories={[...statement].reverse().map((r) => monthLabel(r.month))}
          series={[
            { id: 'income', label: 'Received', color: '#0F766E' },
            { id: 'expense', label: 'Expenses', color: '#B45309', hatched: true },
          ]}
          values={[[...statement].reverse().map((r) => r.incomePaise / 100), [...statement].reverse().map((r) => r.expensePaise / 100)]}
          format={compactINR}
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Received</th>
                <th className="num">Expenses</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {statement.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num">{formatINR(r.incomePaise)}</td>
                  <td className="num">{formatINR(r.expensePaise)}</td>
                  <td className="num">{formatINR(r.netPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted">Received = payments recorded on that date. Fees agreed but not yet paid are shown under outstanding dues, not as income.</p>
      </section>
    </div>
  );
}

function CoursesPanel({ db, actorId }: { db: DB; actorId: string }) {
  const patients = useMemo(() => [...db.patients].sort((a, b) => a.name.localeCompare(b.name)), [db.patients]);
  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [sessions, setSessions] = useState('');
  const [fee, setFee] = useState('');
  const [start, setStart] = useState(today());
  const courses = [...(db.treatmentCourses ?? [])].sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.startDate.localeCompare(a.startDate));
  const n = Number(sessions);
  const feePaise = parseRupees(fee);
  const valid = !!patientId && title.trim().length > 0 && Number.isInteger(n) && n > 0 && n <= 200 && feePaise !== null;
  const patient = db.patients.find((p) => p.id === patientId);
  const setStatus = (c: TreatmentCourse, status: TreatmentCourse['status']) => update('treatmentCourses', c.id, { status }, actorId);
  return (
    <section className="panel stack tight" aria-labelledby="courses-h">
      <div className="row between wrap">
        <h2 id="courses-h">Treatment courses</h2>
        <button
          className="btn ghost sm"
          disabled={!courses.length}
          onClick={() =>
            download(
              `courses-${today()}.csv`,
              toCsv(
                ['Patient code', 'Patient', 'Course', 'Start', 'Status', 'Planned sessions', 'Attended', 'Missed', 'Agreed fee (INR)'],
                courses.map((c) => {
                  const p = db.patients.find((x) => x.id === c.patientId);
                  const pr = courseProgress(db, c);
                  return [patientCode(c.patientId), p?.name ?? '', c.title, c.startDate, c.status, c.plannedSessions, pr.attended, pr.missed, csvRupees(c.feePaise)];
                }),
              ),
              actorId,
              'treatmentCourses',
              courses.length,
            )
          }
        >
          Export CSV
        </button>
      </div>
      <p className="xs muted">Attended and missed are counted from visits marked on the schedule. Courses do not show recovery: that is judged by the physiotherapist from assessments.</p>
      {courses.length === 0 ? (
        <p className="small muted">No courses yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Course</th>
                <th>Sessions</th>
                <th className="num">Agreed fee</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const p = db.patients.find((x) => x.id === c.patientId);
                const pr = courseProgress(db, c);
                return (
                  <tr key={c.id}>
                    <td>
                      {p ? <Link to={`/c/patients/${p.id}`}>{p.name}</Link> : 'Unknown'} {c.isDemo && <DemoBadge />}
                    </td>
                    <td>
                      {c.title}
                      <div className="xs muted">from {c.startDate}</div>
                    </td>
                    <td>
                      <div className="course-bar" role="img" aria-label={`${pr.attended} of ${c.plannedSessions} sessions attended`}>
                        <span style={{ width: `${Math.min(100, (pr.attended / c.plannedSessions) * 100)}%` }} />
                      </div>
                      <div className="xs muted">
                        {pr.attended}/{c.plannedSessions} attended{pr.missed ? ` · ${pr.missed} missed` : ''}
                        {pr.booked ? ` · ${pr.booked} booked` : ''}
                      </div>
                    </td>
                    <td className="num">{formatINR(c.feePaise)}</td>
                    <td>
                      <span className={`badge ${c.status === 'active' ? 'ok' : ''}`}>{c.status}</span>
                    </td>
                    <td>
                      {c.status === 'active' ? (
                        <span className="row" style={{ gap: '0.3rem' }}>
                          <button className="btn ghost sm" onClick={() => setStatus(c, 'completed')}>
                            Complete
                          </button>
                          <button className="btn ghost sm" onClick={() => setStatus(c, 'stopped')}>
                            Stop
                          </button>
                        </span>
                      ) : (
                        <button className="btn ghost sm" onClick={() => setStatus(c, 'active')}>
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h3>New course</h3>
      <div className="form-grid">
        <label className="field grow">
          <span>Patient</span>
          <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">Select…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {patientCode(p.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Course name</span>
          <input className="input" value={title} placeholder="e.g. Knee rehabilitation" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Planned sessions</span>
          <input className="input" inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} />
        </label>
        <label className="field">
          <span>Agreed fee (₹)</span>
          <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="field">
          <span>Start date</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <button
          className="btn primary sm"
          disabled={!valid}
          onClick={() => {
            insert('treatmentCourses', { id: uuid(), patientId, title: title.trim(), plannedSessions: n, feePaise: feePaise!, startDate: start, status: 'active', createdBy: actorId, createdAt: new Date().toISOString(), isDemo: patient?.isDemo }, actorId, 'course');
            setTitle('');
            setSessions('');
            setFee('');
          }}
        >
          Add course
        </button>
      </div>
      {fee && feePaise === null && <Notice tone="warn">Enter the fee in rupees, for example 4500 or 4500.50.</Notice>}
    </section>
  );
}

function PaymentsPanel({ db, actorId }: { db: DB; actorId: string }) {
  const patients = useMemo(() => [...db.patients].sort((a, b) => a.name.localeCompare(b.name)), [db.patients]);
  const [patientId, setPatientId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const paise = parseRupees(amount);
  const patient = db.patients.find((p) => p.id === patientId);
  const courses = (db.treatmentCourses ?? []).filter((c) => c.patientId === patientId);
  const list = [...(db.payments ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const ledger = patientId ? patientLedger(db, patientId) : null;
  return (
    <section className="panel stack tight" aria-labelledby="pay-h">
      <div className="row between wrap">
        <h2 id="pay-h">Payments received</h2>
        <button
          className="btn ghost sm"
          disabled={!list.length}
          onClick={() =>
            download(
              `payments-${today()}.csv`,
              toCsv(
                ['Date', 'Patient code', 'Patient', 'Course', 'Amount (INR)', 'Method', 'Reference'],
                list.map((x) => [x.date, patientCode(x.patientId), db.patients.find((p) => p.id === x.patientId)?.name ?? '', (db.treatmentCourses ?? []).find((c) => c.id === x.courseId)?.title ?? '', csvRupees(x.amountPaise), METHOD_LABEL[x.method], x.reference ?? '']),
              ),
              actorId,
              'payments',
              list.length,
            )
          }
        >
          Export CSV
        </button>
      </div>
      <div className="form-grid">
        <label className="field grow">
          <span>Patient</span>
          <select className="input" value={patientId} onChange={(e) => { setPatientId(e.target.value); setCourseId(''); }}>
            <option value="">Select…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {patientCode(p.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Course</span>
          <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!courses.length}>
            <option value="">{courses.length ? 'General' : 'No course'}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Amount (₹)</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Method</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Reference (optional)</span>
          <input className="input" value={reference} placeholder="UPI ref, receipt no." onChange={(e) => setReference(e.target.value)} />
        </label>
        <button
          className="btn primary sm"
          disabled={!patient || !paise || !date}
          onClick={() => {
            insert('payments', { id: uuid(), patientId, courseId: courseId || undefined, amountPaise: paise!, method, date, reference: reference.trim() || undefined, createdBy: actorId, createdAt: new Date().toISOString(), isDemo: patient?.isDemo }, actorId, 'payment');
            setAmount('');
            setReference('');
          }}
        >
          Record payment
        </button>
      </div>
      {ledger && (
        <p className="small">
          {patient?.name}: agreed {formatINR(ledger.billedPaise)} · paid {formatINR(ledger.paidPaise)} · balance <strong>{formatINR(ledger.balancePaise)}</strong>
        </p>
      )}
      {amount && paise === null && <Notice tone="warn">Enter the amount in rupees, for example 1500 or 1500.50.</Notice>}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((x) => (
                <tr key={x.id}>
                  <td>{x.date}</td>
                  <td>{db.patients.find((p) => p.id === x.patientId)?.name ?? 'Unknown'}</td>
                  <td>{METHOD_LABEL[x.method]}</td>
                  <td className="xs">{x.reference ?? ''}</td>
                  <td className="num">{formatINR(x.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 50 && <p className="xs muted">Showing the latest 50 of {list.length}. Export for the full list.</p>}
        </div>
      )}
    </section>
  );
}

function ExpensesPanel({ db, actorId }: { db: DB; actorId: string }) {
  const [category, setCategory] = useState<ExpenseCategory>('rent');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [vendor, setVendor] = useState('');
  const paise = parseRupees(amount);
  const list = [...(db.expenses ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="panel stack tight" aria-labelledby="exp-h">
      <div className="row between wrap">
        <h2 id="exp-h">Expenses</h2>
        <button
          className="btn ghost sm"
          disabled={!list.length}
          onClick={() => download(`expenses-${today()}.csv`, toCsv(['Date', 'Category', 'Description', 'Vendor', 'Amount (INR)'], list.map((x) => [x.date, CATEGORY_LABEL[x.category], x.title, x.vendor ?? '', csvRupees(x.amountPaise)])), actorId, 'expenses', list.length)}
        >
          Export CSV
        </button>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {(Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Description</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Amount (₹)</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Paid to (optional)</span>
          <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>
        <button
          className="btn primary sm"
          disabled={!title.trim() || !paise || !date}
          onClick={() => {
            insert('expenses', { id: uuid(), category, title: title.trim(), amountPaise: paise!, date, vendor: vendor.trim() || undefined, createdBy: actorId, createdAt: new Date().toISOString() }, actorId, 'expense');
            setTitle('');
            setAmount('');
            setVendor('');
          }}
        >
          Add expense
        </button>
      </div>
      {amount && paise === null && <Notice tone="warn">Enter the amount in rupees, for example 25000.</Notice>}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((x) => (
                <tr key={x.id}>
                  <td>{x.date}</td>
                  <td>{CATEGORY_LABEL[x.category]}</td>
                  <td>
                    {x.title}
                    {x.vendor ? <div className="xs muted">{x.vendor}</div> : null}
                  </td>
                  <td className="num">{formatINR(x.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
