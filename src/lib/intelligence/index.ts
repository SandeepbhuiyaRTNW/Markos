/**
 * Conversation Intelligence — entry point.
 *
 * runConversationIntelligence() is called fire-and-forget from the Composer's
 * storeInBackground (off the critical path), once per turn. Hybrid cadence:
 *   - every turn (no LLM): append an arc point + dormancy sweep + regex signals
 *   - gpt-4o-mini call ONLY when earned (see shouldRunCIExtraction)
 *
 * Writes to the CI tables only. It does NOT feed the live prompt — surfacing
 * (getConversationIntelligenceContext) is written but intentionally not wired.
 */

import type { StateEnvelope } from '../agents/state-envelope';
import { detectLoopSignals } from './loop-signals';
import { shouldRunCIExtraction, extractConversationIntelligence } from './extraction';
import { appendArcPoint, markStaleLoopsDormant, getOpenLoops, applyCIExtraction } from './writer';
import type { ArcPoint } from './types';

export { getConversationIntelligenceContext } from './surfacing';
export { shouldRunCIExtraction, CI_MIN_DEPTH, CI_LLM_EVERY_N_TURNS } from './extraction';
export { LOOP_DORMANT_AFTER_SESSIONS } from './writer';

export async function runConversationIntelligence(env: StateEnvelope, sourceMessageId: string): Promise<void> {
  try {
    const userId = env.user_id;
    const conversationId = env.conversation_id;
    const currentSession = env.sentinels.memory.session_count || 1;
    const depth = env.sentinels.listener_stack?.depth_level || 1;
    const emotion = env.sentinels.listener_stack?.primary_emotion || 'neutral';
    const silenceType = env.assessment.silence_type?.label || null;
    const arena = env.assessment.arena?.primary || null;
    // Current utterance is not yet in conversation_history, so +1.
    const turnNumber = env.conversation_history.filter(m => m.role === 'user').length + 1;

    // 1. Cheap, every turn: append one arc point from already-computed envelope data.
    const arc: ArcPoint = { turn: turnNumber, emotion, depth, silence_type: silenceType, arena };
    await appendArcPoint(userId, conversationId, arc);

    // 2. Cheap, every turn: dormancy sweep so stale loops never surface as live.
    await markStaleLoopsDormant(userId, currentSession);

    // 3. Cheap, every turn: regex loop-signal detection.
    const loopSignals = detectLoopSignals(env.utterance);

    // 4. GATE the LLM call — only when earned. A throwaway turn costs zero tokens.
    if (!shouldRunCIExtraction({ depth, loopSignalCount: loopSignals.length, turnNumber })) {
      return;
    }

    const existingLoops = await getOpenLoops(userId);
    const extraction = await extractConversationIntelligence({
      userMessage: env.utterance,
      marcusResponse: env.final_response || '',
      emotion,
      arena,
      depth,
      existingLoops,
      loopSignals,
    });
    if (!extraction) return;

    await applyCIExtraction({ userId, conversationId, sourceMessageId, currentSession, extraction });
  } catch (err) {
    // Best-effort: never let CI failures affect the turn or its other background writes.
    console.error('[CI] runConversationIntelligence error:', err);
  }
}
