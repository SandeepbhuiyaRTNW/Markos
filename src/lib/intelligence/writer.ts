/**
 * Conversation Intelligence writer — all DB writes for the CI layer.
 * Every function is best-effort and parameterized; the caller runs them
 * fire-and-forget off the critical path.
 */

import { query } from '../db';
import type { ArcPoint, CIExtraction, ExistingLoop } from './types';

// A loop that has not been referenced in this many sessions flips to 'dormant'
// so Marcus never surfaces a stale thread as if it were live.
export const LOOP_DORMANT_AFTER_SESSIONS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function clamp01(n: unknown, dflt = 0.5): number {
  const x = typeof n === 'number' && isFinite(n) ? n : dflt;
  return Math.max(0, Math.min(1, x));
}

function normalizeTrigger(t: unknown): 'next_session' | 'time' | 'event' {
  return t === 'time' || t === 'event' ? t : 'next_session';
}

/**
 * Cheap, every-turn: create the conversation_intelligence row if needed and
 * append one arc point. UNIQUE(conversation_id) makes this an idempotent upsert.
 */
export async function appendArcPoint(userId: string, conversationId: string, arc: ArcPoint): Promise<void> {
  await query(
    `INSERT INTO conversation_intelligence (user_id, conversation_id, emotional_arc)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (conversation_id) DO UPDATE
       SET emotional_arc = conversation_intelligence.emotional_arc || $3::jsonb,
           updated_at = NOW()`,
    [userId, conversationId, JSON.stringify([arc])],
  );
}

/** Flip open loops not referenced in >= N sessions to 'dormant'. */
export async function markStaleLoopsDormant(
  userId: string,
  currentSession: number,
  staleAfter: number = LOOP_DORMANT_AFTER_SESSIONS,
): Promise<void> {
  await query(
    `UPDATE open_loops SET status = 'dormant'
     WHERE user_id = $1 AND status = 'open'
       AND last_seen_session IS NOT NULL
       AND ($2 - last_seen_session) >= $3`,
    [userId, currentSession, staleAfter],
  );
}

/** Fetch this user's OPEN loops to feed the model (so it can resolve/reference). */
export async function getOpenLoops(userId: string, limit = 20): Promise<ExistingLoop[]> {
  const r = await query(
    `SELECT id, summary FROM open_loops
     WHERE user_id = $1 AND status = 'open'
     ORDER BY salience DESC, last_seen_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row: { id: string; summary: string }) => ({ id: row.id, summary: row.summary }));
}

/** Persist a CI extraction: snapshot the conversation, then loops + follow-ups. */
export async function applyCIExtraction(params: {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  currentSession: number;
  extraction: CIExtraction;
}): Promise<void> {
  const { userId, conversationId, sourceMessageId, currentSession, extraction } = params;

  // 1. Conversation-level snapshot. The row already exists (appendArcPoint ran
  //    first). people is authoritative from the model; vocab moments accumulate.
  await query(
    `UPDATE conversation_intelligence
       SET headline = COALESCE(NULLIF($3, ''), headline),
           what_changed = COALESCE(NULLIF($4, ''), what_changed),
           people = $5::jsonb,
           vocabulary_moments = conversation_intelligence.vocabulary_moments || $6::jsonb,
           updated_at = NOW()
     WHERE conversation_id = $2 AND user_id = $1`,
    [userId, conversationId, extraction.headline || '', extraction.what_changed || '',
     JSON.stringify(extraction.people || []), JSON.stringify(extraction.vocabulary_moments || [])],
  );

  // 2. New open loops.
  for (const loop of extraction.new_open_loops || []) {
    if (!loop || typeof loop.summary !== 'string' || !loop.summary.trim()) continue;
    await query(
      `INSERT INTO open_loops (user_id, opened_conversation_id, source_message_id, summary, salience, people, last_seen_session)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [userId, conversationId, sourceMessageId, loop.summary.trim(), clamp01(loop.salience),
       JSON.stringify(Array.isArray(loop.people) ? loop.people : []), currentSession],
    );
  }

  // 3. Explicitly resolved loops.
  for (const r of extraction.resolved_open_loops || []) {
    if (!r || !isUuid(r.id)) continue;
    await query(
      `UPDATE open_loops
         SET status = 'resolved', resolved_at = NOW(),
             metadata = metadata || jsonb_build_object('resolution', $3::text)
       WHERE id = $2 AND user_id = $1`,
      [userId, r.id, typeof r.resolution === 'string' ? r.resolution : ''],
    );
  }

  // 4. Referenced-but-still-open loops: keep alive (bump last_seen for dormancy).
  const referenced = (extraction.referenced_open_loops || []).filter(isUuid);
  if (referenced.length > 0) {
    await query(
      `UPDATE open_loops SET last_seen_at = NOW(), last_seen_session = $3
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'open'`,
      [userId, referenced, currentSession],
    );
  }

  // 5. Follow-ups.
  for (const f of extraction.follow_ups || []) {
    if (!f || typeof f.prompt !== 'string' || !f.prompt.trim()) continue;
    await query(
      `INSERT INTO follow_ups (user_id, opened_conversation_id, prompt, trigger, value)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, conversationId, f.prompt.trim(), normalizeTrigger(f.trigger), clamp01(f.value)],
    );
  }
}
