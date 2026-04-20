/**
 * Trust Gauge — Tier 2, §6.4
 * Dual-axis trust scoring: cognitive (competence) and affective (safety).
 * Wisdom before warmth: cognitive trust earned before affective trust offered.
 */

import type { TrustOutput } from '../agents/state-envelope';

/** Signals that indicate cognitive trust (he thinks Markos is competent) */
const COGNITIVE_TRUST_SIGNALS = [
  { pattern: /\b(good\s*question|that'?s\s*(a\s*)?(good|great|fair)\s*(point|question))\b/i, weight: 0.15 },
  { pattern: /\b(you'?re\s*right|true|fair\s*point|hadn'?t\s*thought\s*of\s*that)\b/i, weight: 0.1 },
  { pattern: /\b(makes\s*sense|i\s*see\s*what\s*you\s*mean)\b/i, weight: 0.08 },
  { pattern: /\b(how\s*(did|do)\s*you\s*know|you\s*nailed\s*it)\b/i, weight: 0.15 },
  { pattern: /\b(i\s*came\s*back|wanted\s*to\s*talk\s*(to\s*you|again)|been\s*thinking\s*about\s*what\s*you\s*said)\b/i, weight: 0.2 },
];

/** Signals that indicate affective trust (he feels safe) */
const AFFECTIVE_TRUST_SIGNALS = [
  { pattern: /\b(never\s*told\s*(anyone|anybody)|first\s*time\s*(i'?ve\s*)?(said|told))\b/i, weight: 0.25 },
  { pattern: /\b(i'?m\s*(scared|afraid|terrified|ashamed)|honestly)\b/i, weight: 0.12 },
  { pattern: /\b(nobody\s*knows\s*this|no\s*one\s*knows)\b/i, weight: 0.25 },
  { pattern: /\b(i\s*trust\s*you|feels\s*(safe|good)\s*to\s*say)\b/i, weight: 0.2 },
  { pattern: /\b(crying|tears|broke\s*down|choked\s*up)\b/i, weight: 0.15 },
  { pattern: /\b(i\s*love\s*(her|him|them|my)|i\s*miss\s*(her|him|them|my))\b/i, weight: 0.1 },
];

/** Signals that DECREASE trust */
const DISTRUST_SIGNALS = [
  { pattern: /\b(whatever|this\s*is\s*(stupid|pointless|useless|dumb))\b/i, cognitive: -0.15, affective: -0.1 },
  { pattern: /\b(you\s*don'?t\s*(understand|get\s*it|know))\b/i, cognitive: -0.12, affective: -0.05 },
  { pattern: /\b(sounds?\s*(like\s*)?(a\s*)?(bot|script|ai|programmed|canned))\b/i, cognitive: -0.2, affective: -0.1 },
  { pattern: /\b(i'?m\s*done|forget\s*it|never\s*mind)\b/i, cognitive: -0.05, affective: -0.15 },
];

/**
 * Compute trust scores from message + session context.
 * Cognitive and affective are tracked independently.
 */
export function computeTrust(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  sessionCount: number,
  existingTrust?: TrustOutput | null,
): TrustOutput {
  // Base trust from session count (per wisdom-before-warmth principle)
  let cognitive = existingTrust?.cognitive ?? Math.min(0.3 + sessionCount * 0.05, 0.7);
  let affective = existingTrust?.affective ?? Math.min(0.1 + sessionCount * 0.03, 0.5);

  // Scan current message for trust signals
  for (const signal of COGNITIVE_TRUST_SIGNALS) {
    if (signal.pattern.test(message)) cognitive += signal.weight;
  }

  for (const signal of AFFECTIVE_TRUST_SIGNALS) {
    if (signal.pattern.test(message)) affective += signal.weight;
  }

  for (const signal of DISTRUST_SIGNALS) {
    if (signal.pattern.test(message)) {
      cognitive += signal.cognitive;
      affective += signal.affective;
    }
  }

  // Scan recent history for accumulated signals (last 6 messages)
  const recentUserMsgs = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content);

  for (const msg of recentUserMsgs) {
    for (const signal of COGNITIVE_TRUST_SIGNALS) {
      if (signal.pattern.test(msg)) cognitive += signal.weight * 0.3; // Decay for older messages
    }
    for (const signal of AFFECTIVE_TRUST_SIGNALS) {
      if (signal.pattern.test(msg)) affective += signal.weight * 0.3;
    }
  }

  // Depth signals from conversation length
  const exchangeCount = conversationHistory.filter(m => m.role === 'user').length;
  if (exchangeCount >= 5) cognitive += 0.05;
  if (exchangeCount >= 10) affective += 0.05;

  // Clamp to [0, 1]
  return {
    cognitive: Math.round(Math.min(1, Math.max(0, cognitive)) * 100) / 100,
    affective: Math.round(Math.min(1, Math.max(0, affective)) * 100) / 100,
  };
}

