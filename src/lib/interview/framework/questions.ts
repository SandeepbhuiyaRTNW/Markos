/**
 * Framework Interview — the question instrument (CONTENT SLOT).
 *
 * This is the ~2-hour framework interview authored by a collaborator of the
 * founder's, which he has taken twice on paper. The team wants it as an
 * optional, separate onboarding experience: Markos plays serious interviewer,
 * asks the questions as written, and collects the answers so a run can be
 * compared against a paper run.
 *
 * THE QUESTIONS ARE NOT IN THIS REPO. They exist on paper with their author;
 * like the Embodied Man interview's deep content, they are authored with the
 * founder and land here as data. Until then FRAMEWORK_QUESTIONS is EMPTY and
 * frameworkInterviewAvailable() is false — nothing surfaces the interview in
 * the product, and the API refuses to begin one. Dropping the real questions
 * into the list below is the ONLY step needed to light the machinery up.
 *
 * Comparability rule (why `text` is verbatim): the before/after value comes
 * from asking every man the same question the same way. The Composer note
 * (buildFrameworkNote) instructs asking each question as written, and each
 * recorded answer snapshots the question text it answered, so a run stays
 * auditable even if this list is edited later.
 */

export interface FrameworkQuestion {
  /** Stable id ('q001'…). Answers key off this, so never renumber a shipped id. */
  id: string;
  /** The question exactly as the interviewer asks it. */
  text: string;
  /** Theme grouping for progress display and answer export. */
  theme: string;
  /**
   * Tough questions (the author warned some are) get a soft lead-in and an
   * explicit, pressure-free skip. Skip is always his call, on any question;
   * `heavy` only changes how plainly the out is offered.
   */
  heavy: boolean;
  /** At most one follow-up the interviewer may ask, only if the answer was thin. */
  follow_up?: string;
}

export const FRAMEWORK_QUESTIONS: readonly FrameworkQuestion[] = [
  // Awaiting the author's question set (paper). Add entries in interview order.
];

/** The interview is offered only when a real instrument is present. */
export function frameworkInterviewAvailable(): boolean {
  return FRAMEWORK_QUESTIONS.length > 0;
}
