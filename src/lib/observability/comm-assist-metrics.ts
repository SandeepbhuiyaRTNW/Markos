/**
 * Communication-Assist Metrics — PII-free instrumentation for the comm-assist
 * path. Pure builder + a log-line formatter. UNWIRED: the orchestrator calls
 * this at cutover; nothing does today.
 *
 * PRIVACY CONTRACT (enforced by test-comm-assist-metrics.ts):
 *   NEVER logs message contents — not the utterance, not the draft, not the
 *   refusal TEXT. Only structural signals: the move, the outcome path, which
 *   harm layer blocked, the refusal CATEGORY KEY (e.g. 'coercion_leverage', not
 *   the sentence), the KI rule, and latency. The type has no field capable of
 *   holding free text, so a content leak cannot compile.
 */

import type { CommAssistResult } from '../agents/comm-assist-path';

export interface CommAssistMetrics {
  move: string;                              // e.g. 'help_communicate'
  path: 'drafted' | 'refused';               // turn outcome
  harm_regex_blocked: boolean;               // layer 1 fired
  harm_judge_blocked: boolean;               // layer 2 fired
  blocked_stage: 'request' | 'draft' | null; // where harm was caught
  refusal_category: string | null;           // CATEGORY KEY only — never text
  ki_rule: string | null;                    // knowledge-plan rule that fired
  latency_ms: number;
}

export function buildCommAssistMetrics(
  result: CommAssistResult,
  opts: { latencyMs: number; kiRule?: string | null; move?: string },
): CommAssistMetrics {
  const refused = result.kind === 'refusal';
  return {
    move: opts.move ?? 'help_communicate',
    path: refused ? 'refused' : 'drafted',
    harm_regex_blocked: refused && result.blockedLayer === 'regex',
    harm_judge_blocked: refused && result.blockedLayer === 'judge',
    blocked_stage: refused ? result.stage : null,
    // Category KEY only (first matched). Deliberately NOT result.refusal (text).
    refusal_category: refused ? (result.categories[0] ?? null) : null,
    ki_rule: opts.kiRule ?? null,
    latency_ms: opts.latencyMs,
  };
}

/** Single structured log line. Contains only the metrics above — no contents. */
export function commAssistMetricsLogLine(m: CommAssistMetrics): string {
  return `[comm-assist] ${JSON.stringify(m)}`;
}
