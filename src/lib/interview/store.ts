/**
 * Interview session persistence — Postgres. The ONLY DB touchpoint for the
 * interview machinery; session.ts stays pure. Table: scripts/migrate-interview-sessions.sql.
 *
 * One row per user (UNIQUE user_id): the interview is a single long arc across
 * sittings, not a per-conversation object. `state` is the whole InterviewState
 * as JSONB so the skeleton can grow (gate detail, per-section notes) without
 * further migrations.
 */

import { query } from '../db';
import { EMPTY_INTERVIEW_STATE, type InterviewState } from './session';

export async function loadInterviewState(userId: string): Promise<InterviewState> {
  const res = await query(
    `SELECT state FROM interview_sessions WHERE user_id = $1`,
    [userId],
  );
  if (res.rows.length === 0) return { ...EMPTY_INTERVIEW_STATE };
  return { ...EMPTY_INTERVIEW_STATE, ...(res.rows[0].state as Partial<InterviewState>) };
}

export async function saveInterviewState(userId: string, state: InterviewState): Promise<void> {
  await query(
    `INSERT INTO interview_sessions (user_id, state, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = NOW()`,
    [userId, JSON.stringify(state)],
  );
}
