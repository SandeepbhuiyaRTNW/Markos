/**
 * Embodied Man Interview — session machinery (skeleton).
 *
 * This is the structured-interview session layer the build spec described and
 * the knowledge layer (src/lib/agent/embodied-man-knowledge.ts) explicitly left
 * unbuilt: interview session phases, a consent state, the 12 sections in order,
 * and resumable sittings. It is a SKELETON:
 *
 *   - The 12 section identities (names, life stages, gates) come from the
 *     knowledge layer's SECTION_MAP — the same source the turn-by-turn craft
 *     already uses — so the two never drift.
 *   - NO deep question content lives here. The real interview questions are
 *     authored with the founder (he asked for a say). Until then the composer
 *     note (buildInterviewNote) tells Marcus which section's territory the man
 *     is in and bars him from inventing the interview's questions.
 *   - Everything here is DETERMINISTIC: no LLM, no network. Persistence lives
 *     in store.ts (Postgres); this file never touches the DB.
 *
 * Phase model:
 *   not_started       no interview row exists yet
 *   awaiting_consent  he tapped "Begin" but has not said he is ready
 *   in_progress       consent given; a sitting is open
 *   gate_pending      he advanced into a gated section (2, 5, 7) and the
 *                     section's gate has not been re-confirmed this sitting
 *   paused            he stepped away mid-interview; resume picks up the
 *                     SAME section in a new sitting, another day
 *   completed         section 12 finished; a fresh interview may begin
 */

import { SECTION_MAP } from '../agent/embodied-man-knowledge';

export type InterviewPhase =
  | 'not_started'
  | 'awaiting_consent'
  | 'in_progress'
  | 'gate_pending'
  | 'paused'
  | 'completed';

export interface InterviewSection {
  section: number;
  name: string;
  life_stage: string;
  gate: string | null;
}

/** The 12 sections, in order, straight from the knowledge layer's map. */
export const INTERVIEW_SECTIONS: readonly InterviewSection[] = SECTION_MAP.map((s) => ({
  section: s.section,
  name: s.name,
  life_stage: s.life_stage,
  gate: s.gate,
}));

export const TOTAL_SECTIONS = INTERVIEW_SECTIONS.length; // 12

/**
 * Sections whose gate is a PERMISSION gate: the interview may not enter them
 * without his fresh, plain yes (per the interview script's consent gates).
 * Section 12's gate is a conduct rule ("one prompt at a time…"), not a
 * permission gate, so it is not here.
 */
export const PERMISSION_GATED_SECTIONS: readonly number[] = [2, 5, 7];

export interface Sitting {
  started_at: string;           // ISO
  ended_at: string | null;      // ISO when paused/completed; null while open
  from_section: number;
  to_section: number;           // furthest section reached in this sitting
}

export interface InterviewState {
  phase: InterviewPhase;
  current_section: number;      // 1..12 (meaningful once consent is given)
  sections_completed: number[]; // sections finished, in order
  gate_pending: boolean;        // true while a gated section awaits re-permission
  sittings: Sitting[];
  created_at: string;
  updated_at: string;
}

export const EMPTY_INTERVIEW_STATE: InterviewState = {
  phase: 'not_started',
  current_section: 1,
  sections_completed: [],
  gate_pending: false,
  sittings: [],
  created_at: '',
  updated_at: '',
};

export function sectionAt(n: number): InterviewSection | null {
  return INTERVIEW_SECTIONS.find((s) => s.section === n) ?? null;
}

export function currentSection(state: InterviewState): InterviewSection | null {
  return sectionAt(state.current_section);
}

/** Begin: not_started/completed -> awaiting_consent. Idempotent for an open interview. */
export function beginInterview(state: InterviewState, now: string): InterviewState {
  if (state.phase === 'awaiting_consent' || state.phase === 'in_progress'
    || state.phase === 'gate_pending' || state.phase === 'paused') return state;
  return { ...state, phase: 'awaiting_consent', current_section: 1, sections_completed: [], gate_pending: false, sittings: [], updated_at: now };
}

/** Consent given at the top of the interview: opens the first sitting at section 1. */
export function grantConsent(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'awaiting_consent') return state;
  return {
    ...state,
    phase: 'in_progress',
    sittings: [{ started_at: now, ended_at: null, from_section: 1, to_section: 1 }],
    updated_at: now,
  };
}

/**
 * Advance one section. Completing section 12 completes the interview.
 * Advancing INTO a permission-gated section (2, 5, 7 — see
 * PERMISSION_GATED_SECTIONS) sets gate_pending: the section's gate must be
 * re-confirmed (acceptGate) before the next advance. The deep
 * question content is out of scope for this skeleton; the gate exists so the
 * consent machinery is real when the content lands.
 */
export function advanceSection(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'in_progress' || state.gate_pending) return state;
  const completed = state.sections_completed.includes(state.current_section)
    ? state.sections_completed
    : [...state.sections_completed, state.current_section];
  if (state.current_section >= TOTAL_SECTIONS) {
    const sittings = closeSitting(state.sittings, state.current_section, now);
    return { ...state, phase: 'completed', sections_completed: completed, sittings, updated_at: now };
  }
  const next = state.current_section + 1;
  const entersGate = PERMISSION_GATED_SECTIONS.includes(next);
  const sittings = bumpSitting(state.sittings, next);
  return {
    ...state,
    current_section: next,
    sections_completed: completed,
    gate_pending: entersGate,
    phase: entersGate ? 'gate_pending' : 'in_progress',
    sittings,
    updated_at: now,
  };
}

/** He (through Marcus) confirms the gated section's permission: resume the section. */
export function acceptGate(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'gate_pending') return state;
  return { ...state, phase: 'in_progress', gate_pending: false, updated_at: now };
}

/** He steps away: the sitting closes, progress persists for another day. */
export function pauseInterview(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'in_progress' && state.phase !== 'gate_pending') return state;
  return { ...state, phase: 'paused', sittings: closeSitting(state.sittings, state.current_section, now), updated_at: now };
}

/** Resume a paused interview: same section, new sitting — the resumable sittings the spec asked for. */
export function resumeInterview(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'paused') return state;
  return {
    ...state,
    phase: 'in_progress',
    gate_pending: PERMISSION_GATED_SECTIONS.includes(state.current_section) ? state.gate_pending : false,
    sittings: [...state.sittings, { started_at: now, ended_at: null, from_section: state.current_section, to_section: state.current_section }],
    updated_at: now,
  };
}

function closeSitting(sittings: Sitting[], atSection: number, now: string): Sitting[] {
  if (sittings.length === 0) return sittings;
  const out = [...sittings];
  const last = out[out.length - 1];
  if (last.ended_at === null) out[out.length - 1] = { ...last, ended_at: now, to_section: Math.max(last.to_section, atSection) };
  return out;
}

function bumpSitting(sittings: Sitting[], reached: number): Sitting[] {
  if (sittings.length === 0) return sittings;
  const out = [...sittings];
  const last = out[out.length - 1];
  if (last.ended_at === null) out[out.length - 1] = { ...last, to_section: Math.max(last.to_section, reached) };
  return out;
}

/**
 * The deterministic per-turn note for the Composer while an interview sitting
 * is open. Pushed into the same envelope channels every knowledge module rides
 * (domain_whisperers.context_notes) by orchestrator-v2 when the conversation
 * is tagged as an interview. NOT a script — internal guidance, and it carries
 * NO question content: until the founder authors the questions, Marcus receives
 * what the man shares inside the current section's territory and does not
 * invent the interview's questions.
 */
export function buildInterviewNote(state: InterviewState): string | null {
  if (state.phase !== 'in_progress' && state.phase !== 'gate_pending') return null;
  const section = currentSection(state);
  if (!section) return null;
  const sittingNo = state.sittings.length;
  const gateLine = state.gate_pending && section.gate
    ? `\n- GATE LIVE for this section: ${section.gate}. Do not go further into this section's sensitive territory until he has plainly said yes.`
    : '';
  return [
    `EMBODIED MAN INTERVIEW — structured session in progress (internal guidance, never read verbatim):`,
    `- He is inside the interview, Section ${section.section} of ${TOTAL_SECTIONS}: "${section.name}" (${section.life_stage}). Sitting #${sittingNo}. Sections done: ${state.sections_completed.length} of ${TOTAL_SECTIONS}.`,
    `- The interview's deep question content is NOT authored yet. Do NOT invent the interview's questions and do not announce a questionnaire. Receive whatever he brings inside this section's territory, in your usual plain voice; the embodied-man craft and guardrails still apply.`,
    `- Progress is his, not yours: never rush him to the next section, never declare a section finished for him, and if he wants to pause or stop, that is his call — acknowledge it plainly.${gateLine}`,
  ].join('\n');
}
