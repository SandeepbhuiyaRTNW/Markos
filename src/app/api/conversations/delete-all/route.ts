import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/conversations/delete-all   body: { userId }
 * DELETE-ALL-CONVERSATIONS, MEMORY KEPT (YOUR DATA level 2).
 *
 * Removes every conversation the user has had and everything scoped to a conversation,
 * but KEEPS what Marcus knows about him:
 *   removed:  messages, session_notes, kwml_profiles, reflections,
 *             conversation_intelligence (CASCADE), conversations
 *   KEPT:     memory_layers (his memory), open_loops, follow_ups (SET NULL on delete)
 * memory_layers.source_message_id has no cascade, so it is NULL'd first to preserve the row.
 */
export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try { userId = (await req.json())?.userId; } catch { /* ignore */ }
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  try {
    const convScope = `(SELECT id FROM conversations WHERE user_id = $1)`;
    // Preserve memory rows: drop only their link to messages we're about to remove.
    await query(`UPDATE memory_layers SET source_message_id = NULL WHERE source_message_id IN (SELECT id FROM messages WHERE conversation_id IN ${convScope})`, [userId]);
    await query(`DELETE FROM session_notes WHERE conversation_id IN ${convScope}`, [userId]);
    await query(`DELETE FROM kwml_profiles WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM reflections WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM messages WHERE conversation_id IN ${convScope}`, [userId]);
    await query(`DELETE FROM conversations WHERE user_id = $1`, [userId]);
    console.log(`[DeleteAll] cleared conversations for user ${userId}, memory kept`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('delete-all error:', error);
    return NextResponse.json({ error: 'Failed to delete conversations' }, { status: 500 });
  }
}
