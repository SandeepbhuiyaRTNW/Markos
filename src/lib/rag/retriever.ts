import OpenAI from 'openai';
import { query } from '../db';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
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
      `SELECT content, source_title, source_type, 1 - (embedding <=> $1::vector) as similarity
       FROM embeddings
       WHERE source_type IN ('book', 'doc')
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

        const rerank = await getOpenAI().chat.completions.create({
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

/**
 * Question retrieval context — passed from the orchestrator so the algorithm
 * can gate by trust/depth, align to archetype/shadow, and enforce deployment gates.
 */
export interface QuestionRetrievalContext {
  sessionCount: number;          // how many sessions this user has had
  emotionDetected?: string;      // primary emotion from understanding stack
  archetype?: string;            // KWML archetype detected this turn
  shadow?: string;               // shadow archetype detected this turn
  arena?: string;                // life arena detected (career, relationship, etc.)
  previousQuestionIds?: string[]; // question_ids already used this session (avoid repeat)
  permaCoverage?: string[];      // PERMA domains already covered in session
}

/** Map session count to maximum allowed depth level */
function getMaxDepth(sessionCount: number): number {
  if (sessionCount <= 2) return 2;
  if (sessionCount <= 5) return 3;
  if (sessionCount <= 10) return 4;
  if (sessionCount <= 15) return 4;
  return 5;
}

/** Map session count to trust level label */
function getTrustLevel(sessionCount: number): string {
  if (sessionCount <= 2) return 'new';
  if (sessionCount <= 5) return 'developing';
  if (sessionCount <= 15) return 'established';
  return 'deep';
}

/**
 * 10-Step Question Retrieval Algorithm (from IntelBase v8 Retrieval Logic)
 *
 * 1. Arena detection — filter by arena if detected
 * 2. Emotional state — semantic similarity to user message
 * 3. Depth level — within maxDepth +/- 1 for current trust level
 * 4. Trust calibration — gate by session count
 * 5. Archetype alignment — prefer matching archetype
 * 6. Shadow detection — if shadow detected, include shadow-specific questions
 * 7. Risk polarity — avoid high-risk unless trust is deep
 * 8. Effectiveness score — weight by effectiveness_score
 * 9. PERMA domain coverage — prefer uncovered domains
 * 10. Conversational flow — avoid recently used questions
 *
 * Plus: Deployment gate enforcement — gated series are excluded unless context allows.
 */
export async function retrieveQuestion(
  context: string,
  archetype?: string,
  functionType?: string,
  limit: number = 3,
  retrievalCtx?: QuestionRetrievalContext,
): Promise<string[]> {
  try {
    const embedding = await getEmbedding(context);
    const vectorStr = `[${embedding.join(',')}]`;

    const sessionCount = retrievalCtx?.sessionCount ?? 1;
    const maxDepth = getMaxDepth(sessionCount);
    const trustLevel = getTrustLevel(sessionCount);

    // Step 1-4: Build base query with arena, depth, and trust filters
    let sql = `SELECT question_id, question_text, archetype, shadow, function,
               depth_level, arena, risk_polarity, emotion_context, perma_domain,
               trust_level, effectiveness_score, deployment_gate,
               1 - (embedding <=> $1::vector) as similarity
               FROM questions WHERE depth_level <= $2`;
    const params: unknown[] = [vectorStr, maxDepth];
    let paramIdx = 3;

    // Step 1: Arena filter (soft — prefer matching arena but include general)
    if (retrievalCtx?.arena) {
      sql += ` AND (arena ILIKE $${paramIdx} OR arena = '' OR arena IS NULL OR arena ILIKE '%general%')`;
      params.push(`%${retrievalCtx.arena}%`);
      paramIdx++;
    }

    // Step 7: Risk polarity — exclude high-risk unless trust is deep
    if (trustLevel !== 'deep') {
      sql += ` AND (risk_polarity IS NULL OR risk_polarity = '' OR risk_polarity NOT ILIKE '%high%')`;
    }

    // Step 10: Avoid recently used questions
    if (retrievalCtx?.previousQuestionIds && retrievalCtx.previousQuestionIds.length > 0) {
      sql += ` AND (question_id IS NULL OR question_id != ALL($${paramIdx}::text[]))`;
      params.push(retrievalCtx.previousQuestionIds);
      paramIdx++;
    }

    // Deployment gate enforcement — exclude gated questions unless trust allows
    if (trustLevel === 'new' || trustLevel === 'developing') {
      sql += ` AND (deployment_gate IS NULL)`;
    } else if (trustLevel === 'established') {
      // Allow some gated questions but not the most sensitive
      sql += ` AND (deployment_gate IS NULL OR NOT (deployment_gate ? 'trust_required' AND deployment_gate->>'trust_required' = 'deep'))`;
    }
    // 'deep' trust — all gates open (the context itself will be validated by the agent)

    // Fetch wide candidate pool, ordered by semantic similarity
    const candidateLimit = Math.max(limit * 5, 20);
    sql += ` ORDER BY embedding <=> $1::vector LIMIT ${candidateLimit}`;

    const result = await query(sql, params);
    if (result.rows.length === 0) return [];

    // Step 5-6, 8-9: Score and re-rank candidates
    interface QRow {
      question_id: string; question_text: string; archetype: string; shadow: string;
      function: string; depth_level: number; arena: string; risk_polarity: string;
      emotion_context: string; perma_domain: string; trust_level: string;
      effectiveness_score: number; deployment_gate: unknown; similarity: number;
    }

    const scored = result.rows.map((r: QRow) => {
      let score = r.similarity * 40; // Base: semantic relevance (0-40 points)

      // Step 5: Archetype alignment (+15 if matches)
      if (retrievalCtx?.archetype && r.archetype) {
        if (r.archetype.toLowerCase().includes(retrievalCtx.archetype.toLowerCase())) {
          score += 15;
        }
      }

      // Step 6: Shadow alignment (+10 if shadow matches)
      if (retrievalCtx?.shadow && r.shadow) {
        if (r.shadow.toLowerCase().includes(retrievalCtx.shadow.toLowerCase())) {
          score += 10;
        }
      }

      // Step 8: Effectiveness score weighting (+0-10)
      score += (r.effectiveness_score || 0.5) * 10;

      // Step 9: PERMA domain coverage — boost uncovered domains
      if (retrievalCtx?.permaCoverage && r.perma_domain) {
        const domain = r.perma_domain.toLowerCase();
        const alreadyCovered = retrievalCtx.permaCoverage.some(
          (p) => p.toLowerCase() === domain
        );
        if (!alreadyCovered) score += 8; // Prefer uncovered PERMA domains
      }

      // Depth appropriateness bonus — prefer depth close to session-appropriate level
      const idealDepth = Math.min(Math.ceil(sessionCount / 3), maxDepth);
      const depthDiff = Math.abs(r.depth_level - idealDepth);
      score += Math.max(0, 5 - depthDiff * 2);

      // Function type match bonus
      if (functionType && r.function && r.function.toLowerCase().includes(functionType.toLowerCase())) {
        score += 5;
      }

      return { ...r, score };
    });

    // Sort by composite score descending
    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    // Return top-N question texts
    return scored.slice(0, limit).map((r: { question_text: string }) => r.question_text);
  } catch (error) {
    console.error('Question retrieval error:', error);
    return [];
  }
}

