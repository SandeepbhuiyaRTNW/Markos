/**
 * Framework Interview persistence — Postgres. The ONLY DB touchpoint for the
 * framework machinery; session.ts stays pure.
 * Table: scripts/migrate-framework-interview-sessions.sql.
 *
 * One row per user (UNIQUE user_id): the interview is a single long arc across
 * sittings, not a per-conversation object. `state` is the whole
 * FrameworkInterviewState as JSONB — answers included — so the instrument can
 * grow (themes, follow-ups) without further migrations. A run's answers are
 * the point of the interview; they live in state.answers and are readable
 * back through GET /api/framework-interview for the before/after comparison.
 */

import { query } from '../../db';
import { EMPTY_FRAMEWORK_STATE, type FrameworkInterviewState } from './session';

export async function loadFrameworkState(userId: string): Promise<FrameworkInterviewState> {
  const res = await query(
    `SELECT state FROM framework_interview_sessions WHERE user_id = $1`,
    [userId],
  );
  if (res.rows.length === 0) return { ...EMPTY_FRAMEWORK_STATE };
  return { ...EMPTY_FRAMEWORK_STATE, ...(res.rows[0].state as Partial<FrameworkInterviewState>) };
}

export async function saveFrameworkState(userId: string, state: FrameworkInterviewState): Promise<void> {
  await query(
    `INSERT INTO framework_interview_sessions (user_id, state, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = NOW()`,
    [userId, JSON.stringify(state)],
  );
}
