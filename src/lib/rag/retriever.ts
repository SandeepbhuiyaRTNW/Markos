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

/**
 * Advanced RAG retrieval with contextual re-ranking.
 * 1. Embeds the user message
 * 2. Fetches top-N candidates via pgvector cosine similarity
 * 3. Re-ranks using GPT-4o-mini to select the most contextually relevant passages
 */
export async function retrieveWisdom(
  userMessage: string,
  limit: number = 5,
  conversationContext?: string
): Promise<string> {
  try {
    const embedding = await getEmbedding(userMessage);
    const vectorStr = `[${embedding.join(',')}]`;

    // Fetch 2x candidates for re-ranking (wider net, then narrow)
    const candidateLimit = Math.min(limit * 2, 16);
    const result = await query(
      `SELECT content, source_title, 1 - (embedding <=> $1::vector) as similarity
       FROM embeddings
       WHERE source_type = 'book'
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorStr, candidateLimit]
    );

    if (result.rows.length === 0) return 'No wisdom passages found in the library yet.';

    // If we have conversation context, re-rank using LLM
    if (conversationContext && result.rows.length > limit) {
      try {
        const passages = result.rows.map((r: { source_title: string; content: string; similarity: number }, i: number) =>
          `[${i}] ${r.source_title}: ${r.content.substring(0, 300)}`
        ).join('\n\n');

        const rerank = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a re-ranking agent for a Stoic AI companion. Given a man's message and conversation context, select the ${limit} most relevant wisdom passages from the candidates. Return ONLY a JSON array of indices, e.g. [0, 3, 5, 1, 7]. Choose passages that directly address his emotional state, situation, or that would provide the most powerful Stoic wisdom for his specific moment.`,
            },
            {
              role: 'user',
              content: `His message: "${userMessage}"\n\nConversation context: ${conversationContext.substring(0, 500)}\n\nCandidate passages:\n${passages}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 100,
        });

        const content = rerank.choices[0].message.content || '{}';
        const parsed = JSON.parse(content);
        // Accept either {"indices": [...]} or just [...]
        const indices: number[] = Array.isArray(parsed) ? parsed : (parsed.indices || parsed.rankings || []);

        if (indices.length > 0) {
          const reranked = indices
            .filter((i: number) => i >= 0 && i < result.rows.length)
            .slice(0, limit)
            .map((i: number) => result.rows[i]);

          if (reranked.length > 0) {
            return reranked
              .map((r: { source_title: string; content: string; similarity: number }) =>
                `[${r.source_title}] (relevance: ${(r.similarity * 100).toFixed(0)}%)\n${r.content}`
              )
              .join('\n\n---\n\n');
          }
        }
      } catch (rerankErr) {
        console.warn('[RAG] Re-ranking failed, using similarity order:', rerankErr);
      }
    }

    // Fallback: use top-N by similarity (also deduplicate by source for diversity)
    const seen = new Set<string>();
    const diverse: typeof result.rows = [];
    for (const row of result.rows) {
      if (diverse.length >= limit) break;
      const key = row.source_title;
      if (seen.size < limit - 1 || !seen.has(key)) {
        diverse.push(row);
        seen.add(key);
      }
    }

    return diverse
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

