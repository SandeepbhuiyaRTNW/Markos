import { NextRequest, NextResponse } from 'next/server';
import { loadFrameworkState, saveFrameworkState } from '@/lib/interview/framework/store';
import {
  beginFramework, grantFrameworkConsent, recordFrameworkAnswer, skipFrameworkQuestion,
  pauseFramework, resumeFramework, nextQuestion, frameworkProgress,
  type FrameworkInterviewState,
} from '@/lib/interview/framework/session';
import { FRAMEWORK_QUESTIONS, frameworkInterviewAvailable } from '@/lib/interview/framework/questions';

export const maxDuration = 30;

type Action = 'begin' | 'consent' | 'answer' | 'skip' | 'pause' | 'resume';

function publicState(state: FrameworkInterviewState) {
  const current = nextQuestion(state);
  const progress = frameworkProgress(state);
  return {
    available: frameworkInterviewAvailable(),
    phase: state.phase,
    progress,
    currentQuestion: current
      ? { id: current.id, text: current.text, theme: current.theme, heavy: current.heavy }
      : null,
    sittingCount: state.sittings.length,
  };
}

/**
 * GET /api/framework-interview?userId=X — the man's framework interview state:
 * availability, phase, progress, the current question, and the collected
 * answers. `available: false` (and phase `not_started`) until the question
 * instrument is authored into src/lib/interview/framework/questions.ts.
 *
 * The answers ride along because they are the point of the interview: a run
 * is meant to be compared against a paper run of the same instrument. Skips
 * are returned as ids only.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  try {
    const state = await loadFrameworkState(userId);
    return NextResponse.json({
      ...publicState(state),
      answers: state.answers,
      skipped: state.skipped,
    });
  } catch (error) {
    console.error('Framework interview state error:', error);
    return NextResponse.json({ error: 'Failed to load framework interview state' }, { status: 500 });
  }
}

/**
 * POST /api/framework-interview { userId, action, answerText? }
 * One deterministic transition of the interview state machine:
 *   begin    not_started/completed -> awaiting_consent
 *   consent  awaiting_consent -> in_progress (opens sitting 1)
 *   answer   record answerText against the current question, move on
 *            (completes the run when no open question remains)
 *   skip     decline the current question, move on (never asked again)
 *   pause    in_progress -> paused (sitting closes, resumable)
 *   resume   paused -> in_progress (new sitting at the same next question)
 * Unknown or no-op transitions return the state unchanged (never an error).
 * While the instrument is un-authored (FRAMEWORK_QUESTIONS empty), begin is
 * refused with 409 and every other action is a no-op.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, action, answerText } = await req.json();
    if (!userId || !action) {
      return NextResponse.json({ error: 'Missing userId or action' }, { status: 400 });
    }
    if (!frameworkInterviewAvailable()) {
      if (action === 'begin') {
        return NextResponse.json(
          { error: 'Framework interview content is not authored yet', ...publicState({ ...await loadFrameworkState(userId) }) },
          { status: 409 },
        );
      }
      const state = await loadFrameworkState(userId);
      return NextResponse.json(publicState(state));
    }
    const now = new Date().toISOString();
    const state = await loadFrameworkState(userId);
    let next: FrameworkInterviewState;
    switch (action as Action) {
      case 'begin': next = beginFramework(state, now); break;
      case 'consent': next = grantFrameworkConsent(state, now); break;
      case 'answer':
        if (typeof answerText !== 'string') {
          return NextResponse.json({ error: 'Missing answerText' }, { status: 400 });
        }
        next = recordFrameworkAnswer(state, answerText, now, FRAMEWORK_QUESTIONS);
        break;
      case 'skip': next = skipFrameworkQuestion(state, now, FRAMEWORK_QUESTIONS); break;
      case 'pause': next = pauseFramework(state, now); break;
      case 'resume': next = resumeFramework(state, now); break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    if (next !== state) await saveFrameworkState(userId, next);
    return NextResponse.json(publicState(next));
  } catch (error) {
    console.error('Framework interview action error:', error);
    return NextResponse.json({ error: 'Failed to update framework interview state' }, { status: 500 });
  }
}
