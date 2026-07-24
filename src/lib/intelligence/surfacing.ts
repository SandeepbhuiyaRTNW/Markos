/**
 * Conversation Intelligence surfacing — turns stored loops/follow-ups into a
 * compact prompt fragment.
 *
 * SURFACING BUDGET: at most ONE open loop and ONE follow-up per call, chosen by
 * highest salience/value. The cap lives HERE in code, never in the prompt, so
 * Marcus can never dump a backlog. The returned follow-up is marked 'surfaced'
 * so it is not repeated next turn; the rest are held back.
 *
 * WIRED via ci-context.ts (getCICallbackBlock) behind CI_CONTEXT_ENABLED.
 *
 * TWO READ-TIME correctness rules (both timing bugs found on PR #10 review):
 *   Finding 1 — a follow-up must NOT surface in the SAME conversation that created
 *     it (a next_session follow-up written by background extraction would otherwise
 *     surface on the next turn of the same session). Gated by opened_conversation_id
 *     != the current conversation, both in SQL and by the tested predicate
 *     followUpEligibleInConversation (source of truth).
 *   Finding 2 — dormancy is applied at READ time, not only by the background sweep
 *     (markStaleLoopsDormant runs AFTER the response composes, so a newly-stale loop
 *     would otherwise surface once as live). isLoopDormantAtRead mirrors the sweep
 *     exactly and excludes stale loops even while status is still 'open'.
 */

import { query } from '../db';
import { LOOP_DORMANT_AFTER_SESSIONS } from './writer';

// Small over-fetch so the JS gates (read-time dormancy / origin) still find a
// surfaceable candidate when the top-ranked row is filtered out.
const READ_CANDIDATES = 8;

export interface CISurfacingContext {
  conversationId: string;
  currentSession: number;
  staleAfter?: number;
}

/**
 * Finding 2 — READ-TIME dormancy. A loop whose last-seen session is >= staleAfter
 * sessions old is treated as dormant even if the background sweep has not yet
 * flipped status. Mirrors markStaleLoopsDormant EXACTLY: that sweep only dorms
 * rows that HAVE a last_seen_session, so a null last_seen_session stays live here.
 */
export function isLoopDormantAtRead(
  lastSeenSession: number | null | undefined,
  currentSession: number,
  staleAfter: number = LOOP_DORMANT_AFTER_SESSIONS,
): boolean {
  if (lastSeenSession == null) return false;
  return (currentSession - lastSeenSession) >= staleAfter;
}

/**
 * Finding 1 — origin gate. A follow-up never surfaces in the conversation that
 * created it (covers a next_session follow-up trying to surface in the very
 * session that created it). Unknown/null origin is allowed.
 */
export function followUpEligibleInConversation(
  openedConversationId: string | null | undefined,
  currentConversationId: string,
): boolean {
  return openedConversationId == null || openedConversationId !== currentConversationId;
}

export async function getConversationIntelligenceContext(
  userId: string,
  ctx: CISurfacingContext,
): Promise<string> {
  const staleAfter = ctx.staleAfter ?? LOOP_DORMANT_AFTER_SESSIONS;
  try {
    const [loopRes, followRes] = await Promise.all([
      query(
        `SELECT summary, last_seen_session FROM open_loops
         WHERE user_id = $1 AND status = 'open'
         ORDER BY salience DESC, last_seen_at DESC
         LIMIT $2`,
        [userId, READ_CANDIDATES],
      ),
      query(
        // Finding 1: exclude the creating conversation in SQL too (IS DISTINCT FROM
        // keeps NULL-origin rows). The JS predicate below is the tested source of
        // truth and guards against SQL drift.
        `SELECT id, prompt, opened_conversation_id FROM follow_ups
         WHERE user_id = $1 AND status = 'pending' AND (due_at IS NULL OR due_at <= NOW())
           AND opened_conversation_id IS DISTINCT FROM $2
         ORDER BY value DESC, created_at ASC
         LIMIT $3`,
        [userId, ctx.conversationId, READ_CANDIDATES],
      ),
    ]);

    const parts: string[] = [];

    // Loop: first candidate that is NOT dormant at read time (Finding 2).
    const loop = loopRes.rows.find(
      (r: { summary: string; last_seen_session: number | null }) =>
        !isLoopDormantAtRead(r.last_seen_session, ctx.currentSession, staleAfter),
    ) as { summary: string } | undefined;
    if (loop) {
      parts.push(`OPEN LOOP (unresolved — reference naturally if it fits, do not interrogate):\n- ${loop.summary}`);
    }

    // Follow-up: first candidate not from the current conversation (Finding 1).
    const follow = followRes.rows.find(
      (r: { opened_conversation_id: string | null }) =>
        followUpEligibleInConversation(r.opened_conversation_id, ctx.conversationId),
    ) as { id: string; prompt: string } | undefined;
    if (follow) {
      parts.push(`READY TO FOLLOW UP ON:\n- ${follow.prompt}`);
      // Consume the budget: mark surfaced so it is not repeated next turn.
      await query(`UPDATE follow_ups SET status = 'surfaced', surfaced_at = NOW() WHERE id = $1`, [follow.id]);
    }

    return parts.join('\n\n');
  } catch (err) {
    console.warn('[CI] surfacing failed:', err);
    return '';
  }
}
