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
import { determineCraftDirectives, enforceSocraticDiscipline, applyDeepListener, enforceVocativePrinciple, detectForbiddenPhrases, detectFantasyIdentity, detectVocabSubstitutions } from '../craft/craft-layer';
import { buildWisdomCouncilPrompt } from '../wisdom/council';
import { getPhaseConstraints } from '../assessment/phase-mapper';
import { retrieveWisdom, retrieveQuestion, type QuestionRetrievalContext } from '../rag/retriever';
import { analyzeConversation, computeTrajectoryDrift } from './conversation-state';
import { searchPastMessages } from '../memory/memory-manager';
import type { AgentResponse } from './orchestrator-v2';

export interface PreComposerResult {
  ragWisdom: string;
  legacyQuestions: string[];
  convState: Awaited<ReturnType<typeof analyzeConversation>> | null;
}

/**
 * Composer pre-fetch: RAG wisdom, legacy question retrieval, and the
 * conversation-state escalation engine (loop-breaking, pushback/resistance,
 * advice-loop detection, hopelessness templates). Depends only on Tier 1/2
 * outputs (memory, listener stack, archetype, arena) — none of which the
 * Whisperer tier mutates — so the orchestrator runs it concurrently with the
 * Whisperers. Kept callable standalone (composer computes it if not supplied).
 */
export async function retrievePreComposer(env: StateEnvelope, historyStr: string): Promise<PreComposerResult> {
  // ═══════════════════════════════════════════
  // PRE-COMPOSER: RAG + Legacy question retrieval (parallel)
  // ═══════════════════════════════════════════
  const ragDone = trackEnvelopeAgent(env, 'rag-retrieval');
  let ragWisdom = '';
  let legacyQuestions: string[] = [];
  // Escalation engine — loop-breaking, pushback/resistance handling, advice-loop
  // detection, emotional-direction tracking, and hopelessness templates. Computed
  // in parallel with RAG so it adds no extra latency.
  let convState: Awaited<ReturnType<typeof analyzeConversation>> | null = null;
  try {
    const retrievalCtx: QuestionRetrievalContext = {
      sessionCount: env.sentinels.memory.session_count,
      emotionDetected: env.sentinels.listener_stack?.primary_emotion,
      archetype: env.assessment.archetype?.active,
      shadow: env.assessment.archetype?.shadow || undefined,
      arena: env.assessment.arena?.primary,
    };
    const [rw, lq, cs] = await Promise.all([
      retrieveWisdom(env.utterance, 5, historyStr),
      retrieveQuestion(env.utterance, env.assessment.archetype?.active, undefined, 3, retrievalCtx),
      analyzeConversation(env.conversation_history, env.utterance),
    ]);
    ragWisdom = rw; legacyQuestions = lq; convState = cs;
  } catch (err) { recordEnvelopeError(env, 'rag-retrieval', err); }
  finally { ragDone(); }
  return { ragWisdom, legacyQuestions, convState };
}

export async function runComposerPipeline(env: StateEnvelope, historyStr: string, pre?: PreComposerResult): Promise<AgentResponse> {
  // Pre-fetch is supplied by the orchestrator (run concurrently with Whisperers);
  // fall back to computing it here when the composer is invoked standalone.
  const { ragWisdom, legacyQuestions, convState } = pre ?? await retrievePreComposer(env, historyStr);

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
      temperature: 0.75,
      maxTokens: 350,
      maxRetries: 1, // kill the hidden 2x SDK retry latency multiplier on the critical path
    });

    // Build the context injection from State Envelope
    const envelopeContext = buildEnvelopeContextSummary(env);
    const wisdomCouncilPrompt = buildWisdomCouncilPrompt(env.wisdom_council);
    const phaseConstraints = getPhaseConstraints(env.assessment.phase.label);

    // Meet him where he is: the phase max_depth gates how hard we PUSH, but a man who
    // brings depth (raw grief, divorce, a shame never spoken) must be MET at that depth,
    // even in early sessions. Challenge stays trust-gated; presence is content-gated.
    const presentedDepth = env.sentinels.listener_stack?.depth_level || 1;
    const effectiveMaxDepth = Math.max(phaseConstraints.max_depth, presentedDepth);

    // Phase constraints — inject into prompt so Composer knows depth/challenge permissions
    const phaseAddendum = `\n\n## PHASE CONSTRAINTS (${env.assessment.phase.label.toUpperCase()})
Meet-him depth (match this — he brought it): ${effectiveMaxDepth}/5 | Challenge ceiling (push only this hard): ${phaseConstraints.max_depth}/5
Can challenge: ${phaseConstraints.can_challenge ? 'YES' : 'NO'} | Can suggest: ${phaseConstraints.can_suggest ? 'YES' : 'NO'}
Question style: ${phaseConstraints.question_style}${effectiveMaxDepth > phaseConstraints.max_depth ? `\nNOTE: He brought depth ${presentedDepth}. MATCH it — reflect the real thing he said and ask the one question that lives at his level. Do NOT retreat to a careful, surface response just because trust is still early. What you hold back is adversarial confrontation, not presence.` : ''}`;

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

    // Build priority hierarchy — the Composer's marching orders for THIS turn
    const priorityHierarchy = buildPriorityHierarchy(env);

    // Escalation directives from the conversation-state engine — these are the
    // loop-breakers (pushback/resistance/advice-loop/worsening) and hard-constraint
    // templates that stop Marcus repeating himself and force a change of approach.
    const escalationDirectives: string[] = [];
    if (convState?.loopBreaker) escalationDirectives.push(convState.loopBreaker);
    if (convState && convState.hopelessnessLevel >= 3 && convState.responseTemplate) {
      escalationDirectives.push(convState.responseTemplate);
    }
    const escalationAddendum = escalationDirectives.length > 0
      ? `\n\n## 🔁 CONVERSATION STATE — OVERRIDE (HIGHEST PRIORITY, OBEY BEFORE ALL ELSE)\n${escalationDirectives.join('\n\n')}`
      : '';
    if (convState) {
      console.log(`[V2] ConvState: intent=${convState.intent} phase=${convState.phase} hopeless=${convState.hopelessnessLevel} pushback=${convState.pushbackCount} adviceLoop=${convState.adviceLoopCount} direction=${convState.emotionalDirection} loopBreaker=${convState.loopBreaker ? 'YES' : 'no'}`);
    }

    // Inject State Envelope intelligence after system prompt
    const fullSystem = `${systemContent}\n\n${envelopeContext}\n\n${wisdomCouncilPrompt}${phaseAddendum}${craftAddendum}\n\n${priorityHierarchy}${escalationAddendum}`;

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

    // ── Regeneration budget ────────────────────────────────────────────────
    // The post-generation gates below run in PRIORITY ORDER (boundary ->
    // trajectory -> fantasy -> vocab -> forbidden). Each re-roll is a full
    // gpt-4o call on the critical path; a long/emotional turn used to trip up
    // to 5 sequentially, ballooning the turn past the serverless timeout. Cap
    // total re-rolls at MAX_REGENS so the highest-priority violations still win,
    // then stop and keep the best draft — logging which lower-priority gates
    // were skipped. (env.regen_triggers is preserved for turn_logs observability.)
    const MAX_REGENS = 2;
    let regens = 0;
    const skippedGates: string[] = [];

    if (!boundaryResult.passed) {
      if (regens < MAX_REGENS) {
        console.log(`[V2] 🚫 Boundary violations: ${boundaryResult.violations.slice(0, 3).join(', ')} — regenerating`);
        regens++;
        env.regen_triggers.push('boundary');
        const overridePrompt = getBoundaryOverridePrompt(boundaryResult);
        const retryMessages = [...messages, new AIMessage(content), new HumanMessage(overridePrompt)];
        const retry = await model.invoke(retryMessages);
        const retryContent = typeof retry.content === 'string' ? retry.content : JSON.stringify(retry.content);
        content = retryContent || content;
        content = enforceSocraticDiscipline(content, env.craft_directives);
      } else {
        skippedGates.push('boundary');
      }
    }

    // Trajectory dedup (from V1). Skip the drift computation entirely once the
    // regen budget is spent — it costs embedding calls we could not act on.
    const prevMarcus = env.conversation_history.filter(m => m.role === 'assistant').map(m => m.content);
    if (prevMarcus.length >= 2 && regens < MAX_REGENS) {
      try {
        const drift = await computeTrajectoryDrift(content, prevMarcus);
        if (drift > 0.85) {
          console.log(`[V2] 🔄 Trajectory dedup (drift: ${drift.toFixed(3)}) — regenerating`);
          regens++;
          env.regen_triggers.push('trajectory_dedup');
          const dedupMessages = [...messages, new AIMessage(content),
            new HumanMessage(`[SYSTEM OVERRIDE] Your response is semantically identical to what you've been saying all session. You are STUCK IN A LOOP. Write a COMPLETELY DIFFERENT response. Change angle entirely. 2-3 sentences. End differently.`)];
          const dedupRetry = await model.invoke(dedupMessages);
          content = typeof dedupRetry.content === 'string' ? dedupRetry.content : content;
        }
      } catch {}
    } else if (prevMarcus.length >= 2) {
      skippedGates.push('trajectory(eval-skipped)');
    }

    // ═══════════════════════════════════════════
    // CRAFT LAYER POST-COMPOSITION FILTERS
    // ═══════════════════════════════════════════

    // 1. Fantasy-Identity Blocker — re-roll if draft contains forward-projecting templates
    if (detectFantasyIdentity(content)) {
      if (regens < MAX_REGENS) {
        console.log(`[V2] 🎭 Fantasy-identity template detected — regenerating`);
        regens++;
        env.regen_triggers.push('fantasy_identity');
        const fantasyOverride = [...messages, new AIMessage(content),
          new HumanMessage(`[SYSTEM OVERRIDE] Your response contains a forward-projecting fantasy-identity question ("imagine yourself a year from now" pattern). This is a banned template. Rewrite with a PRESENT-TENSE or PAST-EXCAVATING question instead. Ask about what IS happening, not what he wants to become. 2-3 sentences.`)];
        const fantasyRetry = await model.invoke(fantasyOverride);
        content = typeof fantasyRetry.content === 'string' ? fantasyRetry.content : content;
      } else {
        skippedGates.push('fantasy-identity');
      }
    }

    // 2. Vocabulary Fidelity Filter — re-roll if draft substitutes user's concrete words
    const vocabViolations = detectVocabSubstitutions(env.utterance, content);
    if (vocabViolations.length > 0) {
      if (regens < MAX_REGENS) {
        console.log(`[V2] 📝 Vocab fidelity violations: ${vocabViolations.slice(0, 3).join(', ')} — regenerating`);
        regens++;
        env.regen_triggers.push('vocab_fidelity');
        const vocabOverride = [...messages, new AIMessage(content),
          new HumanMessage(`[SYSTEM OVERRIDE] Your response translated the user's specific words into clinical abstractions. The user's EXACT words must appear in your response. Return at least one specific noun, verb, or phrase from the user's message verbatim. Do NOT substitute "throw up" with "heavy feeling" or "cheated" with "betrayal" etc. Rewrite using the user's own vocabulary. 2-3 sentences.`)];
        const vocabRetry = await model.invoke(vocabOverride);
        content = typeof vocabRetry.content === 'string' ? vocabRetry.content : content;
      } else {
        skippedGates.push('vocab-fidelity');
      }
    }

    // 3. Forbidden Phrase Filter — re-roll if draft contains banned phrases
    const forbiddenViolations = detectForbiddenPhrases(content);
    if (forbiddenViolations.length > 0) {
      if (regens < MAX_REGENS) {
        console.log(`[V2] 🚫 Forbidden phrases: ${forbiddenViolations.join(', ')} — regenerating`);
        regens++;
        env.regen_triggers.push('forbidden_phrase');
        const forbiddenOverride = [...messages, new AIMessage(content),
          new HumanMessage(`[SYSTEM OVERRIDE] Your response contained forbidden phrases (${forbiddenViolations.join(', ')}). These are banned. Rewrite without any of them. Be direct and concrete. 2-3 sentences.`)];
        const forbiddenRetry = await model.invoke(forbiddenOverride);
        content = typeof forbiddenRetry.content === 'string' ? forbiddenRetry.content : content;
      } else {
        skippedGates.push('forbidden-phrase');
      }
    }

    if (skippedGates.length > 0) {
      console.log(`[V2] ⏭ Regen cap (${MAX_REGENS}) reached — skipped: ${skippedGates.join(', ')} (kept best draft)`);
    }

    // 4. Vocative Principle Filter — ALWAYS runs last, strips banned vocatives
    content = enforceVocativePrinciple(content, env.user_name);

    // Crisis resource enforcement for elevated/passive crisis
    if (env.sentinels.crisis.level === 'elevated' && !content.includes('988')) {
      content += `\n\n${env.user_name ? env.user_name + ' — ' : ''}988 Suicide & Crisis Lifeline: call or text 988. Crisis Text Line: text HOME to 741741.`;
    }

    env.composer_output = content;
    env.final_response = content;
    // Measured wall-clock of the agent pipeline (envelope creation → response
    // ready). Excludes route-level STT/TTS, which are not instrumented here.
    env.total_ms = Date.now() - env.turn_start_ms;
  } catch (err) {
    recordEnvelopeError(env, 'composer', err);
    env.final_response = "I hear you. Tell me more.";
  } finally { composerDone(); }

  // ═══════════════════════════════════════════
  // STORE + OBSERVABILITY (fire-and-forget)
  // ═══════════════════════════════════════════
  // Message + memory writes stay fire-and-forget (not needed downstream).
  storeInBackground(env).catch(err => console.error('[V2] Background store error:', err));

  // Turn logging — AWAITED so the turn_logs row exists before processMessage
  // returns. The API route then reliably attaches route_total_ms via UPDATE,
  // deterministic even on the text path (which has no TTS settle window).
  // logTurn never throws (it catches internally). Cost is one INSERT (~10-30ms);
  // on the voice path this insert previously overlapped the awaited TTS, so
  // end-to-end grows only by that insert. total_ms is measured earlier (right
  // after final_response) and is unaffected.
  await import('../observability/turn-logger').then(({ logTurn }) => logTurn(env)).catch(() => {});

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
  const { runConversationIntelligence } = await import('../intelligence');

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
      // Conversation Intelligence (Part 1) — gated internally (cheap arc append
      // every turn, gpt-4o-mini only when earned). Own .catch so a CI failure
      // can never reject this Promise.all or affect memory/message writes.
      runConversationIntelligence(env, userMsgId).catch(err => console.error('[CI] error:', err)),
    ]);
  } catch (err) {
    console.error('[V2 Store] Error:', err);
  }
}

/**
 * Build a priority hierarchy that tells the Composer exactly what to focus on.
 * Placed LAST in the system prompt so it has maximum attention weight.
 */
function buildPriorityHierarchy(env: StateEnvelope): string {
  const ls = env.sentinels.listener_stack;
  const whisperers = env.domain_whisperers;
  const depth = ls?.depth_level || 1;
  const phase = env.assessment.phase.label;

  const lines: string[] = [
    '## ⚡ COMPOSER PRIORITY — READ THIS LAST, OBEY THIS FIRST',
    '',
  ];

  // Priority 1: If there's a silence question, it's the #1 candidate
  if (ls?.silence_question) {
    lines.push(`PRIORITY 1 — SILENCE QUESTION (from Listener Stack):`);
    lines.push(`"${ls.silence_question}"`);
    lines.push(`This is the DEEPEST question available for this moment. Use it as-is or adapt it to your voice. Do NOT replace it with a safer question unless the man explicitly needs gentleness right now.`);
    lines.push('');
  }

  // Priority 2: Depth Move
  if (ls?.depth_opportunity) {
    lines.push(`PRIORITY 2 — DEPTH MOVE:`);
    lines.push(`${ls.depth_opportunity}`);
    lines.push(`This tells you WHERE to push. Follow this direction.`);
    lines.push('');
  }

  // Priority 3: Whisperer Intelligence (domain-specific clinical notes)
  if (whisperers.context_notes.length > 0 || whisperers.landmines.length > 0) {
    lines.push(`PRIORITY 3 — DOMAIN INTELLIGENCE:`);
    if (whisperers.context_notes.length > 0) {
      lines.push(`Clinical context: ${whisperers.context_notes.join(' | ')}`);
    }
    if (whisperers.landmines.length > 0) {
      lines.push(`AVOID: ${whisperers.landmines.join('; ')}`);
    }
    lines.push('');
  }

  // Depth accountability
  if (depth <= 2) {
    lines.push(`DEPTH CHECK: You are at depth ${depth}/5. If you have been at this depth for 3+ exchanges, YOU are failing. Use the Silence Question or Depth Move above to go deeper. Do not stay at the surface with him.`);
  } else if (depth >= 4) {
    lines.push(`DEPTH CHECK: You are at depth ${depth}/5. This is sacred ground. Honor it. Mirror his truth. Do not retreat to safety.`);
  }

  // Phase-specific instruction
  if (phase === 'unleashed' || phase === 'brothered') {
    lines.push(`PHASE NOTE: This man is in ${phase.toUpperCase()}. He can handle challenge and direct confrontation. Do NOT default to empathy-first. Lead with the provocation, then hold him through it.`);
  }

  lines.push('');
  lines.push('YOUR RESPONSE MUST: (1) Reflect something SPECIFIC he said — use his words. (2) Then ask ONE question or make ONE statement that pushes toward the depth target above. (3) Keep it 2-4 sentences. End with weight.');

  return lines.join('\n');
}
