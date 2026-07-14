/**
 * Conversation Intelligence — shared types.
 *
 * This layer sits ON TOP OF the 7-layer memory_layers fact store (extractMemories).
 * It does not extract isolated facts; it understands each conversation as an event:
 * emotional arc, people, open loops, follow-ups, and vocabulary-growth moments.
 */

/** One point on the conversation's emotional arc — appended cheaply every turn. */
export interface ArcPoint {
  turn: number;
  emotion: string;
  depth: number;
  silence_type: string | null;
  arena: string | null;
}

export interface CIPerson {
  name: string;
  relationship: string;
  sentiment: string;
  note: string;
}

export interface VocabMoment {
  from: string;   // the vague word he started with
  to: string;     // the more precise feeling he reached
  quote: string;  // his exact words
}

export interface NewOpenLoop {
  summary: string;
  salience: number;   // 0..1
  people: string[];
}

export interface ResolvedOpenLoop {
  id: string;         // id of an existing open loop supplied to the model
  resolution: string;
}

export interface CIFollowUp {
  prompt: string;
  trigger: 'next_session' | 'time' | 'event';
  value: number;      // 0..1 priority
}

/** The batched gpt-4o-mini extraction result (normalized). */
export interface CIExtraction {
  headline: string;
  people: CIPerson[];
  vocabulary_moments: VocabMoment[];
  what_changed: string;
  new_open_loops: NewOpenLoop[];
  resolved_open_loops: ResolvedOpenLoop[];
  referenced_open_loops: string[];  // existing loop ids touched again but still open
  follow_ups: CIFollowUp[];
}

/** Minimal existing-loop shape passed into the model so it can resolve/reference. */
export interface ExistingLoop {
  id: string;
  summary: string;
}
