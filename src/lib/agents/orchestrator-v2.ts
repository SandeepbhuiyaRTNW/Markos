/**
 * Orchestrator V2 — Full 6-Tier Turn Flow (§11)
 *
 * Flow: Sentinels (parallel) → Assessment Ring (parallel) → Whisperer routing
 *       → Wisdom Council → Composer → Craft Layer → Boundary Sentinel
 *
 * Maintains backward-compatible AgentResponse interface.
 * State Envelope replaces MCPContext as the internal bus.
 */

import { createStateEnvelope, trackEnvelopeAgent, recordEnvelopeError, listenerStackFromAnalysis, buildEnvelopeContextSummary } from './state-envelope-utils';
import type { StateEnvelope } from './state-envelope';
import { analyzeUnderstanding } from '../understanding/stack';
import { getMemoryContext, extractMemories, getSessionHistory, getStylePreferences } from '../memory/memory-manager';
import { detectKWML, getKWMLContext, saveKWMLProfile } from '../kwml/detector';
import { retrieveWisdom, retrieveQuestion } from '../rag/retriever';
import { detectCrisisType } from '../sentinels/crisis';
import { getCrisisResponse, isPostCrisisRetreat, POST_CRISIS_RETREAT_RESPONSE } from '../sentinels/crisis-responses';
import { runBoundarySentinel, checkBoundary, getBoundaryOverridePrompt } from '../sentinels/boundary';
import { detectAIIdentityQuestion, getAIHonestyResponse } from '../sentinels/ai-honesty';
import { detectFrameCollapse, getFrameRefusalResponse } from '../sentinels/frame-refusal';
import { runPathwayRouter } from '../sentinels/pathway-router';
import { runCulturalContext } from '../sentinels/cultural';
import { classifyArena } from '../assessment/arena-classifier';
import { classifySilence } from '../assessment/silence-typer';
import { computeTrust } from '../assessment/trust-gauge';
import { mapPhase } from '../assessment/phase-mapper';
import { selectWisdomVoices, buildWisdomCouncilPrompt } from '../wisdom/council';
import { determineCraftDirectives, enforceSocraticDiscipline, applyDeepListener, enforceVocativePrinciple } from '../craft/craft-layer';
import { WHISPERER_REGISTRY, WHISPERER_ACTIVATION_THRESHOLD } from '../whisperers';
import { computePERMASnapshot } from '../assessment/perma-snapshot';
import { query } from '../db';

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
  // Fetch user name
  let userName: string | null = null;
  try {
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    userName = userResult.rows[0]?.name || null;
  } catch {}

  const env = createStateEnvelope({ userId, conversationId, utterance: userMessage, conversationHistory, userName });

  // ═══════════════════════════════════════════
  // TIER 1 — SENTINELS (parallel, every turn)
  // ═══════════════════════════════════════════

  // 1a. Crisis Sentinel — fast classifier (synchronous, ~0ms)
  const crisisType = detectCrisisType(userMessage);
  if (crisisType && crisisType !== 'passive_crisis') {
    // Acute crisis — force response, bypass all other tiers
    const forcedResponse = getCrisisResponse(crisisType);
    env.sentinels.crisis = { level: 'acute', type: crisisType, protocol: crisisType, forced_response: forcedResponse };
    // Apply vocative filter to crisis responses too
    const cleanedCrisis = enforceVocativePrinciple(forcedResponse || '988 Suicide & Crisis Lifeline: call or text 988.', userName);
    env.final_response = cleanedCrisis;
    return buildResponse(env);
  }

  // Post-crisis retreat check
  if (isPostCrisisRetreat(userMessage, conversationHistory)) {
    env.final_response = enforceVocativePrinciple(POST_CRISIS_RETREAT_RESPONSE, userName);
    return buildResponse(env);
  }

  // 1b. AI-Honesty Sentinel — forced route (Engineering Findings §6)
  if (detectAIIdentityQuestion(userMessage)) {
    const { isHostileAIChallenge } = await import('../sentinels/ai-honesty');
    env.sentinels.ai_honesty = { triggered: true, hostile: isHostileAIChallenge(userMessage) };
    const honestyResponse = getAIHonestyResponse(userMessage);
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
      env.final_response = enforceVocativePrinciple(refusalResponse, userName);
      return buildResponse(env);
    }
  }

  // 1d. Parallel sentinel fetch: Memory + Understanding + KWML + Cultural
  const historyStr = conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n');

  // Phase 1: Fast DB fetches
  const memDone = trackEnvelopeAgent(env, 'memory-sentinel');
  try {
    const [memCtx, kwmlCtx, sessionResult, sessHistory, stylePrefs] = await Promise.all([
      getMemoryContext(userId), getKWMLContext(userId),
      query(`SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`, [userId]),
      getSessionHistory(userId), getStylePreferences(userId),
    ]);
    env.sentinels.memory = {
      prior_threads: [], session_history: sessHistory, memory_context: memCtx,
      session_count: parseInt(sessionResult.rows[0]?.cnt || '0', 10),
      style_preferences: stylePrefs, returning_patterns: [],
    };
  } catch (err) { recordEnvelopeError(env, 'memory-sentinel', err); }
  finally { memDone(); }

  // Phase 2: LLM agents in parallel
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

  // Cultural context (fast, no LLM)
  env.sentinels.cultural = runCulturalContext(userMessage, conversationHistory);

  // Passive crisis flagging
  if (crisisType === 'passive_crisis') {
    env.sentinels.crisis = { level: 'elevated', type: 'passive_crisis', protocol: null, forced_response: null };
  }

  await Promise.all([understandingPromise, kwmlPromise]);

  // ═══════════════════════════════════════════
  // TIER 2 — ASSESSMENT RING (parallel)
  // ═══════════════════════════════════════════
  const assessDone = trackEnvelopeAgent(env, 'assessment-ring');
  try {
    const [arenaResult, silenceResult] = await Promise.all([
      classifyArena(userMessage, historyStr, env.sentinels.memory.memory_context || ''),
      env.sentinels.listener_stack
        ? classifySilence(userMessage, env.sentinels.listener_stack.the_silence, historyStr, env.sentinels.memory.memory_context || '', '')
        : Promise.resolve(null),
    ]);
    env.assessment.arena = arenaResult;
    env.assessment.silence_type = silenceResult;
    env.assessment.trust = computeTrust(userMessage, conversationHistory, env.sentinels.memory.session_count);
    env.assessment.phase = mapPhase(
      env.sentinels.memory.session_count,
      env.sentinels.listener_stack?.depth_level || 2,
      env.sentinels.listener_stack?.emotional_trajectory || 'neutral',
      env.assessment.trust.cognitive, env.assessment.trust.affective,
    );
  } catch (err) { recordEnvelopeError(env, 'assessment-ring', err); }
  finally { assessDone(); }

  // Pathway Router (runs after assessment for arena boost)
  env.sentinels.pathway_router = runPathwayRouter(env);

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
        } catch (err) {
          recordEnvelopeError(env, `whisperer-${arena}`, err);
        }
      });

      await Promise.all(whispererPromises);
    } catch (err) { recordEnvelopeError(env, 'domain-whisperers', err); }
    finally { done(); }
  })();

  await whispererPromise;
  // continued in part 2...
  return await runComposerAndFinish(env, historyStr);
}

async function runComposerAndFinish(env: StateEnvelope, historyStr: string): Promise<AgentResponse> {
  // Placeholder — will call the existing Composer logic
  // This is implemented in orchestrator-v2-composer.ts
  const { runComposerPipeline } = await import('./orchestrator-v2-composer');
  return runComposerPipeline(env, historyStr);
}

function buildResponse(env: StateEnvelope): AgentResponse {
  return {
    response: env.final_response || "I hear you. Tell me more.",
    emotion: env.sentinels.listener_stack?.primary_emotion || 'neutral',
    kwmlArchetype: env.assessment.archetype?.active || '',
    agentTimings: env.agent_timings,
    errors: env.errors,
    envelope: env,
  };
}

