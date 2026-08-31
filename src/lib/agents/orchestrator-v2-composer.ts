/**
 * Orchestrator V2 Composer Pipeline — Tier 0 + Tier 5 + Boundary
 * Generates the final response using State Envelope context,
 * applies Craft Layer shaping, and runs Boundary Sentinel post-check.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { buildSystemPrompt } from '../agent/system-prompt';
import type { StateEnvelope } from './state-envelope';
import type { MoveDecision } from '../assessment/move-selector';
import { turnKindForkActive } from '../assessment/move-selector';
import type { KnowledgePlan } from '../assessment/knowledge-selector';
import { trackEnvelopeAgent, recordEnvelopeError, buildEnvelopeContextSummary } from './state-envelope-utils';
import { checkBoundary, getBoundaryOverridePrompt, runBoundarySentinel } from '../sentinels/boundary';
import { determineCraftDirectives, enforceSocraticDiscipline, applyDeepListener, enforceVocativePrinciple, detectForbiddenPhrases, detectFantasyIdentity, detectVocabSubstitutions, stripQuestionSentences } from '../craft/craft-layer';
import { buildWisdomCouncilPrompt } from '../wisdom/council';
import { getPhaseConstraints } from '../assessment/phase-mapper';
import { retrieveWisdom, retrieveQuestion, type QuestionRetrievalContext } from '../rag/retriever';
import { analyzeConversation, computeTrajectoryDrift } from './conversation-state';
import type { AgentResponse } from './orchestrator-v2';
import { MOVE_CALIBRATION, GOVERNING_BAR } from './move-calibration';
import { persistTurnMessages, type QueryFn } from './persist-messages';

export interface PreComposerResult {
  ragWisdom: string;
  legacyQuestions: string[];
  convState: Awaited<ReturnType<typeof analyzeConversation>> | null;
  questionsWereRetrieved: boolean;
  knowledgePlanUsed: KnowledgePlan | null;
}

interface ComposerPolicy {
  moveDecision: MoveDecision | null;
  knowledgePlan: KnowledgePlan | null;
  enforceMovePolicy: boolean;
}

interface MovePolicyContext {
  moveDecision: MoveDecision | null;
  enforceMovePolicy: boolean;
}

interface PriorityPolicy {
  allowQuestion: boolean;
}

/**
 * Composer pre-fetch: RAG wisdom, legacy question retrieval, and the
 * conversation-state escalation engine (loop-breaking, pushback/resistance,
 * advice-loop detection, hopelessness templates). Depends only on Tier 1/2
 * outputs (memory, listener stack, archetype, arena) — none of which the
 * Whisperer tier mutates — so the orchestrator runs it concurrently with the
 * Whisperers. Kept callable standalone (composer computes it if not supplied).
 */
export async function retrievePreComposer(
  env: StateEnvelope,
  historyStr: string,
  conversationState: Awaited<ReturnType<typeof analyzeConversation>> | null = null,
  policy: ComposerPolicy = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false },
): Promise<PreComposerResult> {
  // ═══════════════════════════════════════════
  // PRE-COMPOSER: RAG + Legacy question retrieval (parallel)
  // ═══════════════════════════════════════════
  const ragDone = trackEnvelopeAgent(env, 'rag-retrieval');
  let ragWisdom = '';
  let legacyQuestions: string[] = [];
  let questionsWereRetrieved = false;
  // Escalation engine — loop-breaking, pushback/resistance handling, advice-loop
  // detection, emotional-direction tracking, and hopelessness templates. Computed
  // in parallel with RAG so it adds no extra latency.
  let convState: Awaited<ReturnType<typeof analyzeConversation>> | null = null;
  // PART 1A — CRISIS BYPASS (hard requirement): when a crisis is detected, the
  // ENTIRE move-policy layer is disengaged this turn — no stripping, no shallowing,
  // no calibration — so the full crisis/support response passes through untouched.
  const policyEnforced = policy.enforceMovePolicy && policy.moveDecision !== null && env.sentinels.crisis.level === 'none';
  const effectivePlan = policyEnforced ? policy.knowledgePlan : null;
  const effectiveMove = policyEnforced ? policy.moveDecision : null;

  const allowQuestions = policyEnforced
    ? !!effectivePlan && effectivePlan.questions.enabled && !!effectiveMove?.ask_question
    : true;
  const allowWisdom = policyEnforced
    ? !!effectivePlan && effectivePlan.wisdom.enabled && !effectivePlan.safetyOnly
    : true;

  const retrievalCtx: QuestionRetrievalContext = {
    sessionCount: env.sentinels.memory.session_count,
    emotionDetected: env.sentinels.listener_stack?.primary_emotion,
    archetype: env.assessment.archetype?.active,
    shadow: env.assessment.archetype?.shadow || undefined,
    arena: env.assessment.arena?.primary,
    whispererScope: effectivePlan?.questions.whispererScope || undefined,
    arenaScope: effectivePlan?.questions.arenaScope || undefined,
  };

    try {
    const retrieveWisdomPromise = (async () => {
      if (!policyEnforced) return retrieveWisdom(env.utterance, 5, historyStr);
      if (!allowWisdom) return '';
      const excludeDomains = effectivePlan?.wisdom.excludeDomains ?? [];
      const towardDomains = effectivePlan?.wisdom.towardDomains ?? [];
      return retrieveWisdom(
        env.utterance,
        5,
        historyStr,
        excludeDomains,
        towardDomains,
      );
    })();

    const retrieveQuestionPromise = (async () => {
      if (!allowQuestions) return [];
      questionsWereRetrieved = true;
      return retrieveQuestion(env.utterance, env.assessment.archetype?.active, undefined, 3, retrievalCtx);
    })();

    const conversationStatePromise = conversationState
      ? Promise.resolve(conversationState)
      : analyzeConversation(env.conversation_history, env.utterance);

    const [rw, lq, cs] = await Promise.all([
      retrieveWisdomPromise,
      retrieveQuestionPromise,
      conversationStatePromise,
    ]);
    ragWisdom = rw; legacyQuestions = lq; convState = cs;
  } catch (err) { recordEnvelopeError(env, 'rag-retrieval', err); }
  finally { ragDone(); }

  env.policy_diagnostics.questions_were_retrieved = policyEnforced ? questionsWereRetrieved : null;

  return {
    ragWisdom,
    legacyQuestions,
    convState,
    questionsWereRetrieved,
    knowledgePlanUsed: policyEnforced ? effectivePlan : null,
  };
}

/**
 * Test seam (optional): inject a fake model and/or query so a REAL composer turn can be
 * exercised through its ACTUAL return path (runComposerPipeline → its own returned
 * object) without OpenAI or Postgres. Production callers pass nothing → identical
 * behavior. Used by scripts/test-w1-composer-return-path.ts to prove exactly ONE message
 * write per composer turn — i.e. the composer does NOT also return through buildResponse.
 */
export interface ComposerTestHooks {
  model?: { invoke(messages: (SystemMessage | HumanMessage | AIMessage)[]): Promise<{ content: unknown }> };
  queryFn?: QueryFn;
}

export async function runComposerPipeline(
  env: StateEnvelope,
  historyStr: string,
  pre?: PreComposerResult,
  policy: ComposerPolicy = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false },
  testHooks?: ComposerTestHooks,
): Promise<AgentResponse> {
  // Pre-fetch is supplied by the orchestrator (run concurrently with Whisperers);
  // fall back to computing it here when the composer is invoked standalone.
  const { ragWisdom, legacyQuestions, convState, questionsWereRetrieved, knowledgePlanUsed } = pre
    ?? await retrievePreComposer(env, historyStr, null, policy);

  // PART 1A — CRISIS BYPASS (hard requirement): when a crisis is detected, the
  // ENTIRE move-policy layer is disengaged this turn — no stripping, no shallowing,
  // no calibration — so the full crisis/support response passes through untouched.
  const policyEnforced = policy.enforceMovePolicy && policy.moveDecision !== null && env.sentinels.crisis.level === 'none';
  const effectiveMove = policyEnforced ? policy.moveDecision : null;
  const effectivePlan = policyEnforced ? policy.knowledgePlan : knowledgePlanUsed;
  const questionAllowedByMove = policyEnforced ? !!effectiveMove?.ask_question : true;
  const questionAllowedByPolicy = policyEnforced
    ? !!effectivePlan && effectivePlan.questions.enabled && questionAllowedByMove
    : true;
  const includeWhispererContext = !policyEnforced || !!effectivePlan?.includeWhispererOutput;
  const scopedWhispererQuestions = policyEnforced && effectivePlan && questionAllowedByPolicy
    ? filterWhispererQuestionsByScope(env.domain_whisperers.question_candidates, effectivePlan.questions.whispererScope)
    : env.domain_whisperers.question_candidates;
  const allQuestionTexts = [
    ...scopedWhispererQuestions.map(q => q.text),
    ...(questionAllowedByPolicy ? legacyQuestions : []),
  ];
  // Enforce at most one selected question for this turn, so the generation stack
  // cannot treat one prompt as a menu of question options.
  const uniqueQuestions = [...new Set(allQuestionTexts)].slice(0, 1);
  const questionCandidatesPassed = uniqueQuestions.length > 0 && questionAllowedByPolicy;
  const policyContext: MovePolicyContext = {
    moveDecision: effectiveMove,
    enforceMovePolicy: policyEnforced,
  };
  const priorityPolicy: PriorityPolicy = {
    allowQuestion: questionAllowedByPolicy,
  };

  env.policy_diagnostics.question_candidates_passed = policyEnforced ? questionCandidatesPassed : null;

  // ═══════════════════════════════════════════
  // TIER 5 — CRAFT LAYER (pre-Composer directives)
  // ═══════════════════════════════════════════
  const prePolicyForm = env.craft_directives.form;
  env.craft_directives = determineCraftDirectives(env);
  if (policyContext.enforceMovePolicy && policyContext.moveDecision) {
    env.craft_directives = applyMoveCraftPolicy(env.craft_directives, policyContext.moveDecision);
    env.policy_diagnostics.move_conflict = env.craft_directives.form !== prePolicyForm;
  }

  // ═══════════════════════════════════════════
  // TIER 0 — COMPOSER (Marcus's single voice)
  // ═══════════════════════════════════════════
  const composerDone = trackEnvelopeAgent(env, 'composer');
  try {
    const model: NonNullable<ComposerTestHooks['model']> = testHooks?.model ?? (new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.75,
      maxTokens: 350,
      maxRetries: 1, // kill the hidden 2x SDK retry latency multiplier on the critical path
    }) as unknown as NonNullable<ComposerTestHooks['model']>);

    // Build the context injection from State Envelope
    const envelopeContext = buildEnvelopeContextSummary(env, {
      includeQuestionCandidates: questionAllowedByPolicy,
      includeWhispererContext,
    });
    const wisdomCouncilPrompt = buildWisdomCouncilPrompt(env.wisdom_council);
    const phaseConstraints = getPhaseConstraints(env.assessment.phase.label);

    // Meet him where he is: the phase max_depth gates how hard we PUSH, but a man who
    // brings depth (raw grief, divorce, a shame never spoken) must be MET at that depth,
    // even in early sessions. Challenge stays trust-gated; presence is content-gated.
    const presentedDepth = env.sentinels.listener_stack?.depth_level || 1;
    const effectiveMaxDepth = Math.max(phaseConstraints.max_depth, presentedDepth);
    // W3: push depth is capped at ONE step past what he brought this turn (and
    // never past the phase ceiling). A phase may ALLOW challenge up to 4-5, but
    // a man who brought small talk gets presence, not a probe.
    const challengeCeiling = phaseConstraints.can_challenge
      ? computeChallengeCeiling(phaseConstraints.max_depth, presentedDepth)
      : 0;

    // Phase constraints — inject into prompt so Composer knows depth/challenge permissions
    const phaseAddendum = `\n\n## PHASE CONSTRAINTS (${env.assessment.phase.label.toUpperCase()})
Meet-him depth (match this — he brought it): ${effectiveMaxDepth}/5 | Push ceiling this turn: ${challengeCeiling === 0 ? 'none — presence and reflection only' : `${challengeCeiling}/5 (at most one step past what he offered, capped by phase)`}
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
      ragContext: ragWisdom + (questionCandidatesPassed
        ? `\n\n## SUGGESTED QUESTIONS (choose at most ONE):\n${uniqueQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : ''),
      kwmlContext: kwmlStr,
      understandingContext: understandingStr,
      // W13: live turns get the SAME continuity anchors the opener spoke from,
      // so the first reply after a memory-aware opener is not a stranger.
      sessionHistory: [env.sentinels.memory.session_history, env.sentinels.memory.last_session_continuity]
        .filter(Boolean).join('\n\n') || undefined,
      userName: env.user_name || undefined,
      stylePreferences: env.sentinels.memory.style_preferences || undefined,
    });

    // Build priority hierarchy — the Composer's marching orders for THIS turn
    const priorityHierarchy = buildPriorityHierarchy(env, priorityPolicy);
    const moveDirective = renderMoveDirective(policyContext);

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
    const fullSystem = `${systemContent}\n\n${envelopeContext}\n\n${wisdomCouncilPrompt}${phaseAddendum}${craftAddendum}\n\n${moveDirective}\n${priorityHierarchy}${escalationAddendum}`;

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
    content = enforceMovePolicy(content, policyContext);

    // ═══════════════════════════════════════════
    // POST-COMPOSER: Craft Layer shaping
    // ═══════════════════════════════════════════
    const isSilenceBreaking = env.sentinels.listener_stack?.depth_level
      ? env.sentinels.listener_stack.depth_level >= 4
      : false;
    content = enforceSocraticDiscipline(content, env.craft_directives);
    content = applyDeepListener(content, env.craft_directives, isSilenceBreaking);
    content = enforceMovePolicy(content, policyContext);

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
        content = enforceMovePolicy(content, policyContext);
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
          content = enforceMovePolicy(content, policyContext);
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
        content = enforceMovePolicy(content, policyContext);
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
        content = enforceMovePolicy(content, policyContext);
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
        content = enforceMovePolicy(content, policyContext);
      } else {
        skippedGates.push('forbidden-phrase');
      }
    }

    if (skippedGates.length > 0) {
      console.log(`[V2] ⏭ Regen cap (${MAX_REGENS}) reached — skipped: ${skippedGates.join(', ')} (kept best draft)`);
    }

    // 4. Vocative Principle Filter — ALWAYS runs last, strips banned vocatives
    content = enforceVocativePrinciple(content, env.user_name);
    content = enforceMovePolicy(content, policyContext);

    // Crisis resource enforcement for elevated/passive crisis
    if (env.sentinels.crisis.level === 'elevated' && !content.includes('988')) {
      content += `\n\n${env.user_name ? env.user_name + ' — ' : ''}988 Suicide & Crisis Lifeline: call or text 988. Crisis Text Line: text HOME to 741741.`;
    }

    const finalQuestionCount = countQuestionSentences(content);
    if (policyContext.enforceMovePolicy && policyContext.moveDecision) {
      if (!questionAllowedByPolicy && finalQuestionCount > 0) {
        console.warn('[V2 Policy] Move selected no-question, but content still contains a question');
        env.policy_diagnostics.no_question_override_active = true;
        env.policy_diagnostics.move_conflict = true;
      } else if (env.policy_diagnostics.move_conflict === false) {
        env.policy_diagnostics.no_question_override_active = false;
      }
      if (effectivePlan && effectivePlan.safetyOnly) {
        env.policy_diagnostics.knowledge_rule = effectivePlan.rule;
      }
    } else {
      env.policy_diagnostics.no_question_override_active = null;
    }
    // Final diagnostic: was a question actually produced?
    env.policy_diagnostics.final_form = env.craft_directives.form;
    env.policy_diagnostics.final_question_count = finalQuestionCount;
    if (questionsWereRetrieved && policyContext.enforceMovePolicy && policyContext.moveDecision) {
      if (!questionAllowedByPolicy) {
        console.warn('[V2 Policy] Question retrieval ran despite policy asking for no question');
        env.policy_diagnostics.questions_were_retrieved = true;
      }
    }
    env.policy_diagnostics.questions_enabled = policyContext.enforceMovePolicy ? !!effectivePlan?.questions.enabled : env.policy_diagnostics.questions_enabled;

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
  // STORE + OBSERVABILITY (message write AWAITED; memory/KWML/CI fire-and-forget)
  // ═══════════════════════════════════════════
  // W4: AWAIT the two message inserts before returning so the exchange is persisted
  // before the reply goes back (message write moved OFF fire-and-forget). Timed +
  // logged inside persistTurnMessages; never throws.
  const userMsgId = await persistTurnMessages(env, testHooks?.queryFn, 'composer');
  // Memory / KWML / Conversation-Intelligence stay FIRE-AND-FORGET — the slow
  // gpt-4o-mini work must never sit on the awaited reply path.
  storeInBackground(env, userMsgId).catch(err => console.error('[V2] Background store error:', err));

  // Turn logging — AWAITED so the turn_logs row exists before processMessage
  // returns. The API route then reliably attaches route_total_ms via UPDATE,
  // deterministic even on the text path (which has no TTS settle window).
  // logTurn never throws (it catches internally). Cost is one INSERT (~10-30ms);
  // on the voice path this insert previously overlapped the awaited TTS, so
  // end-to-end grows only by that insert. total_ms is measured earlier (right
  // after final_response) and is unaffected.
  await import('../observability/turn-logger').then(({ logTurn }) => logTurn(env, testHooks?.queryFn)).catch(() => {});

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
async function storeInBackground(env: StateEnvelope, userMsgId: string | null): Promise<void> {
  // W4: the message write moved onto the awaited path (persistTurnMessages in the
  // composer). This tier is now ONLY the slow memory / KWML / Conversation-Intelligence
  // work and stays fire-and-forget. It needs the user message id from that write.
  if (userMsgId === null) return; // message write failed upstream — skip extraction
  const { extractMemories } = await import('../memory/memory-manager');
  const { saveKWMLProfile } = await import('../kwml/detector');
  const { runConversationIntelligence } = await import('../intelligence');

  try {
    await Promise.all([
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
export function buildPriorityHierarchy(env: StateEnvelope, policy: PriorityPolicy = { allowQuestion: true }): string {
  const ls = env.sentinels.listener_stack;
  const whisperers = env.domain_whisperers;
  const depth = ls?.depth_level || 1;
  const phase = env.assessment.phase.label;

  const lines: string[] = [
    '## ⚡ COMPOSER PRIORITY — READ THIS LAST, OBEY THIS FIRST',
    '',
  ];

  // ── Turn-kind fork (feature/marcus-turn-kind; inert unless turnKindForkActive) ──
  const forkActive = turnKindForkActive();
  const kind = ls?.turn_kind;

  // Unfinished thought — fires on ANY kind: he was cut off, so do not push deep or answer a
  // half-thought. Reflect what he DID say and hand the cut-off piece back to finish (#6).
  if (forkActive && ls?.unfinished === true) {
    lines.push('PRIORITY 0 — UNFINISHED THOUGHT:');
    lines.push('His message ends mid-sentence — he was cut off before finishing. Notice that out loud and invite him to finish it. Do NOT pivot to a new question or a new topic, and do NOT answer a thought he has not completed. Reflect what he DID say, point at the piece that got cut off, and hand it back so he can complete it.');
    if (kind === 'problem_work' || kind === 'mixed') {
      lines.push('This is problem-work: reflect the fork he already named, in his words — but do NOT solve past the point he got cut off. Name the unfinished piece and let him finish it.');
    } else {
      lines.push('Reflect what he said and hold the space; let him complete the thought before anything deeper.');
    }
    return lines.join('\n');
  }

  // Problem-work / mixed — engage the DECISION, never emotionalize it. Suppresses the
  // silence-question + depth-move injection (PRIORITY 1/2) and the go-deeper depth check.
  if (forkActive && (kind === 'problem_work' || kind === 'mixed')) {
    lines.push('THIS IS PROBLEM-WORK — HE IS THINKING THROUGH A DECISION, NOT ASKING TO BE UNDERSTOOD EMOTIONALLY.');
    lines.push('ENGAGE THE DECISION:');
    lines.push('- Reflect the actual fork he has ALREADY named, in HIS OWN words — no more abstract than he put it.');
    lines.push('- Then engage the thing he is deciding: name the concrete unknown, tradeoff, or next step that would move it forward. Useful beats deep here.');
    lines.push('- Do NOT invent a hidden feeling. Do NOT ask what this is "really about," what it is "pulling him away from," or what is "underneath" it. There is no underneath unless HE puts one there.');
    lines.push('- A question is good — about the DECISION. No feelings question this turn unless he opened that door.');
    if (kind === 'mixed') {
      lines.push('- He named a real feeling alongside the decision. You may use it as a decision INPUT (which option he can live with) — but do not pry it open with a feelings question. The door only opens if he opens it.');
    }
    if (whisperers.context_notes.length > 0 || whisperers.landmines.length > 0) {
      lines.push('');
      lines.push('DOMAIN INTELLIGENCE:');
      if (whisperers.context_notes.length > 0) lines.push(`Clinical context: ${whisperers.context_notes.join(' | ')}`);
      if (whisperers.landmines.length > 0) lines.push(`AVOID: ${whisperers.landmines.join('; ')}`);
    }
    lines.push('');
    lines.push('YOUR RESPONSE MUST: (1) Reflect the fork he named, in his words. (2) Engage the actual decision — the unknown or tradeoff that moves it. (3) Short and plain. No manufactured depth.');
    return lines.join('\n');
  }

  // ── Below: emotional_disclosure / casual / fork-off — UNCHANGED existing behavior ──
  // Priority 1: If we are allowed to ask, the silence question is still highest.
  if (policy.allowQuestion && ls?.silence_question) {
    lines.push(`PRIORITY 1 — SILENCE QUESTION (from Listener Stack):`);
    lines.push(`"${ls.silence_question}"`);
    lines.push(`This is the deepest question AVAILABLE for this moment — a candidate, not a command. Use it if it follows naturally from what he actually said this turn and the trust you have built together. If he brought something lighter, or it would land as a non-sequitur, a smaller question in his own words is the better move. Answering what he said always beats chasing depth.`);
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
    lines.push(`DEPTH CHECK: You are at depth ${depth}/5. Go deeper ONLY if he opened a door this turn — he lingered on something, named a stake, got quieter, or asked something back. If he brought small talk or logistics, stay with him there: reflect it, be useful, be warm. A shallow turn he enjoys beats a deep probe he never asked for.`);
  } else if (depth >= 4) {
    lines.push(`DEPTH CHECK: You are at depth ${depth}/5. This is sacred ground. Honor it. Mirror his truth. Do not retreat to safety.`);
  }

  // Phase-specific instruction
  if (phase === 'unleashed' || phase === 'brothered') {
    lines.push(`PHASE NOTE: This man is in ${phase.toUpperCase()}. He can handle challenge and direct confrontation. Do NOT default to empathy-first. Lead with the provocation, then hold him through it.`);
  }

  lines.push('');
  lines.push(policy.allowQuestion
    ? 'YOUR RESPONSE MUST: (1) Reflect something SPECIFIC he said — use his words. (2) Then ask ONE question or make ONE statement that meets him where he is — deeper only if he opened the door this turn. (3) Keep it 2-4 sentences. End with weight.'
    : 'YOUR RESPONSE MUST: (1) Reflect something SPECIFIC he said — use his words. (2) Then make ONE statement that meets him where he is — deeper only if he opened the door this turn. (3) Keep it 2-4 sentences. End with weight.');

  return lines.join('\n');
}

export function renderMoveDirective(policy: MovePolicyContext): string {
  if (!policy.enforceMovePolicy || !policy.moveDecision) return '';
  const move = policy.moveDecision;
  // PART 1A: crisis owns the turn — inject NO move directive on a crisis turn.
  if (move.move === 'crisis_protocol') return '';
  const allowQuestionText = move.ask_question ? 'MAY ASK' : 'MUST NOT ASK';
  const tooEarly = move.too_early_to_address.length > 0
    ? `topics deferred this turn: ${move.too_early_to_address.join(', ')}`
    : 'no topic deferral';
  // Inject ONLY the selected move's calibration (moment / voice / length).
  const cal = MOVE_CALIBRATION[move.move];
  const calBlock = cal ? `\nMoment: ${cal.moment}\nVoice: ${cal.voice}\nLength: ${cal.length}` : '';
  // Non-asking moves: a plain reaction with NO question is the right, frequent move.
  const noAskBlock = move.ask_question
    ? ''
    : '\nDo NOT end on a question this turn — but don\'t leave it a dead stop either: land on a statement, then leave a soft door open (a half-thought, an observation that invites a reply, or plain warmth and space). React like a friend, not an interviewer. This overrides any instinct to tack on a question.';
  // v3: the governing bar rides ABOVE the per-move calibration on every non-crisis
  // enforced turn — the depth mandate (add insight, don't just mirror; vary the
  // shape; read the mode; hold space when that's truer). Crisis returned '' above.
  return `\n\n## MOVE POLICY (talk like Marcus — a real guy, not a therapist; short, plain, human)\n${GOVERNING_BAR}\n\nDecision: ${move.move}\nQuestion policy: ${allowQuestionText}\nRequired craft form: ${move.craft_form}\n${tooEarly}.${calBlock}${noAskBlock}`;
}

/**
 * W3: push/challenge depth for this turn — at most ONE level past the depth he
 * presented, and never past the phase ceiling. Presence depth is NOT clamped by
 * this (meeting him where he is stays content-gated); only the adversarial push
 * is. Exported for unit tests.
 */
export function computeChallengeCeiling(phaseMaxDepth: number, presentedDepth: number): number {
  return Math.max(1, Math.min(phaseMaxDepth, presentedDepth + 1));
}

function countQuestionSentences(text: string): number {
  return (text.match(/\?/g) || []).length;
}

export function enforceMovePolicy(content: string, policy: MovePolicyContext): string {
  if (!policy.enforceMovePolicy || !policy.moveDecision) return content;
  // PART 1A: NEVER strip a crisis response — it keeps its full support + safety
  // question (988 / somewhere-safe). Crisis overrides all pacing, always.
  if (policy.moveDecision.move === 'crisis_protocol') return content;
  if (policy.moveDecision.ask_question) return content;
  // Backstop for a no-ask move: strip any question the persona still produced.
  return stripQuestionSentences(content);
}

function filterWhispererQuestionsByScope(
  questions: StateEnvelope['domain_whisperers']['question_candidates'],
  scope: string[] | null,
): typeof questions {
  if (!scope || scope.length === 0) return questions;
  const lower = scope.map((s) => s.toLowerCase());
  return questions.filter((q) => lower.includes((q.whisperer || '').toLowerCase()));
}

function applyMoveCraftPolicy(current: StateEnvelope['craft_directives'], moveDecision: MoveDecision): StateEnvelope['craft_directives'] {
  const next: StateEnvelope['craft_directives'] = {
    ...current,
    form: moveDecision.craft_form,
  };

  const isQuestion = moveDecision.ask_question;
  if (!isQuestion) {
    const base = next.style_override ?? '';
    const containsQuestionDirective = /(question|ask|probe|inquire|deeper|ask him|ask her)/i.test(base);
    if (containsQuestionDirective) {
      next.style_override = null;
    } else if (!base) {
      next.style_override = null;
    }
  }
  return next;
}
