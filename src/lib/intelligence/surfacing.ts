/**
 * Conversation Intelligence surfacing — turns stored loops/follow-ups into a
 * compact prompt fragment.
 *
 * SURFACING BUDGET: at most ONE open loop and ONE follow-up per call, chosen by
 * highest salience/value. The cap lives HERE in code, never in the prompt, so
 * Marcus can never dump a backlog. The returned follow-up is marked 'surfaced'
 * so it is not repeated next turn; the rest are held back.
 *
 * NOT WIRED YET. getMemoryContext (memory-manager.ts) does not call this. To
 * attach later, append its non-empty return to the string getMemoryContext
 * builds (which already flows into the prompt via buildSystemPrompt's
 * memoryContext param) — e.g. `context += '\n\n' + await getConversationIntelligenceContext(userId)`.
 */

import { query } from '../db';

export async function getConversationIntelligenceContext(userId: string): Promise<string> {
  try {
    const [loopRes, followRes] = await Promise.all([
      query(
        `SELECT summary FROM open_loops
         WHERE user_id = $1 AND status = 'open'
         ORDER BY salience DESC, last_seen_at DESC
         LIMIT 1`,
        [userId],
      ),
      query(
        `SELECT id, prompt FROM follow_ups
         WHERE user_id = $1 AND status = 'pending' AND (due_at IS NULL OR due_at <= NOW())
         ORDER BY value DESC, created_at ASC
         LIMIT 1`,
        [userId],
      ),
    ]);

    const parts: string[] = [];

    if (loopRes.rows.length > 0) {
      parts.push(`OPEN LOOP (unresolved — reference naturally if it fits, do not interrogate):\n- ${loopRes.rows[0].summary}`);
    }

    if (followRes.rows.length > 0) {
      const f = followRes.rows[0] as { id: string; prompt: string };
      parts.push(`READY TO FOLLOW UP ON:\n- ${f.prompt}`);
      // Consume the budget: mark surfaced so it is not repeated next turn.
      await query(`UPDATE follow_ups SET status = 'surfaced', surfaced_at = NOW() WHERE id = $1`, [f.id]);
    }

    return parts.join('\n\n');
  } catch (err) {
    console.warn('[CI] surfacing failed:', err);
    return '';
  }
}
