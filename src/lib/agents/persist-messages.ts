/**
 * persistTurnMessages — the SINGLE writer for a turn's two conversation messages
 * (the user's utterance + Marcus's reply).
 *
 * W1 fix: message persistence used to live ONLY on the composer path
 * (orchestrator-v2-composer.ts · storeInBackground). The four sentinel short-circuits
 * — acute crisis, post-crisis retreat, AI-honesty, frame-refusal — return a
 * user-visible response BEFORE the composer runs and therefore wrote nothing, dropping
 * the exchange from history. This writer is now called from EVERY path that returns a
 * user-visible response: the composer path (via storeInBackground) and the sentinel
 * short-circuits (via buildResponse in orchestrator-v2.ts). One writer; one place that
 * inserts into `messages`.
 *
 * Scope: writes ONLY the two messages. The higher tiers (memory extraction, KWML
 * profile, conversation-intelligence) stay composer-only — they depend on Assessment-
 * Ring output the sentinel paths intentionally skip.
 *
 * Await policy: awaitable, but callers decide. The composer path keeps it
 * fire-and-forget (W4 — adding the await is deferred pending the turn_logs↔messages
 * reconciliation). It NEVER throws: a DB failure is logged loudly with the session
 * identifiers and swallowed, so a write hiccup cannot break the turn's response.
 *
 * @returns the inserted user-message id (needed by the composer's downstream memory
 *          extraction), or null when there was nothing to persist or the write failed.
 */
import { query as defaultQuery } from '../db';
import type { StateEnvelope } from './state-envelope';

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Array<{ id?: string }> }>;

export async function persistTurnMessages(
  env: StateEnvelope,
  queryFn: QueryFn = defaultQuery,
): Promise<string | null> {
  const marcusText = env.final_response;
  if (!marcusText) {
    // No user-visible response was produced this turn — nothing to persist.
    return null;
  }
  try {
    const userMsgResult = await queryFn(
      `INSERT INTO messages (conversation_id, role, content, emotion_detected, understanding_layer, kwml_archetype)
       VALUES ($1, 'user', $2, $3, $4, $5) RETURNING id`,
      [env.conversation_id, env.utterance,
       env.sentinels.listener_stack?.primary_emotion || null,
       env.sentinels.listener_stack?.depth_level || null,
       env.assessment.archetype?.active || null],
    );
    const userMsgId = userMsgResult.rows[0]?.id ?? null;

    await queryFn(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'marcus', $2)`,
      [env.conversation_id, marcusText],
    );

    return userMsgId;
  } catch (err) {
    // Never swallow silently: a dropped message write is exactly the defect we are
    // trying to eliminate. Log with the session identifiers so it is traceable.
    console.error(
      `[persistTurnMessages] FAILED to write messages — user_id=${env.user_id} conversation_id=${env.conversation_id} turn_id=${env.turn_id}:`,
      err,
    );
    return null;
  }
}
