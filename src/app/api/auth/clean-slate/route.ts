import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/auth/clean-slate
 * Deletes all conversations, messages, memories, and profiles for a user.
 * Gives the user a completely fresh start.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId;

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Delete in dependency order to respect foreign keys
    // 1. memory_layers (references messages)
    await query(
      `DELETE FROM memory_layers WHERE user_id = $1`,
      [userId]
    );

    // 2. kwml_profiles (references conversations)
    await query(
      `DELETE FROM kwml_profiles WHERE user_id = $1`,
      [userId]
    );

    // 3. session_notes (references conversations)
    await query(
      `DELETE FROM session_notes WHERE conversation_id IN (
        SELECT id FROM conversations WHERE user_id = $1
      )`,
      [userId]
    );

    // 4. messages (references conversations)
    await query(
      `DELETE FROM messages WHERE conversation_id IN (
        SELECT id FROM conversations WHERE user_id = $1
      )`,
      [userId]
    );

    // 5. conversations
    await query(
      `DELETE FROM conversations WHERE user_id = $1`,
      [userId]
    );

    console.log(`[CleanSlate] 🧹 Wiped all data for user ${userId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[CleanSlate] Error:', errMsg);
    return NextResponse.json({ error: `Failed to clean slate: ${errMsg}` }, { status: 500 });
  }
}

