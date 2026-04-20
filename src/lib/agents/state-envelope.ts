/**
 * State Envelope — The data structure that moves through the system every turn.
 * Per §10 of the Markos Multi-Agent Architecture v1.
 *
 * Every agent reads what it needs from the Envelope and writes its output back.
 * The Composer consumes the fully populated Envelope to produce the response.
 */

import type { UnderstandingAnalysis } from '../understanding/stack';
import type { KWMLReading } from '../kwml/detector';

// ─── Sentinel Outputs ───

export interface ListenerStackOutput {
  words: string;
  emotion: string;
  pattern: string;
  the_man: string;
  the_silence: string;
  depth_level: number;
  depth_opportunity: string;
  silence_question: string;
  emotional_trajectory: string;
  primary_emotion: string;
}

export type CrisisLevel = 'none' | 'elevated' | 'acute';
export type CrisisType = 'suicide' | 'violence_toward_others' | 'domestic_violence_perpetrating'
  | 'domestic_violence_victim' | 'substance_crisis' | 'passive_crisis' | null;

export interface CrisisOutput {
  level: CrisisLevel;
  type: CrisisType;
  protocol: string | null;
  forced_response: string | null;
}

export interface BoundaryOutput {
  enforcement_level: 'standard' | 'elevated';
  violations_found: string[];
  revision_needed: boolean;
}

export interface PathwayCandidate {
  target: string;       // e.g., 'therapy', 'mens_circle', 'crisis_line', 'partner_org'
  description: string;
  when: 'now' | 'later' | 'not_yet';
  confidence: number;
}

export interface PathwayRouterOutput {
  candidates: PathwayCandidate[];
}

export interface MemoryOutput {
  prior_threads: string[];
  session_history: string | null;
  session_count: number;
  memory_context: string | null;
  style_preferences: string | null;
  returning_patterns: string[];
}

export interface CulturalOutput {
  region: string | null;
  register: 'formal' | 'casual' | 'raw' | 'neutral';
  faith_context: string | null;
  generation: string | null;
}

// ─── Assessment Ring Outputs ───

export type Phase = 'unsilenced' | 'unleashed' | 'brothered';

export interface PhaseOutput {
  label: Phase;
  confidence: number;
}

export interface ArchetypeOutput {
  active: string;
  shadow: string | null;
  confidence: number;
  reading: KWMLReading | null;
}

export interface TrustOutput {
  cognitive: number;   // 0-1
  affective: number;   // 0-1
}

export type SilenceType = 'shame' | 'grief' | 'avoidance' | 'protective' | 'honest_reflection';

export interface SilenceTypeOutput {
  label: SilenceType;
  evidence: string;
  confidence: number;
}

export interface ArenaWeights {
  [arena: string]: number;  // e.g., { divorce: 0.6, love: 0.4 }
}

export interface ArenaOutput {
  weights: ArenaWeights;
  primary: string;
}

// ─── Tier 3 + 4 + 5 ───

export interface WisdomCouncilOutput {
  invoked: string[];   // e.g., ['stoic', 'existentialist']
}

export interface WhispererQuestionCandidate {
  question_id: string;
  text: string;
  whisperer: string;
  relevance_score: number;
}

export interface DomainWhisperersOutput {
  invoked: string[];   // e.g., ['divorce']
  question_candidates: WhispererQuestionCandidate[];
  frameworks_applied: string[];
}

export interface CraftDirectives {
  form: 'question' | 'statement' | 'reflection' | 'challenge' | 'presence';
  pacing: 'full' | 'short' | 'acknowledgment_only';
  metaphor_hint: string | null;
  style_override: string | null;
}

// ─── The State Envelope ───

export interface StateEnvelope {
  // Identity
  turn_id: string;
  user_id: string;
  conversation_id: string;
  timestamp: string;
  utterance: string;
  conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>;
  user_name: string | null;

  // Tier 1 — Sentinels
  sentinels: {
    listener_stack: ListenerStackOutput | null;
    crisis: CrisisOutput;
    boundary: BoundaryOutput;
    pathway_router: PathwayRouterOutput;
    memory: MemoryOutput;
    cultural: CulturalOutput;
  };

  // Tier 2 — Assessment Ring
  assessment: {
    phase: PhaseOutput;
    archetype: ArchetypeOutput | null;
    trust: TrustOutput;
    silence_type: SilenceTypeOutput | null;
    arena: ArenaOutput | null;
  };

  // Tier 3 — Wisdom Council
  wisdom_council: WisdomCouncilOutput;

  // Tier 4 — Domain Whisperers
  domain_whisperers: DomainWhisperersOutput;

  // Tier 5 — Craft Layer
  craft_directives: CraftDirectives;

  // Outputs
  composer_output: string | null;
  final_response: string | null;

  // Metadata
  active_agents: string[];
  agent_timings: Record<string, number>;
  errors: Array<{ agent: string; error: string }>;
}

