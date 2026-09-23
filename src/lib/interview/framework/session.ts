/**
 * Framework Interview — session machinery.
 *
 * The optional, separate onboarding interview (~2 hours across sittings) in
 * which Markos is a serious interviewer: he asks the framework's questions as
 * written, collects the answers, and the run can later be compared against a
 * paper run of the same instrument. It is deliberately NOT folded into normal
 * conversation — some questions are too heavy for chat, and the interview's
 * value depends on every man being asked the same question the same way.
 *
 * Relationship to the Embodied Man module (src/lib/interview/session.ts):
 * same pattern — a pure, deterministic state machine with resumable sittings
 * and a per-turn Composer note — but a different shape. The Embodied Man
 * interview tracks SECTIONS and bars the model from inventing questions; the
 * framework interview tracks ANSWERS to a concrete question list, and the
 * note hands the model the current question verbatim. The two modules share
 * nothing but the Postgres access pattern so neither can break the other.
 *
 * Everything here is DETERMINISTIC: no LLM, no network, no DB. Persistence
 * lives in store.ts (Postgres); this file never touches it.
 *
 * Phase model:
 *   not_started       no interview row exists yet (or content not authored)
 *   awaiting_consent  he tapped "Begin" but has not said he is ready
 *   in_progress       consent given; a sitting is open
 *   paused            he stepped away; resume picks up the SAME next question
 *                     in a new sitting, another day
 *   completed         every question answered or skipped; a fresh run may begin
 *
 * Question order is DERIVED, not stored: the next question is always the
 * first (in instrument order) with no answer and no skip. Editing the
 * question list mid-run can therefore never wedge a session — answered and
 * skipped ids survive reordering, and each answer snapshots the text it
 * answered.
 */

import { FRAMEWORK_QUESTIONS, type FrameworkQuestion } from './questions';

export type FrameworkPhase =
  | 'not_started'
  | 'awaiting_consent'
  | 'in_progress'
  | 'paused'
  | 'completed';

export interface FrameworkAnswer {
  question_id: string;
  /** Verbatim snapshot of the question as asked — survives later edits to the instrument. */
  question_text: string;
  answer_text: string;
  at: string;          // ISO
  sitting: number;     // 1-based sitting the answer was recorded in
}

export interface FrameworkSitting {
  started_at: string;        // ISO
  ended_at: string | null;   // ISO when paused/completed; null while open
  answered: number;          // answers recorded in this sitting
}

export interface FrameworkInterviewState {
  phase: FrameworkPhase;
  answers: FrameworkAnswer[];
  skipped: string[];         // question ids he declined — never pressured again
  sittings: FrameworkSitting[];
  created_at: string;
  updated_at: string;
}

export const EMPTY_FRAMEWORK_STATE: FrameworkInterviewState = {
  phase: 'not_started',
  answers: [],
  skipped: [],
  sittings: [],
  created_at: '',
  updated_at: '',
};

export interface FrameworkProgress {
  total: number;
  answered: number;
  skipped: number;
  remaining: number;
}

export function frameworkProgress(
  state: FrameworkInterviewState,
  questions: readonly FrameworkQuestion[] = FRAMEWORK_QUESTIONS,
): FrameworkProgress {
  const answeredIds = new Set(state.answers.map((a) => a.question_id));
  const skippedIds = new Set(state.skipped);
  const done = questions.filter((q) => answeredIds.has(q.id) || skippedIds.has(q.id)).length;
  return {
    total: questions.length,
    answered: questions.filter((q) => answeredIds.has(q.id)).length,
    skipped: questions.filter((q) => skippedIds.has(q.id)).length,
    remaining: questions.length - done,
  };
}

/** The question to ask next: first in instrument order with no answer and no skip. */
export function nextQuestion(
  state: FrameworkInterviewState,
  questions: readonly FrameworkQuestion[] = FRAMEWORK_QUESTIONS,
): FrameworkQuestion | null {
  const answeredIds = new Set(state.answers.map((a) => a.question_id));
  const skippedIds = new Set(state.skipped);
  return questions.find((q) => !answeredIds.has(q.id) && !skippedIds.has(q.id)) ?? null;
}

/** Begin: not_started/completed -> awaiting_consent. A re-run starts clean (see note in questions.ts). */
export function beginFramework(state: FrameworkInterviewState, now: string): FrameworkInterviewState {
  if (state.phase === 'awaiting_consent' || state.phase === 'in_progress' || state.phase === 'paused') {
    return state;
  }
  return {
    ...state,
    phase: 'awaiting_consent',
    answers: [],
    skipped: [],
    sittings: [],
    updated_at: now,
    created_at: state.created_at || now,
  };
}

/** Consent given at the top of the interview: opens the first sitting. */
export function grantFrameworkConsent(state: FrameworkInterviewState, now: string): FrameworkInterviewState {
  if (state.phase !== 'awaiting_consent') return state;
  return {
    ...state,
    phase: 'in_progress',
    sittings: [{ started_at: now, ended_at: null, answered: 0 }],
    updated_at: now,
  };
}

/**
 * Record his answer to the CURRENT question and move on. Strict by design:
 * only the derived next question can be answered (the interview goes in
 * order, or the run stops being comparable), and an empty answer is a no-op,
 * never a recorded blank. Answering the last open question completes the run
 * and closes the sitting.
 */
export function recordFrameworkAnswer(
  state: FrameworkInterviewState,
  answerText: string,
  now: string,
  questions: readonly FrameworkQuestion[] = FRAMEWORK_QUESTIONS,
): FrameworkInterviewState {
  if (state.phase !== 'in_progress') return state;
  const question = nextQuestion(state, questions);
  const text = answerText.trim();
  if (!question || text.length === 0) return state;
  const answer: FrameworkAnswer = {
    question_id: question.id,
    question_text: question.text,
    answer_text: text,
    at: now,
    sitting: state.sittings.length,
  };
  const next: FrameworkInterviewState = {
    ...state,
    answers: [...state.answers, answer],
    sittings: bumpSittingAnswers(state.sittings),
    updated_at: now,
  };
  if (nextQuestion(next, questions) === null) {
    return { ...next, phase: 'completed', sittings: closeSitting(next.sittings, now) };
  }
  return next;
}

/**
 * He declines the current question. Always allowed, on any question, and the
 * instrument never asks it again this run. Skipping the last open question
 * completes the run.
 */
export function skipFrameworkQuestion(
  state: FrameworkInterviewState,
  now: string,
  questions: readonly FrameworkQuestion[] = FRAMEWORK_QUESTIONS,
): FrameworkInterviewState {
  if (state.phase !== 'in_progress') return state;
  const question = nextQuestion(state, questions);
  if (!question) return state;
  const next: FrameworkInterviewState = {
    ...state,
    skipped: [...state.skipped, question.id],
    updated_at: now,
  };
  if (nextQuestion(next, questions) === null) {
    return { ...next, phase: 'completed', sittings: closeSitting(next.sittings, now) };
  }
  return next;
}

/** He steps away: the sitting closes; the next question waits for another day. */
export function pauseFramework(state: FrameworkInterviewState, now: string): FrameworkInterviewState {
  if (state.phase !== 'in_progress') return state;
  return { ...state, phase: 'paused', sittings: closeSitting(state.sittings, now), updated_at: now };
}

/**
 * Resume a paused interview: same next question, new sitting. Unlike the
 * Embodied Man module there is no per-section permission gate to re-arm —
 * consent covered the whole instrument; heavy moments are handled per
 * question by the Composer note, not by state.
 */
export function resumeFramework(state: FrameworkInterviewState, now: string): FrameworkInterviewState {
  if (state.phase !== 'paused') return state;
  return {
    ...state,
    phase: 'in_progress',
    sittings: [...state.sittings, { started_at: now, ended_at: null, answered: 0 }],
    updated_at: now,
  };
}

function closeSitting(sittings: FrameworkSitting[], now: string): FrameworkSitting[] {
  if (sittings.length === 0) return sittings;
  const out = [...sittings];
  const last = out[out.length - 1];
  if (last.ended_at === null) out[out.length - 1] = { ...last, ended_at: now };
  return out;
}

function bumpSittingAnswers(sittings: FrameworkSitting[]): FrameworkSitting[] {
  if (sittings.length === 0) return sittings;
  const out = [...sittings];
  const last = out[out.length - 1];
  if (last.ended_at === null) out[out.length - 1] = { ...last, answered: last.answered + 1 };
  return out;
}

/**
 * The deterministic per-turn note for the Composer while a framework sitting
 * is open. Unlike the Embodied Man note — which carries NO question content —
 * this one hands over the current question VERBATIM, because the questions
 * are the instrument: rewording them breaks the before/after comparability
 * the interview exists for. Internal guidance, never read aloud as a block.
 */
export function buildFrameworkNote(
  state: FrameworkInterviewState,
  questions: readonly FrameworkQuestion[] = FRAMEWORK_QUESTIONS,
): string | null {
  if (state.phase !== 'in_progress') return null;
  const question = nextQuestion(state, questions);
  if (!question) return null;
  const progress = frameworkProgress(state, questions);
  const lines = [
    `FRAMEWORK INTERVIEW — structured session in progress (internal guidance, never read verbatim):`,
    `- You are the interviewer now: serious, unhurried, plain. This is a separate mode from your usual conversation — you are here to ask and to collect, not to counsel, interpret, or advise.`,
    `- Ask the current question AS WRITTEN, one question at a time: "${question.text}" (question ${progress.answered + progress.skipped + 1} of ${progress.total}, theme "${question.theme}"). Do not reword it — every man must hear the same question the same way.`,
    `- When he answers, receive it plainly and briefly — a nod, not an analysis — then move to the next question. His answers are being collected; never summarize them back as conclusions about him.`,
    `- Never invent questions of your own.${question.follow_up ? ` The single permitted follow-up, asked at most once and only if his answer was thin and he seems willing: "${question.follow_up}"` : ' This question has no follow-up.'}`,
    `- Do not rush him. Silence is his. If he wants to pause or stop the interview, that is his call — acknowledge it plainly and let it go.`,
  ];
  if (question.heavy) {
    lines.push(
      `- This question is a heavy one. Offer the out before you ask it, in your own plain words: he can skip any question, any time, no reason needed — and if he skips, move on without a comment about the skip.`,
    );
  }
  return lines.join('\n');
}
