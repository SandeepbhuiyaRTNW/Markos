/**
 * State Envelope utilities — factory, tracking, context building
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  StateEnvelope, ListenerStackOutput, CrisisOutput, BoundaryOutput,
  PathwayRouterOutput, MemoryOutput, CulturalOutput, PhaseOutput,
  ArchetypeOutput, TrustOutput, SilenceTypeOutput, ArenaOutput,
  WisdomCouncilOutput, DomainWhisperersOutput, CraftDirectives,
} from './state-envelope';

/** Create a fresh State Envelope for a new turn */
export function createStateEnvelope(params: {
  userId: string;
  conversationId: string;
  utterance: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  userName?: string | null;
}): StateEnvelope {
  return {
    turn_id: uuidv4(),
    user_id: params.userId,
    conversation_id: params.conversationId,
    timestamp: new Date().toISOString(),
    utterance: params.utterance,
    conversation_history: params.conversationHistory,
    user_name: params.userName ?? null,

    sentinels: {
      listener_stack: null,
      crisis: { level: 'none', type: null, protocol: null, forced_response: null },
      boundary: { enforcement_level: 'standard', violations_found: [], revision_needed: false },
      pathway_router: { candidates: [] },
      memory: {
        prior_threads: [], session_history: null, session_count: 0,
        memory_context: null, style_preferences: null, returning_patterns: [],
      },
      cultural: { region: null, register: 'neutral', faith_context: null, generation: null },
    },

    assessment: {
      phase: { label: 'unsilenced', confidence: 0.5 },
      archetype: null,
      trust: { cognitive: 0.5, affective: 0.2 },
      silence_type: null,
      arena: null,
      perma: null,
    },

    wisdom_council: { invoked: [] },
    domain_whisperers: { invoked: [], question_candidates: [], frameworks_applied: [] },
    craft_directives: { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null },

    composer_output: null,
    final_response: null,
    active_agents: [],
    agent_timings: {},
    errors: [],
  };
}

/** Track agent execution timing on the envelope */
export function trackEnvelopeAgent(env: StateEnvelope, agentName: string): () => void {
  env.active_agents.push(agentName);
  const start = Date.now();
  return () => {
    env.agent_timings[agentName] = Date.now() - start;
    env.active_agents = env.active_agents.filter(a => a !== agentName);
  };
}

/** Record an agent error without failing the pipeline */
export function recordEnvelopeError(env: StateEnvelope, agent: string, error: unknown): void {
  env.errors.push({
    agent,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(`[Envelope] Agent "${agent}" error:`, error);
}

/** Convert ListenerStack (UnderstandingAnalysis) to Envelope format */
export function listenerStackFromAnalysis(analysis: import('../understanding/stack').UnderstandingAnalysis): ListenerStackOutput {
  return {
    words: analysis.layer1_words,
    emotion: analysis.layer2_emotion,
    pattern: analysis.layer3_pattern,
    the_man: analysis.layer4_the_man,
    the_silence: analysis.layer5_the_silence,
    depth_level: analysis.depth_level,
    depth_opportunity: analysis.depth_opportunity,
    silence_question: analysis.silence_question,
    emotional_trajectory: analysis.emotional_trajectory,
    primary_emotion: analysis.primary_emotion,
  };
}

/** Build a formatted context summary from the State Envelope for the Composer */
export function buildEnvelopeContextSummary(env: StateEnvelope): string {
  const parts: string[] = [];
  const mem = env.sentinels.memory;
  if (mem.memory_context && mem.memory_context !== 'No memories stored for this user yet.') {
    parts.push(`## MEMORY CONTEXT\n${mem.memory_context}`);
  }
  if (env.sentinels.listener_stack) {
    const ls = env.sentinels.listener_stack;
    parts.push(`## UNDERSTANDING ANALYSIS\nEmotion: ${ls.primary_emotion} | Depth: ${ls.depth_level}/5 | Trajectory: ${ls.emotional_trajectory}\nPattern: ${ls.pattern}\nThe Man: ${ls.the_man}\nThe Silence: ${ls.the_silence}`);
    if (ls.silence_question) parts.push(`### SILENCE QUESTION\n"${ls.silence_question}"`);
    if (ls.depth_opportunity) parts.push(`### DEPTH MOVE\n${ls.depth_opportunity}`);
  }
  if (env.assessment.silence_type) {
    parts.push(`## SILENCE TYPE: ${env.assessment.silence_type.label.toUpperCase()}\nEvidence: ${env.assessment.silence_type.evidence}`);
  }
  if (env.assessment.arena) {
    const arenas = Object.entries(env.assessment.arena.weights).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`);
    parts.push(`## ARENA: ${arenas.join(', ')}`);
  }
  if (env.assessment.archetype?.reading) {
    const r = env.assessment.archetype.reading;
    parts.push(`## KWML: ${env.assessment.archetype.active}${env.assessment.archetype.shadow ? ` (shadow: ${env.assessment.archetype.shadow})` : ''}\nK:${r.king} W:${r.warrior} M:${r.magician} L:${r.lover}`);
  }
  if (env.assessment.perma?.underwater_domain) {
    const p = env.assessment.perma;
    parts.push(`## PERMA: underwater=${p.underwater_domain} | P:${p.scores.P} E:${p.scores.E} R:${p.scores.R} M:${p.scores.M} A:${p.scores.A}`);
  }
  if (env.wisdom_council.invoked.length > 0) {
    parts.push(`## WISDOM COUNCIL: ${env.wisdom_council.invoked.join(', ')}`);
  }
  if (env.domain_whisperers.question_candidates.length > 0) {
    const qs = env.domain_whisperers.question_candidates;
    const trust = env.assessment.trust;
    const trustLabel = mem.session_count <= 2 ? 'NEW' : mem.session_count <= 5 ? 'DEVELOPING' : mem.session_count <= 15 ? 'ESTABLISHED' : 'DEEP';
    parts.push(`## QUESTIONS (Trust: ${trustLabel}, Session #${mem.session_count})\nPRIMARY: ${qs[0].text}${qs.length > 1 ? `\nALTERNATIVES:\n${qs.slice(1, 4).map((q, i) => `${i + 2}. ${q.text}`).join('\n')}` : ''}`);
  }
  if (env.sentinels.pathway_router.candidates.length > 0) {
    const now = env.sentinels.pathway_router.candidates.filter(c => c.when === 'now');
    if (now.length > 0) parts.push(`## PATHWAY BRIDGES (ready now):\n${now.map(c => `- ${c.description}`).join('\n')}`);
  }
  const phase = env.assessment.phase.label;
  parts.push(`## PHASE: ${phase.toUpperCase()} (confidence: ${env.assessment.phase.confidence.toFixed(2)})`);
  parts.push(`## TRUST: cognitive=${env.assessment.trust.cognitive.toFixed(2)}, affective=${env.assessment.trust.affective.toFixed(2)}`);
  return parts.join('\n\n');
}

