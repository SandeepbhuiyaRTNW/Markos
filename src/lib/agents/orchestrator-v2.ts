/**
 * Orchestrator V2 — Full 6-Tier Turn Flow (§11)
 *
 * Flow: Sentinels (parallel) → Assessment Ring (parallel) → Whisperer routing
 *       → Wisdom Council → Composer → Craft Layer → Boundary Sentinel
 *
 * Maintains backward-compatible AgentResponse interface.
 * State Envelope replaces MCPContext as the internal bus.
 */

import { createStateEnvelope, trackEnvelopeAgent, recordEnvelopeError, listenerStackFromAnalysis } from './state-envelope-utils';
import type { StateEnvelope } from './state-envelope';
import { analyzeUnderstanding } from '../understanding/stack';
import { getMemoryContext, getSessionHistory, getStylePreferences } from '../memory/memory-manager';
import { detectKWML, getKWMLContext } from '../kwml/detector';
import { detectCrisisType } from '../sentinels/crisis';
import { getCrisisResponse, isPostCrisisRetreat, POST_CRISIS_RETREAT_RESPONSE } from '../sentinels/crisis-responses';
import { detectAIIdentityQuestion, getAIHonestyResponse } from '../sentinels/ai-honesty';
import { detectFrameCollapse, getFrameRefusalResponse } from '../sentinels/frame-refusal';
import { runPathwayRouter } from '../sentinels/pathway-router';
import { runCulturalContext } from '../sentinels/cultural';
import { classifyArena } from '../assessment/arena-classifier';
import { classifySilence } from '../assessment/silence-typer';
import { computeTrust } from '../assessment/trust-gauge';
import { mapPhase, monotonicPhase } from '../assessment/phase-mapper';
import { loadSessionState, saveSessionState, type SessionState } from './session-state';
import { selectMove, moveSelectorEnforced } from '../assessment/move-selector';
import { selectKnowledgePlan } from '../assessment/knowledge-selector';
import { selectWisdomVoices } from '../wisdom/council';
import { enforceVocativePrinciple } from '../craft/craft-layer';
import { WHISPERER_REGISTRY, WHISPERER_ACTIVATION_THRESHOLD } from '../whisperers';
import { applyListeningKnowledge } from '../agent/listening-knowledge';
import { applyEmbodiedManKnowledge } from '../agent/embodied-man-knowledge';
import { computePERMASnapshot } from '../assessment/perma-snapshot';
import { query } from '../db';
import { persistTurnMessages, type QueryFn } from './persist-messages';
import { logTurn } from '../observability/turn-logger';
import { analyzeConversation, type ConversationState } from './conversation-state';

// Re-export the same public interface
export interface AgentResponse {
  response: string;
  emotion: string;
  kwmlArchetype: string;
  agentTimings: Record<string, number>;
  errors: Array<{ agent: string; error: string }>;
  envelope?: StateEnvelope; // Optional: full envelope for observability
}

export async function processWithAgents(
  userId: string,
  conversationId: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentResponse> {
  // Kick off the user-name lookup concurrently. It is only needed when we build
  // a response: the sentinel early-returns await it directly; the main path sets
  // it after the Tier-1 DB batch (the query overlaps the batch, so no extra
  // sequential round trip).
  const userNamePromise: Promise<string | null> = query(`SELECT name FROM users WHERE id = $1`, [userId])
    .then(r => r.rows[0]?.name || null)
    .catch(() => null);

  const env = createStateEnvelope({ userId, conversationId, utterance: userMessage, conversationHistory, userName: null });

  // ═══════════════════════════════════════════
  // TIER 1 — SENTINELS (parallel, every turn)
  // ═══════════════════════════════════════════

  // 1a. Crisis Sentinel — fast classifier (synchronous, ~0ms)
  const crisisType = detectCrisisType(userMessage);
  if (crisisType && crisisType !== 'passive_crisis') {
    // Acute crisis — force response, bypass all other tiers
    const userName = await userNamePromise;
    env.user_name = userName;
    const forcedResponse = getCrisisResponse(crisisType);
    env.sentinels.crisis = { level: 'acute', type: crisisType, protocol: crisisType, forced_response: forcedResponse };
    // Apply vocative filter to crisis responses too
    const cleanedCrisis = enforceVocativePrinciple(forcedResponse || '988 Suicide & Crisis Lifeline: call or text 988.', userName);
    env.final_response = cleanedCrisis;
    return buildResponse(env);
  }

  // Post-crisis retreat check
  if (isPostCrisisRetreat(userMessage, conversationHistory)) {
    const userName = await userNamePromise;
    env.user_name = userName;
    env.final_response = enforceVocativePrinciple(POST_CRISIS_RETREAT_RESPONSE, userName);
    return buildResponse(env);
  }

  // 1b. AI-Honesty Sentinel — forced route (Engineering Findings §6)
  if (detectAIIdentityQuestion(userMessage)) {
    const { isHostileAIChallenge } = await import('../sentinels/ai-honesty');
    env.sentinels.ai_honesty = { triggered: true, hostile: isHostileAIChallenge(userMessage) };
    const honestyResponse = getAIHonestyResponse(userMessage);
    const userName = await userNamePromise;
    env.user_name = userName;
    env.final_response = enforceVocativePrinciple(honestyResponse, userName);
    return buildResponse(env);
  }

  // 1c. Frame-Refusal Sentinel — role boundary enforcement (Engineering Findings §7)
  const frameCollapse = detectFrameCollapse(userMessage);
  if (frameCollapse) {
    env.sentinels.frame_refusal = { triggered: true, category: frameCollapse };
    const turnCount = conversationHistory.filter(m => m.role === 'user').length;
    const refusalResponse = getFrameRefusalResponse(frameCollapse, turnCount);
    if (refusalResponse) {
      const userName = await userNamePromise;
      env.user_name = userName;
      env.final_response = enforceVocativePrinciple(refusalResponse, userName);
      return buildResponse(env);
    }
  }

  // 1d. Parallel sentinel fetch: Memory + Understanding + KWML + Cultural
  const historyStr = conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n');

  // W2: persisted trust/phase from earlier turns of THIS conversation (nulls on
  // first turn or load failure — the gauge then falls back to its session-count
  // seed, exactly the old behavior).
  let persistedState: SessionState = { trust: null, phase: null };

  // Phase 1: Fast DB fetches
  const memDone = trackEnvelopeAgent(env, 'memory-sentinel');
  try {
    const [memCtx, kwmlCtx, sessionResult, sessHistory, stylePrefs, loadedState, lastSessionResult] = await Promise.all([
      getMemoryContext(userId), getKWMLContext(userId),
      query(`SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`, [userId]),
      getSessionHistory(userId), getStylePreferences(userId),
      loadSessionState(query, conversationId),
      // W13: the same last-ended-session anchors the opening message speaks from
      // (title + takeaways + pondering topics). Never throws — a missing/drifted
      // column must not break the turn.
      query(
        `SELECT takeaways, pondering_topics, metadata FROM conversations
         WHERE user_id = $1 AND session_ended = true AND id != $2
         ORDER BY ended_at DESC LIMIT 1`,
        [userId, conversationId],
      ).catch(() => null),
    ]);
    persistedState = loadedState;
    env.sentinels.memory = {
      prior_threads: [], session_history: sessHistory, memory_context: memCtx,
      session_count: parseInt(sessionResult.rows[0]?.cnt || '0', 10),
      style_preferences: stylePrefs, returning_patterns: [],
      last_session_continuity: buildLastSessionContinuity(lastSessionResult?.rows?.[0] || null),
    };
  } catch (err) { recordEnvelopeError(env, 'memory-sentinel', err); }
  finally { memDone(); }

  // User name resolves concurrently with the batch above; assign unconditionally
  // (independent of memory-fetch success, matching the original semantics).
  env.user_name = await userNamePromise;

  // Phase 2: LLM agents in parallel — understanding, KWML, and arena. Arena only
  // needs message + history + memory (all ready after Phase 1), so it no longer
  // waits behind Tier 2; it runs alongside the Tier-1 LLMs.
  const understandingPromise = (async () => {
    const done = trackEnvelopeAgent(env, 'listener-stack');
    try {
      const analysis = await analyzeUnderstanding(userMessage, historyStr, env.sentinels.memory.memory_context || '');
      env.sentinels.listener_stack = listenerStackFromAnalysis(analysis);
    } catch (err) { recordEnvelopeError(env, 'listener-stack', err); }
    finally { done(); }
  })();

  const kwmlPromise = (async () => {
    const done = trackEnvelopeAgent(env, 'kwml-agent');
    try {
      const reading = await detectKWML(userMessage, historyStr);
      // KWMLReading has shadow via individual *Shadow fields + shadowActive
      const shadow = reading.shadowActive
        ? [reading.kingShadow, reading.warriorShadow, reading.magicianShadow, reading.loverShadow].filter(Boolean)[0] || null
        : null;
      const confidence = Math.max(reading.king, reading.warrior, reading.magician, reading.lover);
      env.assessment.archetype = { active: reading.dominant, shadow, confidence, reading };
    } catch (err) { recordEnvelopeError(env, 'kwml-agent', err); }
    finally { done(); }
  })();

  const arenaPromise = (async () => {
    const done = trackEnvelopeAgent(env, 'arena-classifier');
    try {
      env.assessment.arena = await classifyArena(userMessage, historyStr, env.sentinels.memory.memory_context || '');
    } catch (err) { recordEnvelopeError(env, 'arena-classifier', err); }
    finally { done(); }
  })();

  // Cultural context (fast, no LLM)
  env.sentinels.cultural = runCulturalContext(userMessage, conversationHistory);

  // Passive crisis flagging
  if (crisisType === 'passive_crisis') {
    env.sentinels.crisis = { level: 'elevated', type: 'passive_crisis', protocol: null, forced_response: null };
  }

  await Promise.all([understandingPromise, kwmlPromise, arenaPromise]);

  // ═══════════════════════════════════════════
  // TIER 2 — ASSESSMENT RING
  // ═══════════════════════════════════════════
  const assessDone = trackEnvelopeAgent(env, 'assessment-ring');
  try {
    // Arena is already classified in Tier 1. Silence depends on the listener
    // stack, so it runs here. NOTE: arena is intentionally NOT passed to
    // classifySilence (kept as '' exactly as before) to preserve behavior.
    env.assessment.silence_type = env.sentinels.listener_stack
      ? await classifySilence(userMessage, env.sentinels.listener_stack.the_silence, historyStr, env.sentinels.memory.memory_context || '', '')
      : null;
    // W2: carry forward the trust this man has already earned in this
    // conversation instead of re-seeding from scratch every turn.
    env.assessment.trust = computeTrust(userMessage, conversationHistory, env.sentinels.memory.session_count, persistedState.trust);
    const computedPhase = mapPhase(
      env.sentinels.memory.session_count,
      env.sentinels.listener_stack?.depth_level || 2,
      env.sentinels.listener_stack?.emotional_trajectory || 'neutral',
      env.assessment.trust.cognitive, env.assessment.trust.affective,
    );
    // W2: phases advance monotonically within a conversation — a shallow turn
    // must not strip a phase he already reached.
    env.assessment.phase = monotonicPhase(computedPhase, persistedState.phase);
  } catch (err) { recordEnvelopeError(env, 'assessment-ring', err); }
  finally { assessDone(); }

  // Pathway Router (runs after assessment for arena boost)
  env.sentinels.pathway_router = runPathwayRouter(env);

  // ═══════════════════════════════════════════
  // TIER 2.5 — CONVERSATION POLICY
  // ── Move Selector + Knowledge Intelligence
  // ═══════════════════════════════════════════
  const policyEnforced = moveSelectorEnforced();
  const moveDone = trackEnvelopeAgent(env, 'move-selector');
  const knowledgeDone = trackEnvelopeAgent(env, 'knowledge-selector');
  let conversationState: ConversationState;
  try {
    conversationState = await analyzeConversation(env.conversation_history, env.utterance);
    env.move_decision = selectMove(env, conversationState, {
      commAssistEnabled: process.env.COMM_ASSIST_ENABLED === 'true' || process.env.COMM_ASSIST_ENABLED === '1',
    });
    env.knowledge_plan = selectKnowledgePlan(env, {
      move: env.move_decision.move,
      too_early_to_address: env.move_decision.too_early_to_address,
      child_centered_frame: env.move_decision.child_centered_frame,
    });

    env.policy_diagnostics.enforced = policyEnforced;
    env.policy_diagnostics.move_conflict = false;
    env.policy_diagnostics.move_rule = env.move_decision.rule;
    env.policy_diagnostics.selected_form = env.move_decision.craft_form;
    env.policy_diagnostics.asked_question = env.move_decision.ask_question;
    env.policy_diagnostics.knowledge_rule = env.knowledge_plan.rule;
    env.policy_diagnostics.knowledge_safety_only = env.knowledge_plan.safetyOnly;
    env.policy_diagnostics.questions_enabled = env.knowledge_plan.questions.enabled;
  } catch (err) {
    recordEnvelopeError(env, 'conversation-policy', err);
    conversationState = { phase: 'understand', intent: 'exploration', hopelessnessLevel: 0, pushbackCount: 0, adviceLoopCount: 0, trajectoryDrift: 0, emotionalDirection: 'flat', loopBreaker: '', responseTemplate: null };
    env.move_decision = null;
    env.knowledge_plan = null;
    env.policy_diagnostics.enforced = false;
  } finally {
    moveDone();
    knowledgeDone();
  }

  // ═══════════════════════════════════════════
  // TIER 3 + 4 — WISDOM COUNCIL + WHISPERERS
  // ═══════════════════════════════════════════
  env.wisdom_council = selectWisdomVoices(env);

  // PERMA Snapshot (lightweight heuristic, runs after assessment)
  env.assessment.perma = computePERMASnapshot(env);

  // Whisperer routing based on Arena Classifier — all 14 whisperers
  const whispererPromise = (async () => {
    const done = trackEnvelopeAgent(env, 'domain-whisperers');
    try {
      const arenaWeights = env.assessment.arena?.weights || {};

      // Find all arenas above activation threshold
      const activeArenas = Object.entries(arenaWeights)
        .filter(([, weight]) => weight >= WHISPERER_ACTIVATION_THRESHOLD)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3); // Cap at 3 concurrent whisperers for latency

      // Run activated whisperers in parallel
      const whispererPromises = activeArenas.map(async ([arena]) => {
        const runner = WHISPERER_REGISTRY[arena];
        if (!runner) return;
        try {
          const result = await runner(env);
          env.domain_whisperers.invoked.push(arena);
          env.domain_whisperers.question_candidates.push(...result.question_candidates);
          env.domain_whisperers.frameworks_applied.push(...result.frameworks_applied);
          if (result.landmines.length > 0) env.domain_whisperers.landmines.push(...result.landmines);
          if (result.context_notes) env.domain_whisperers.context_notes.push(result.context_notes);
        } catch (err) {
          recordEnvelopeError(env, `whisperer-${arena}`, err);
        }
      });

      await Promise.all(whispererPromises);

      // Listening / response / conversation knowledge — agent-wide, deterministic
      // (NO LLM, NO DB). Listening is not an arena, so it is not routed through
      // WHISPERER_REGISTRY; it rides the same output channels every whisperer
      // uses (context_notes + landmines + frameworks), which already render into
      // the Composer prompt. buildListeningNote returns null when the turn
      // touches no listening area — the null case pushes NOTHING, so a purely
      // neutral turn stays exactly as before.
      applyListeningKnowledge(env);
      // Embodied Man body-history knowledge — agent-wide, deterministic (NO LLM,
      // NO DB, zero added latency: keyword detection + string assembly only).
      // Body-history craft is not an arena, so it is not routed through
      // WHISPERER_REGISTRY; it rides the same output channels every whisperer
      // uses (context_notes + landmines + frameworks), which already render into
      // the Composer prompt. buildEmbodiedManNote returns null when the turn
      // touches no body-history area — the null case pushes NOTHING, so a purely
      // neutral turn stays exactly as before.
      applyEmbodiedManKnowledge(env);
    } catch (err) { recordEnvelopeError(env, 'domain-whisperers', err); }
    finally { done(); }
  })();

  // Run the Composer pre-fetch (RAG wisdom + legacy questions + conversation-
  // state) concurrently with the Whisperers. Its inputs (memory, listener,
  // archetype, arena) are all populated and the Whisperers do not mutate them.
  const { retrievePreComposer, runComposerPipeline } = await import('./orchestrator-v2-composer');
  const preComposerPromise = retrievePreComposer(
    env,
    historyStr,
    conversationState,
    {
      moveDecision: env.move_decision,
      knowledgePlan: env.knowledge_plan,
      enforceMovePolicy: policyEnforced,
    },
  );
  // W2: persist this turn's trust + phase so the NEXT turn resumes instead of
  // restarting. Overlapped with the whisperer/composer work — zero added latency.
  // saveSessionState never throws.
  const statePersistPromise = saveSessionState(query, conversationId, env.assessment.trust, env.assessment.phase.label);
  const [, pre] = await Promise.all([whispererPromise, preComposerPromise, statePersistPromise]);
  return runComposerPipeline(
    env,
    historyStr,
    pre,
    {
      moveDecision: env.move_decision,
      knowledgePlan: env.knowledge_plan,
      enforceMovePolicy: policyEnforced,
    },
  );
}

export async function buildResponse(env: StateEnvelope, queryFn?: QueryFn): Promise<AgentResponse> {
  // W1 + W4: on EVERY user-visible sentinel return (acute crisis, post-crisis retreat,
  // AI-honesty, frame-refusal) persist the two messages AND write the turn log, and
  // AWAIT both so they land before the reply goes back — the same shared writers the
  // composer path uses. Neither throws (persistTurnMessages logs loudly + returns null;
  // logTurn catches internally), so a DB error can never block or fail the reply. The
  // slow memory/KWML/CI tier stays composer-only and is NOT run here.
  await persistTurnMessages(env, queryFn, 'sentinel');
  await logTurn(env, queryFn);
  return {
    response: env.final_response || "I hear you. Tell me more.",
    emotion: env.sentinels.listener_stack?.primary_emotion || 'neutral',
    kwmlArchetype: env.assessment.archetype?.active || '',
    agentTimings: env.agent_timings,
    errors: env.errors,
    envelope: env,
  };
}

/**
 * W13: build the LAST SESSION CONTINUITY block from the most recent ended
 * session — the exact anchors the opening message was generated from — so the
 * first live reply after a warm, memory-aware opener does not sound like a
 * stranger. Returns null when there is nothing real to say (never fabricates).
 */
function buildLastSessionContinuity(lastSession: {
  takeaways?: unknown;
  pondering_topics?: unknown;
  metadata?: unknown;
} | null): string | null {
  if (!lastSession) return null;
  const title = (lastSession.metadata as Record<string, unknown> | null)?.title;
  const takeaways = Array.isArray(lastSession.takeaways) ? lastSession.takeaways.filter(t => typeof t === 'string') : [];
  const pondering = Array.isArray(lastSession.pondering_topics) ? lastSession.pondering_topics.filter(t => typeof t === 'string') : [];
  const parts: string[] = [];
  if (typeof title === 'string' && title) parts.push(`Last session topic: "${title}"`);
  if (takeaways.length > 0) parts.push(`Key takeaways from last time:\n${takeaways.map(t => `- ${t}`).join('\n')}`);
  if (pondering.length > 0) parts.push(`Pondering topics given to him:\n${pondering.map(t => `- ${t}`).join('\n')}`);
  if (parts.length === 0) return null;
  return `LAST SESSION CONTINUITY (the session opener already spoke from this — treat it as something you both know):\n${parts.join('\n')}`;
}
