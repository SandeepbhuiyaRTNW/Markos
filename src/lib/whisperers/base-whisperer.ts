/**
 * Base Whisperer — Running agent base class for Domain Whisperers (Tier 4, §8)
 * Each Whisperer contributes question sets from the intelbase, clinical frameworks,
 * and arena-specific landmines. The man never sees a Whisperer name.
 */

import { query } from '../db';
import { getEmbedding } from '../rag/retriever';
import type { StateEnvelope, WhispererQuestionCandidate } from '../agents/state-envelope';

export interface WhispererResult {
  question_candidates: WhispererQuestionCandidate[];
  frameworks_applied: string[];
  landmines: string[];
  context_notes: string;
}

/**
 * Retrieve questions from the intelbase filtered by whisperer tag and state.
 * Uses the v12 columns: whisperer, silence_type, phase, wisdom_voice.
 */
export async function retrieveWhispererQuestions(
  env: StateEnvelope,
  whispererName: string,
  limit: number = 5,
): Promise<WhispererQuestionCandidate[]> {
  try {
    const embedding = await getEmbedding(env.utterance);
    const vectorStr = `[${embedding.join(',')}]`;

    const sessionCount = env.sentinels.memory.session_count;
    const maxDepth = sessionCount <= 2 ? 2 : sessionCount <= 5 ? 3 : sessionCount <= 15 ? 4 : 5;
    const phase = env.assessment.phase.label;
    const silenceType = env.assessment.silence_type?.label;

    // Build filtered query using v12 columns
    let sql = `SELECT question_id, question_text, whisperer, silence_type, phase,
               wisdom_voice, depth_level, arena, archetype, shadow,
               effectiveness_score, deployment_gate,
               1 - (embedding <=> $1::vector) as similarity
               FROM questions
               WHERE depth_level <= $2
               AND (whisperer = $3 OR whisperer = 'any' OR whisperer IS NULL)`;
    const params: unknown[] = [vectorStr, maxDepth, whispererName];
    let paramIdx = 4;

    // Filter by phase
    if (phase) {
      sql += ` AND (phase = $${paramIdx} OR phase = 'any' OR phase IS NULL)`;
      params.push(phase);
      paramIdx++;
    }

    // Filter by silence type (soft match — prefer matching but allow 'any')
    if (silenceType) {
      sql += ` AND (silence_type = $${paramIdx} OR silence_type = 'any' OR silence_type IS NULL)`;
      params.push(silenceType);
      paramIdx++;
    }

    // Trust gating
    if (sessionCount <= 5) {
      sql += ` AND (deployment_gate IS NULL)`;
    }

    // Archetype boost in scoring, not filtering
    sql += ` ORDER BY embedding <=> $1::vector LIMIT ${limit * 3}`;

    const result = await query(sql, params);

    // Score and return
    return result.rows.map((r: {
      question_id: string; question_text: string; whisperer: string;
      similarity: number; effectiveness_score: number;
      silence_type: string; phase: string;
    }) => {
      let relevance = r.similarity * 0.6 + (r.effectiveness_score || 0.5) * 0.2;
      // Boost exact silence_type match
      if (silenceType && r.silence_type === silenceType) relevance += 0.1;
      // Boost exact phase match
      if (phase && r.phase === phase) relevance += 0.1;

      return {
        question_id: r.question_id,
        text: r.question_text,
        whisperer: r.whisperer || whispererName,
        relevance_score: Math.round(relevance * 100) / 100,
      };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
  } catch (err) {
    console.error(`[${whispererName}Whisperer] Question retrieval error:`, err);
    return [];
  }
}

/**
 * Retrieve training doc chunks for a whisperer from the embeddings table.
 * These are the curated intelligence summaries (not raw book text).
 */
export async function retrieveTrainingContext(
  utterance: string,
  whispererName: string,
  limit: number = 3,
): Promise<string> {
  try {
    const embedding = await getEmbedding(utterance);
    const vectorStr = `[${embedding.join(',')}]`;
    const result = await query(
      `SELECT content, source_title, 1 - (embedding <=> $1::vector) as similarity
       FROM embeddings
       WHERE source_type = 'training_doc'
       AND metadata->>'whisperer' = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorStr, whispererName, limit]
    );
    if (result.rows.length === 0) return '';
    return result.rows.map((r: { content: string; source_title: string }) =>
      `[${r.source_title}]\n${r.content}`
    ).join('\n\n---\n\n');
  } catch {
    return '';
  }
}

