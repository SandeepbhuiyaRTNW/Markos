/**
 * Embodied Man Interview — session machinery.
 *
 * This is the structured-interview session layer the build spec described and
 * the knowledge layer (src/lib/agent/embodied-man-knowledge.ts) explicitly left
 * unbuilt: interview session phases, a consent state, the 12 sections in order,
 * and resumable sittings:
 *
 *   - The 12 section identities (names, life stages, gates) come from the
 *     knowledge layer's SECTION_MAP — the same source the turn-by-turn craft
 *     already uses — so the two never drift.
 *   - The question content lives in embodied-questions.ts (verbatim from the
 *     Embodied Man script, provided 2026-09-22). The composer note
 *     (buildInterviewNote) hands Marcus the current section's main questions,
 *     follow-ups, and menus, plus the script's host rules.
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
import { buildSectionContentLines, HOST_RULES } from './embodied-questions';

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
 * re-confirmed (acceptGate) before the next advance. While the gate is live
 * the composer note tells Marcus to get his plain yes first (Section 7: the
 * scripted consent check is the only permitted first turn).
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

/**
 * Resume a paused interview: same section, new sitting — the resumable sittings
 * the spec asked for. A new sitting re-enters a permission-gated section fresh,
 * so the gate is always re-armed regardless of the pre-pause flag: resuming
 * lands in `gate_pending` for gated sections (re-consent required) and plain
 * `in_progress` otherwise. This keeps the phase and the `gate_pending` flag in
 * lockstep — the two ever drifting apart is what let a paused gate either skip
 * re-consent or wedge advance/acceptGate against each other.
 */
export function resumeInterview(state: InterviewState, now: string): InterviewState {
  if (state.phase !== 'paused') return state;
  const gated = PERMISSION_GATED_SECTIONS.includes(state.current_section);
  return {
    ...state,
    phase: gated ? 'gate_pending' : 'in_progress',
    gate_pending: gated,
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
 * is open. Rides env.domain_whisperers.session_notes (orchestrator-v2), which
 * renders on every turn — NOT subject to the whisperer coaching cap or the
 * move-policy whisperer toggle — because while he is in the interview this is
 * the mode itself, not optional coaching. Internal guidance, never a script
 * read aloud as a block. It carries the current section's question content
 * VERBATIM from the Embodied Man script (embodied-questions.ts) plus the
 * standing host rules from the script and build spec.
 */
export function buildInterviewNote(state: InterviewState): string | null {
  if (state.phase !== 'in_progress' && state.phase !== 'gate_pending') return null;
  const section = currentSection(state);
  if (!section) return null;
  const sittingNo = state.sittings.length;
  const firstSittingStart = sittingNo <= 1 && state.current_section === 1 && state.sections_completed.length === 0;
  const gateLine = state.gate_pending && section.gate
    ? `\n- GATE LIVE for this section: ${section.gate}. Do not go further into this section's sensitive territory until he has plainly said yes.`
    : '';
  // Every sitting (and every re-entry into an open sitting) is a NEW
  // conversation, so earlier answers and his Before Recording boundaries are
  // not in this conversation's history. Nothing per-question is persisted yet,
  // so the note says so plainly instead of pretending continuity.
  const continuityLine = firstSittingStart
    ? ''
    : `\n- Earlier parts of the interview happened in other conversations you cannot see here. If this conversation has not done it yet: a short present-moment check-in, then ask once, briefly, whether there is anything he wants you to stay away from today. Do not guess what he said before and do not claim to remember it. If you are not sure which of this section's main questions he already answered, ask him where he wants to pick up rather than repeating one.`;
  return [
    `EMBODIED MAN INTERVIEW — structured session in progress (internal guidance, never read verbatim). This outranks any other question suggestion this turn.`,
    `- You are hosting the interview: open, ask, listen, pace, honor his limits. Not therapy, not coaching, not assessment. He is in Section ${section.section} of ${TOTAL_SECTIONS}: "${section.name}" (${section.life_stage}). Sitting #${sittingNo}. Sections done: ${state.sections_completed.length} of ${TOTAL_SECTIONS}.`,
    `- Progress is his, not yours: never rush him to the next section, never declare a section finished for him, and if he wants to pause, skip, or stop, that is his call — acknowledge it plainly. When this section's main questions are asked or skipped, you may tell him plainly he can move on when he is ready.${gateLine}${continuityLine}`,
    ...buildSectionContentLines(section.section, { includeBeforeRecording: firstSittingStart, gatePending: state.gate_pending }),
    `HOST RULES (the script's own, binding every turn):`,
    ...HOST_RULES,
  ].join('\n');
}
