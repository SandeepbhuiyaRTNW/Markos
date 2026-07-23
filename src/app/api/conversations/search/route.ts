import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const q = searchParams.get('q');

  if (!userId || !q || q.trim() === '') {
    return NextResponse.json({ results: [] });
  }

  const searchTerm = `%${q.trim()}%`;

  try {
    const sql = `
      SELECT DISTINCT ON (c.id)
        c.id as conversation_id,
        COALESCE(c.summary, (c.metadata->>'title'), 'Session') as title,
        m.content as snippet,
        c.started_at,
        c.ended_at
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = $1
        AND (
          c.summary ILIKE $2 OR
          (c.metadata->>'title') ILIKE $2 OR
          m.content ILIKE $2
        )
      ORDER BY c.id, m.created_at DESC
      LIMIT 15
    `;

    const result = await query(sql, [userId, searchTerm]);

    return NextResponse.json({ results: result.rows });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Failed to search sessions' }, { status: 500 });
  }
}