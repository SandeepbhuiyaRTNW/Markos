/**
 * Orchestrator V2 Composer Pipeline — Tier 0 + Tier 5 + Boundary
 * Generates the final response using State Envelope context,
 * applies Craft Layer shaping, and runs Boundary Sentinel post-check.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { buildSystemPrompt } from '../agent/system-prompt';
import type { StateEnvelope } from './state-envelope';
import { trackEnvelopeAgent, recordEnvelopeError, buildEnvelopeContextSummary } from './state-envelope-utils';
import { checkBoundary, getBoundaryOverridePrompt, runBoundarySentinel } from '../sentinels/boundary';
import { determineCraftDirectives, enforceSocraticDiscipline, applyDeepListener } from '../craft/craft-layer';
import { buildWisdomCouncilPrompt } from '../wisdom/council';
import { getPhaseConstraints } from '../assessment/phase-mapper';
import { retrieveWisdom, retrieveQuestion, type QuestionRetrievalContext } from '../rag/retriever';
import { analyzeConversation, computeTrajectoryDrift } from './conversation-state';
import { searchPastMessages } from '../memory/memory-manager';
import type { AgentResponse } from './orchestrator-v2';

export async function runComposerPipeline(env: StateEnvelope, historyStr: string): Promise<AgentResponse> {
  // ═══════════════════════════════════════════
  // PRE-COMPOSER: RAG + Legacy question retrieval (parallel)
  // ═══════════════════════════════════════════
  const ragDone = trackEnvelopeAgent(env, 'rag-retrieval');
  let ragWisdom = '';
  let legacyQuestions: string[] = [];
  try {
    const retrievalCtx: QuestionRetrievalContext = {
      sessionCount: env.sentinels.memory.session_count,
      emotionDetected: env.sentinels.listener_stack?.primary_emotion,
      archetype: env.assessment.archetype?.active,
      shadow: env.assessment.archetype?.shadow || undefined,
      arena: env.assessment.arena?.primary,
    };
    [ragWisdom, legacyQuestions] = await Promise.all([
      retrieveWisdom(env.utterance, 5, historyStr),
      retrieveQuestion(env.utterance, env.assessment.archetype?.active, undefined, 3, retrievalCtx),
    ]);
  } catch (err) { recordEnvelopeError(env, 'rag-retrieval', err); }
  finally { ragDone(); }

  // Merge Whisperer question candidates with legacy questions
  const allQuestionTexts = [
    ...env.domain_whisperers.question_candidates.map(q => q.text),
    ...legacyQuestions,
  ];
  // Deduplicate
  const uniqueQuestions = [...new Set(allQuestionTexts)].slice(0, 5);

  // ═══════════════════════════════════════════
  // TIER 5 — CRAFT LAYER (pre-Composer directives)
  // ═══════════════════════════════════════════
  env.craft_directives = determineCraftDirectives(env);

  // ═══════════════════════════════════════════
  // TIER 0 — COMPOSER (Marcus's single voice)
  // ═══════════════════════════════════════════
  const composerDone = trackEnvelopeAgent(env, 'composer');
  try {
    const model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.85,
      maxTokens: 350,
    });

    // Build the context injection from State Envelope
    const envelopeContext = buildEnvelopeContextSummary(env);
    const wisdomCouncilPrompt = buildWisdomCouncilPrompt(env.wisdom_council);
    const phaseConstraints = getPhaseConstraints(env.assessment.phase.label);

    // Craft-aware system addendum
    const craftAddendum = env.craft_directives.style_override
      ? `\n\n## CRAFT DIRECTIVE\n${env.craft_directives.style_override}\nForm: ${env.craft_directives.form} | Pacing: ${env.craft_directives.pacing}`
      : '';

    // Build understanding context string for the system prompt
    const understandingStr = env.sentinels.listener_stack
      ? `Words: ${env.sentinels.listener_stack.words}\nEmotion: ${env.sentinels.listener_stack.emotion}\nPattern: ${env.sentinels.listener_stack.pattern}\nThe Man: ${env.sentinels.listener_stack.the_man}\nThe Silence: ${env.sentinels.listener_stack.the_silence}\nDepth: ${env.sentinels.listener_stack.depth_level}/5\nTrajectory: ${env.sentinels.listener_stack.emotional_trajectory}\nDepth Opportunity: ${env.sentinels.listener_stack.depth_opportunity}\nSilence Question: ${env.sentinels.listener_stack.silence_question}`
      : undefined;

    const kwmlStr = env.assessment.archetype?.reading
      ? `Dominant: ${env.assessment.archetype.active}, Shadow: ${env.assessment.archetype.shadow || 'none'}, K:${env.assessment.archetype.reading.king} W:${env.assessment.archetype.reading.warrior} M:${env.assessment.archetype.reading.magician} L:${env.assessment.archetype.reading.lover}`
      : undefined;

    // Build messages — use the existing buildSystemPrompt signature
    const systemContent = buildSystemPrompt({
      memoryContext: env.sentinels.memory.memory_context || undefined,
      ragContext: ragWisdom + (uniqueQuestions.length > 0 ? `\n\n## SUGGESTED QUESTIONS (choose at most ONE):\n${uniqueQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''),
      kwmlContext: kwmlStr,
      understandingContext: understandingStr,
      sessionHistory: env.sentinels.memory.session_history || undefined,
      userName: env.user_name || undefined,
      stylePreferences: env.sentinels.memory.style_preferences || undefined,
    });

    // Inject State Envelope intelligence after system prompt
    const fullSystem = `${systemContent}\n\n${envelopeContext}\n\n${wisdomCouncilPrompt}${craftAddendum}`;

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(fullSystem),
      ...env.conversation_history.map(m =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
      ),
      new HumanMessage(env.utterance),
    ];

    const response = await model.invoke(messages);
    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    content = content || 'Something in what you said hit me. Say that again — slower this time.';

    // ═══════════════════════════════════════════
    // POST-COMPOSER: Craft Layer shaping
    // ═══════════════════════════════════════════
    const isSilenceBreaking = env.sentinels.listener_stack?.depth_level
      ? env.sentinels.listener_stack.depth_level >= 4
      : false;
    content = enforceSocraticDiscipline(content, env.craft_directives);
    content = applyDeepListener(content, env.craft_directives, isSilenceBreaking);

    // ═══════════════════════════════════════════
    // BOUNDARY SENTINEL (post-Composer)
    // ═══════════════════════════════════════════
    const boundaryResult = checkBoundary(content);
    env.sentinels.boundary = runBoundarySentinel(content);

    if (!boundaryResult.passed) {
      console.log(`[V2] 🚫 Boundary violations: ${boundaryResult.violations.slice(0, 3).join(', ')} — regenerating`);
      const overridePrompt = getBoundaryOverridePrompt(boundaryResult);
      const retryMessages = [...messages, new AIMessage(content), new HumanMessage(overridePrompt)];
      const retry = await model.invoke(retryMessages);
      const retryContent = typeof retry.content === 'string' ? retry.content : JSON.stringify(retry.content);
      content = retryContent || content;
      content = enforceSocraticDiscipline(content, env.craft_directives);
    }

    // Trajectory dedup (from V1)
    const prevMarcus = env.conversation_history.filter(m => m.role === 'assistant').map(m => m.content);
    if (prevMarcus.length >= 2) {
      try {
        const drift = await computeTrajectoryDrift(content, prevMarcus);
        if (drift > 0.85) {
          console.log(`[V2] 🔄 Trajectory dedup (drift: ${drift.toFixed(3)}) — regenerating`);
          const dedupMessages = [...messages, new AIMessage(content),
            new HumanMessage(`[SYSTEM OVERRIDE] Your response is semantically identical to what you've been saying all session. You are STUCK IN A LOOP. Write a COMPLETELY DIFFERENT response. Change angle entirely. 2-3 sentences. End differently.`)];
          const dedupRetry = await model.invoke(dedupMessages);
          content = typeof dedupRetry.content === 'string' ? dedupRetry.content : content;
        }
      } catch {}
    }

    // Crisis resource enforcement for elevated/passive crisis
    if (env.sentinels.crisis.level === 'elevated' && !content.includes('988')) {
      content += '\n\nBrother — 988 Suicide & Crisis Lifeline: call or text 988. Crisis Text Line: text HOME to 741741.';
    }

    env.composer_output = content;
    env.final_response = content;
  } catch (err) {
    recordEnvelopeError(env, 'composer', err);
    env.final_response = "I hear you. Tell me more.";
  } finally { composerDone(); }

  // ═══════════════════════════════════════════
  // STORE + OBSERVABILITY (fire-and-forget)
  // ═══════════════════════════════════════════
  storeInBackground(env).catch(err => console.error('[V2] Background store error:', err));

  // Turn logging for clinical observability
  import('../observability/turn-logger').then(({ logTurn }) => logTurn(env)).catch(() => {});

  return {
    response: env.final_response || "I hear you. Tell me more.",
    emotion: env.sentinels.listener_stack?.primary_emotion || 'neutral',
    kwmlArchetype: env.assessment.archetype?.active || '',
    agentTimings: env.agent_timings,
    errors: env.errors,
    envelope: env,
  };
}

/** Fire-and-forget storage: messages + memory extraction */
async function storeInBackground(env: StateEnvelope): Promise<void> {
  const { query: dbQuery } = await import('../db');
  const { extractMemories } = await import('../memory/memory-manager');
  const { saveKWMLProfile } = await import('../kwml/detector');

  try {
    const userMsgResult = await dbQuery(
      `INSERT INTO messages (conversation_id, role, content, emotion_detected, understanding_layer, kwml_archetype)
       VALUES ($1, 'user', $2, $3, $4, $5) RETURNING id`,
      [env.conversation_id, env.utterance,
       env.sentinels.listener_stack?.primary_emotion || null,
       env.sentinels.listener_stack?.depth_level || null,
       env.assessment.archetype?.active || null]
    );
    const userMsgId = userMsgResult.rows[0].id;

    await Promise.all([
      dbQuery(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'marcus', $2)`,
        [env.conversation_id, env.final_response]),
      extractMemories(env.user_id, env.utterance, env.final_response || '', userMsgId),
      env.assessment.archetype?.reading
        ? saveKWMLProfile(env.user_id, env.assessment.archetype.reading, env.conversation_id)
        : Promise.resolve(),
    ]);
  } catch (err) {
    console.error('[V2 Store] Error:', err);
  }
}

