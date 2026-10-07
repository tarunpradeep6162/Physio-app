import { useMemo, useState } from 'react';
import { CategoryBadge } from '../../components/ui';
import { goalViews, validateGoalText } from '../../clinical/goals';
import { fmtDate } from '../../data/queries';
import { insert, useDb, uuid } from '../../data/store';

/**
 * Phase 47 (patient side): goals in the patient's own words, and their own 0–10 rating of how close
 * they feel. The app never suggests a goal and never derives progress from camera measurements.
 */
export function MyGoals({ patientId, userId }: { patientId: string; userId: string }) {
  const goals = useDb((d) => d.goals);
  const ratings = useDb((d) => d.goalRatings);
  const views = useMemo(() => goalViews(patientId, goals, ratings).filter((v) => v.goal.status === 'active'), [patientId, goals, ratings]);
  const [text, setText] = useState('');
  const [rating, setRating] = useState<Record<string, number>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const err = text.trim() ? validateGoalText(text) : null;
  const now = () => new Date().toISOString();
  return (
    <section className="panel stack tight" aria-labelledby="my-goals">
      <div className="row between wrap">
        <h2 id="my-goals" style={{ margin: 0 }}>My goals</h2>
        <CategoryBadge kind="pro" />
      </div>
      <p className="small muted" style={{ margin: 0 }}>What would you like to be able to do? Write it in your own words; your physiotherapist will go through it with you.</p>
      {views.map(({ goal, latest }) => (
        <div key={goal.id} className="stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
          <strong>“{goal.text}”</strong>
          <p className="xs muted" style={{ margin: 0 }}>
            {goal.agreedAt ? `Agreed with your physiotherapist on ${fmtDate(goal.agreedAt)}` : 'Not yet discussed with your physiotherapist'}
            {latest ? ` · last rated ${latest.rating}/10 on ${fmtDate(latest.ratedAt)}` : ''}
          </p>
          <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">How close do you feel to this goal today? (0 = not at all, 10 = there)</legend>
            {/* Same touch targets as the pain scale, in a neutral colour: this is not a pain rating. */}
            <div className="nprs" role="radiogroup" aria-label={`Progress towards: ${goal.text}`}>
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} type="button" role="radio" aria-checked={rating[goal.id] === n} aria-label={`${n}`} style={{ ['--sev' as string]: '#0f766e' }} onClick={() => setRating({ ...rating, [goal.id]: n })}>{n}</button>
              ))}
            </div>
          </fieldset>
          <input className="input" aria-label="Note (optional)" placeholder="Note (optional)" value={note[goal.id] ?? ''} onChange={(e) => setNote({ ...note, [goal.id]: e.target.value })} />
          <button className="btn secondary sm" style={{ alignSelf: 'flex-start' }} disabled={rating[goal.id] === undefined} onClick={() => {
            insert('goalRatings', { id: uuid(), goalId: goal.id, patientId, rating: rating[goal.id], note: note[goal.id]?.trim() || undefined, ratedBy: userId, ratedAt: now() }, userId);
            const { [goal.id]: _done, ...rest } = rating;
            setRating(rest);
            setNote({ ...note, [goal.id]: '' });
          }}>Save rating</button>
        </div>
      ))}
      <label className="field" style={{ borderTop: views.length ? '1px solid var(--line)' : undefined, paddingTop: views.length ? '0.75rem' : undefined }}>
        <span>Add a goal</span>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Walk to the temple without stopping" />
      </label>
      {err && <p className="small" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} disabled={!text.trim() || !!err} onClick={() => {
        insert('goals', { id: uuid(), patientId, text: text.trim(), createdBy: userId, createdAt: now(), status: 'active' }, userId);
        setText('');
      }}>Save goal</button>
    </section>
  );
}
