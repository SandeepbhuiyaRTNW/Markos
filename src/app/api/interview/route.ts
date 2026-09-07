import { NextRequest, NextResponse } from 'next/server';
import { loadInterviewState, saveInterviewState } from '@/lib/interview/store';
import {
  advanceSection, acceptGate, beginInterview, grantConsent, pauseInterview,
  resumeInterview, currentSection, TOTAL_SECTIONS, type InterviewState,
} from '@/lib/interview/session';

export const maxDuration = 30;

type Action = 'begin' | 'consent' | 'advance' | 'accept-gate' | 'pause' | 'resume';

const ACTIONS: Record<Action, (s: InterviewState, now: string) => InterviewState> = {
  begin: beginInterview,
  consent: grantConsent,
  advance: advanceSection,
  'accept-gate': acceptGate,
  pause: pauseInterview,
  resume: resumeInterview,
};

function publicState(state: InterviewState) {
  const section = currentSection(state);
  return {
    phase: state.phase,
    currentSection: state.current_section,
    totalSections: TOTAL_SECTIONS,
    sectionName: section?.name ?? null,
    sectionGate: section?.gate ?? null,
    gatePending: state.gate_pending,
    sectionsCompleted: state.sections_completed,
    sittingCount: state.sittings.length,
  };
}

/**
 * GET /api/interview?userId=X — the man's interview state (phase, section,
 * progress). `not_started` when he has never begun.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  try {
    const state = await loadInterviewState(userId);
    return NextResponse.json(publicState(state));
  } catch (error) {
    console.error('Interview state error:', error);
    return NextResponse.json({ error: 'Failed to load interview state' }, { status: 500 });
  }
}

/**
 * POST /api/interview { userId, action }
 * One deterministic transition of the interview state machine:
 *   begin        not_started/completed -> awaiting_consent
 *   consent      awaiting_consent -> in_progress (opens sitting 1)
 *   advance      finish current section, move to the next (completes at 12;
 *                entering a gated section — 2, 5, 7 — parks at gate_pending)
 *   accept-gate  gate_pending -> in_progress (permission re-confirmed)
 *   pause        in_progress/gate_pending -> paused (sitting closes, resumable)
 *   resume       paused -> in_progress (new sitting at the same section)
 * Unknown or no-op transitions return the state unchanged (never an error).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, action } = await req.json();
    if (!userId || !action) {
      return NextResponse.json({ error: 'Missing userId or action' }, { status: 400 });
    }
    const transition = ACTIONS[action as Action];
    if (!transition) {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    const now = new Date().toISOString();
    const state = await loadInterviewState(userId);
    const next = transition(state, now);
    if (next !== state) await saveInterviewState(userId, next);
    return NextResponse.json(publicState(next));
  } catch (error) {
    console.error('Interview action error:', error);
    return NextResponse.json({ error: 'Failed to update interview state' }, { status: 500 });
  }
}
