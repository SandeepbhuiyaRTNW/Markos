'use client';

/**
 * Embodied Man interview — the UI shell for the structured interview skeleton.
 *
 * Four pieces, one file:
 *   InterviewOffer    post-onboarding: a new man is offered the interview as
 *                     his first conversation (he can say not now).
 *   InterviewConsent  the consent gate: what the interview is, that the
 *                     questions are deep and personal, that he can pause any
 *                     time — then "I'm ready". Nothing starts before this.
 *   InterviewCard     the always-available entry on the dashboard: begin,
 *                     continue, or see it finished.
 *   InterviewProgress the quiet strip over a live interview sitting: where he
 *                     is (Section X of 12), pause, move on, and the gate
 *                     re-confirm for sections 2, 5, 7.
 *
 * Styling follows the app's editorial language (same inks, eyebrow tracking,
 * serif display, underline hover) — see AnalyticsDashboard.
 */

import { ArrowRight, Loader2 } from 'lucide-react';

// Same editorial palette as AnalyticsDashboard (docs/plate-contrast.json).
const INK = '#14100e';
const INK_SOFT = '#3d352e';
const MUTED = '#6b6259';
const TERRA = '#713b12';
const EYEBROW: React.CSSProperties = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED };

export interface InterviewPublicState {
  phase: 'not_started' | 'awaiting_consent' | 'in_progress' | 'gate_pending' | 'paused' | 'completed';
  currentSection: number;
  totalSections: number;
  sectionName: string | null;
  sectionGate: string | null;
  gatePending: boolean;
  sectionsCompleted: number[];
  sittingCount: number;
}

// ─── Post-onboarding offer ────────────────────────────────────────────────────
export function InterviewOffer({ onBegin, onSkip, busy }: {
  onBegin: () => void; onSkip: () => void; busy: boolean;
}) {
  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6 fade-in-up">
      <div style={{ maxWidth: 520 }}>
        <p style={EYEBROW}>One more thing before you talk</p>
        <h1 className="font-serif" style={{ fontSize: 'clamp(28px,4.5vw,42px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.2, color: INK, marginTop: 18 }}>
          There is an interview. It is how he really gets to know you.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: INK_SOFT, marginTop: 18 }}>
          Twelve sections about the life you have lived in your body — childhood to today.
          You can pause any time and pick it back up another day.
        </p>
        <div style={{ marginTop: 34 }}>
          <button onClick={onBegin} disabled={busy} className="inline-flex items-center gap-2 transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ color: TERRA, fontSize: 19 }}>
            {busy ? (<><Loader2 className="w-5 h-5 animate-spin" /> One moment…</>) : (<>Begin your interview <ArrowRight className="w-5 h-5" strokeWidth={1.75} /></>)}
          </button>
          <div style={{ marginTop: 10 }}>
            <button onClick={onSkip} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ color: MUTED, fontSize: 15 }}>
              Not now — just talk
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Consent gate ─────────────────────────────────────────────────────────────
export function InterviewConsent({ state, onReady, onNotYet, busy }: {
  state: InterviewPublicState; onReady: () => void; onNotYet: () => void; busy: boolean;
}) {
  const resuming = state.phase === 'paused' || state.sittingCount > 0;
  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 fade-in-up">
      <div style={{ maxWidth: 560 }}>
        <p style={EYEBROW}>The interview</p>
        <h1 className="font-serif" style={{ fontSize: 'clamp(28px,4.5vw,42px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.2, color: INK, marginTop: 18 }}>
          {resuming
            ? `Pick it back up — Section ${state.currentSection} of ${state.totalSections}.`
            : 'Before the first question.'}
        </h1>
        <div style={{ marginTop: 22 }}>
          {[
            'The questions are deep and personal — about your body, and the life you have lived in it.',
            'Twelve sections, in order. Some of them ask a lot. You can skip anything, and pause any time — it will be here when you come back.',
            'He will never tell you what your body means. He is there to help you find words for it.',
          ].map((s, i) => (
            <p key={i} style={{ fontSize: 17, lineHeight: 1.6, color: INK_SOFT, marginTop: i === 0 ? 0 : 12 }}>{s}</p>
          ))}
        </div>
        <div style={{ marginTop: 34 }}>
          <button onClick={onReady} disabled={busy} className="inline-flex items-center gap-2 transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ color: TERRA, fontSize: 19 }}>
            {busy ? (<><Loader2 className="w-5 h-5 animate-spin" /> One moment…</>) : (<>I&rsquo;m ready <ArrowRight className="w-5 h-5" strokeWidth={1.75} /></>)}
          </button>
          <div style={{ marginTop: 10 }}>
            <button onClick={onNotYet} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ color: MUTED, fontSize: 15 }}>
              Not yet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard entry card ─────────────────────────────────────────────────────
export function InterviewCard({ state, onBegin, onResume, busy }: {
  state: InterviewPublicState; onBegin: () => void; onResume: () => void; busy: boolean;
}) {
  if (state.phase === 'completed') {
    return (
      <div style={{ marginTop: 40 }}>
        <p style={EYEBROW}>The interview</p>
        <p className="font-serif" style={{ fontSize: 22, lineHeight: 1.35, color: INK, marginTop: 10 }}>
          You finished all {state.totalSections} sections.
        </p>
      </div>
    );
  }
  const inFlight = state.phase === 'in_progress' || state.phase === 'gate_pending' || state.phase === 'paused';
  return (
    <div style={{ marginTop: 40 }}>
      <p style={EYEBROW}>The interview</p>
      <p className="font-serif" style={{ fontSize: 22, lineHeight: 1.35, color: INK, marginTop: 10 }}>
        {inFlight
          ? `Section ${state.currentSection} of ${state.totalSections} — ${state.sectionName ?? ''}.`
          : 'Twelve sections about the life you have lived in your body.'}
      </p>
      <button
        onClick={inFlight ? onResume : onBegin}
        disabled={busy}
        className="inline-flex items-center gap-2 transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed"
        style={{ color: TERRA, fontSize: 17, marginTop: 8 }}
      >
        {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> One moment…</>)
          : inFlight ? (<>Continue your interview <ArrowRight className="w-4 h-4" strokeWidth={1.75} /></>)
          : (<>Begin your interview <ArrowRight className="w-4 h-4" strokeWidth={1.75} /></>)}
      </button>
      {!inFlight && (
        <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Pause any time — it keeps your place.</p>
      )}
    </div>
  );
}

// ─── Live sitting strip ───────────────────────────────────────────────────────
export function InterviewProgress({ state, onPause, onAdvance, onAcceptGate, busy }: {
  state: InterviewPublicState;
  onPause: () => void; onAdvance: () => void; onAcceptGate: () => void; busy: boolean;
}) {
  return (
    <div className="flex-none" style={{ borderBottom: '1px solid #e4dfd7', background: '#f4f1ea' }}>
      <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-2.5 flex items-center justify-between gap-4" style={{ maxWidth: 860 }}>
        <span style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: TERRA }}>
          The interview · Section {state.currentSection} of {state.totalSections}{state.sectionName ? ` — ${state.sectionName}` : ''}
        </span>
        <span className="flex items-center gap-4">
          {state.gatePending ? (
            <button onClick={onAcceptGate} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ fontSize: 12, color: TERRA }}>
              He said yes — continue
            </button>
          ) : state.currentSection < state.totalSections ? (
            <button onClick={onAdvance} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ fontSize: 12, color: MUTED }}>
              Move to the next section
            </button>
          ) : (
            <button onClick={onAdvance} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ fontSize: 12, color: TERRA }}>
              Finish the interview
            </button>
          )}
          <button onClick={onPause} disabled={busy} className="transition-opacity hover:underline underline-offset-4 disabled:cursor-not-allowed" style={{ fontSize: 12, color: MUTED }}>
            Pause
          </button>
        </span>
      </div>
      {state.gatePending && state.sectionGate && (
        <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 pb-2.5" style={{ maxWidth: 860 }}>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: MUTED }}>
            This section needs his plain permission first — {state.sectionGate}.
          </p>
        </div>
      )}
    </div>
  );
}
