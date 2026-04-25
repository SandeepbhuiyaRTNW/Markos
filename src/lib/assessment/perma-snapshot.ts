/**
 * PERMA Snapshot — Tier 2, §2.4
 * Identifies which PERMA domain is underwater in the current turn.
 * V1: Lightweight heuristic from Listener Stack + Arena signals.
 * V1.5: Full PERMA Profiler integration (23-item assessment).
 *
 * Domains: P(ositive emotion), E(ngagement), R(elationships), M(eaning), A(ccomplishment)
 */

import type { PERMASnapshot, PERMAScores } from '../agents/state-envelope';
import type { StateEnvelope } from '../agents/state-envelope';

/** Arena → PERMA domain affinity map */
const ARENA_PERMA_MAP: Record<string, Partial<PERMAScores>> = {
  divorce:        { R: -0.3, P: -0.2 },
  grief:          { P: -0.3, R: -0.2, M: -0.1 },
  love:           { R: -0.3, P: -0.2 },
  sex:            { R: -0.2, E: -0.1 },
  fatherhood:     { R: -0.2, M: -0.1 },
  fatherless_son: { R: -0.3, M: -0.2 },
  friendship:     { R: -0.4 },
  work:           { A: -0.3, E: -0.2, M: -0.1 },
  money:          { A: -0.2, P: -0.1 },
  health:         { P: -0.2, E: -0.2 },
  addiction:      { P: -0.3, E: -0.2, R: -0.1 },
  veteran:        { M: -0.3, R: -0.2, P: -0.1 },
  midlife:        { M: -0.3, A: -0.2, E: -0.1 },
  faith_crisis:   { M: -0.4, R: -0.1 },
};

/** Emotion → PERMA impact */
const EMOTION_PERMA_MAP: Record<string, Partial<PERMAScores>> = {
  sadness:     { P: -0.2 },
  anger:       { P: -0.1, R: -0.1 },
  shame:       { P: -0.2, R: -0.1, A: -0.1 },
  fear:        { P: -0.2, E: -0.1 },
  loneliness:  { R: -0.3, P: -0.1 },
  hopelessness:{ P: -0.3, M: -0.2 },
  confusion:   { M: -0.1, E: -0.1 },
  numbness:    { P: -0.2, E: -0.2 },
  guilt:       { P: -0.1, R: -0.1 },
  exhaustion:  { E: -0.3, A: -0.1 },
};

/** Compute PERMA Snapshot from the State Envelope (V1 heuristic) */
export function computePERMASnapshot(env: StateEnvelope): PERMASnapshot {
  const scores: PERMAScores = { P: 0.6, E: 0.6, R: 0.6, M: 0.6, A: 0.6 };
  const evidence: string[] = [];

  // Apply arena weights
  if (env.assessment.arena) {
    for (const [arena, weight] of Object.entries(env.assessment.arena.weights)) {
      const impact = ARENA_PERMA_MAP[arena];
      if (impact && weight > 0.15) {
        for (const [domain, delta] of Object.entries(impact)) {
          scores[domain as keyof PERMAScores] += (delta as number) * weight;
        }
        evidence.push(`arena:${arena}(${(weight * 100).toFixed(0)}%)`);
      }
    }
  }

  // Apply emotion signal from listener stack
  if (env.sentinels.listener_stack?.primary_emotion) {
    const emotion = env.sentinels.listener_stack.primary_emotion.toLowerCase();
    const impact = EMOTION_PERMA_MAP[emotion];
    if (impact) {
      for (const [domain, delta] of Object.entries(impact)) {
        scores[domain as keyof PERMAScores] += delta as number;
      }
      evidence.push(`emotion:${emotion}`);
    }
  }

  // Apply silence type signal
  if (env.assessment.silence_type) {
    const st = env.assessment.silence_type.label;
    if (st === 'shame') { scores.P -= 0.1; scores.A -= 0.1; evidence.push('silence:shame'); }
    if (st === 'grief') { scores.P -= 0.15; scores.R -= 0.1; evidence.push('silence:grief'); }
    if (st === 'avoidance') { scores.E -= 0.1; evidence.push('silence:avoidance'); }
  }

  // Clamp all scores to [0, 1]
  for (const key of Object.keys(scores) as (keyof PERMAScores)[]) {
    scores[key] = Math.max(0, Math.min(1, Math.round(scores[key] * 100) / 100));
  }

  // Find underwater domain (lowest score)
  const entries = Object.entries(scores) as [keyof PERMAScores, number][];
  entries.sort((a, b) => a[1] - b[1]);
  const lowest = entries[0];
  const underwater = lowest[1] < 0.4 ? lowest[0] : null;

  return { underwater_domain: underwater, scores, evidence };
}
