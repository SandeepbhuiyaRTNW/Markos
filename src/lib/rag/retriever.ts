import OpenAI from 'openai';
import { query } from '../db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
    dimensions: 3072,
  });
  return response.data[0].embedding;
}

export async function retrieveWisdom(
  userMessage: string,
  limit: number = 5
): Promise<string> {
  try {
    const embedding = await getEmbedding(userMessage);
    const vectorStr = `[${embedding.join(',')}]`;

    // Search book embeddings
    const result = await query(
      `SELECT content, source_title, 1 - (embedding <=> $1::vector) as similarity
       FROM embeddings
       WHERE source_type = 'book'
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorStr, limit]
    );

    if (result.rows.length === 0) return 'No wisdom passages found in the library yet.';

    return result.rows
      .map((r: { source_title: string; content: string; similarity: number }) =>
        `[${r.source_title}] (relevance: ${(r.similarity * 100).toFixed(0)}%)\n${r.content}`
      )
      .join('\n\n---\n\n');
  } catch (error) {
    console.error('RAG retrieval error:', error);
    return 'Wisdom retrieval temporarily unavailable.';
  }
}

export async function retrieveQuestion(
  context: string,
  archetype?: string,
  functionType?: string,
  limit: number = 3
): Promise<string[]> {
  try {
    const embedding = await getEmbedding(context);
    const vectorStr = `[${embedding.join(',')}]`;

    let sql = `SELECT question_text, archetype, function, depth_level
               FROM questions WHERE 1=1`;
    const params: unknown[] = [];
    let paramIdx = 1;

    if (archetype) {
      sql += ` AND archetype = $${paramIdx++}`;
      params.push(archetype);
    }
    if (functionType) {
      sql += ` AND function = $${paramIdx++}`;
      params.push(functionType);
    }

    sql += ` ORDER BY embedding <=> $${paramIdx}::vector LIMIT $${paramIdx + 1}`;
    params.push(vectorStr, limit);

    const result = await query(sql, params);
    return result.rows.map((r: { question_text: string }) => r.question_text);
  } catch (error) {
    console.error('Question retrieval error:', error);
    return [];
  }
}

