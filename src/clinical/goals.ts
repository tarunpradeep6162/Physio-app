import type { GoalRating, ID, PatientGoal } from '../data/models';

/**
 * Phase 47: patient goals. A goal is the patient's own words, agreed with the physiotherapist; the
 * app never writes or suggests one. Progress is the patient's own 0–10 rating, kept verbatim and
 * separate from camera estimates; nothing converts a measurement into goal progress.
 */
export const GOAL_TEXT = { min: 3, max: 300 } as const;

export function validateGoalText(text: string): string | null {
  const t = text.trim();
  if (t.length < GOAL_TEXT.min) return 'Write the goal in a few words.';
  if (t.length > GOAL_TEXT.max) return `Keep the goal under ${GOAL_TEXT.max} characters.`;
  return null;
}

export function validateRating(rating: number): string | null {
  return Number.isInteger(rating) && rating >= 0 && rating <= 10 ? null : 'Choose a whole number from 0 to 10.';
}

/** Ratings for one goal, oldest first. */
export function ratingsFor(goalId: ID, ratings: GoalRating[]): GoalRating[] {
  return ratings.filter((r) => r.goalId === goalId).sort((a, b) => a.ratedAt.localeCompare(b.ratedAt));
}

export interface GoalView {
  goal: PatientGoal;
  ratings: GoalRating[];
  latest: GoalRating | null;
  /** Latest minus first rating, when there are at least two; descriptive only. */
  change: number | null;
}

export function goalViews(patientId: ID, goals: PatientGoal[], ratings: GoalRating[]): GoalView[] {
  const order = { active: 0, achieved: 1, withdrawn: 2 } as const;
  return goals
    .filter((g) => g.patientId === patientId)
    .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt))
    .map((goal) => {
      const rs = ratingsFor(goal.id, ratings);
      const latest = rs.at(-1) ?? null;
      return { goal, ratings: rs, latest, change: rs.length >= 2 ? latest!.rating - rs[0].rating : null };
    });
}
