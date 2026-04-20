/**
 * Boundary Sentinel — Tier 1, §5.3
 * Enforce "surface don't treat." Post-Composer guardrail.
 * Block output that strays into diagnosis, prescription, therapy, legal advice, or medical claims.
 */

import type { BoundaryOutput } from '../agents/state-envelope';

/** Banned phrases — therapist-speak, brand language, coaching patterns */
const BANNED_PATTERNS = [
  /\bit sounds like\b/i, /\bi hear you\b/i, /\bit'?s easy to\b/i,
  /\bthat must be\b/i, /\bi appreciate you\b/i, /\bthank you for\b/i,
  /\bwhat i'?m hearing\b/i, /\bthat'?s a powerful\b/i, /\bi'?m glad you\b/i,
  /\bit'?s okay to feel\b/i, /\bthat sounds heavy\b/i, /\bi understand\b/i,
  /\bin a rough spot\b/i, /\blose sight of\b/i, /\bgoing through the motions\b/i,
  /\bit can feel like\b/i, /\byou'?re not alone\b/i,
  /\buniversity of\b/i, /\bwelcome to (the|our)\b/i, /\bgood afternoon[.,]/i,
  /\bgood morning[.,]/i, /\bsummer session\b/i,
  // Narrative supply, fabricated experience, brand language
  /\bi'?ve\s*(been there|walked through|faced similar)\b/i,
  /\bi know that weight\b/i, /\bi get it\b/i,
  /\bas a friend,?\s*i'?d\b/i, /\bif i were your friend\b/i, /\bas your friend\b/i,
  /\bso here'?s the real question\b/i, /\blet'?s cut through\b/i,
  /\bhere'?s what i'?m wondering\b/i, /\bpicture this\b/i,
  /\bwhat would that version of you\b/i, /\bwho you'?re becoming\b/i,
  /\bvoice your truth\b/i, /\bholding the silence\b/i,
  /\bisland of your own making\b/i, /\bstaring down the barrel\b/i,
  /\bstripped of the skin\b/i, /\bscreaming for attention\b/i,
  /\bfog that settles\b/i, /\bsteering the ship\b/i,
  /\bspace with me\b/i, /\bfinding peace\b/i,
  // Voice leakage
  /\bi'?ve found that\b/i,
  /\bafter a big (change|loss|shift|transition)\b/i,
  /\ba lot of (men|guys|people|us) (in your|who|feel|go through|are taught)\b/i,
  /\bit'?s (not )?(unusual|uncommon|normal|natural|tough when) /i,
  /\bmy aim is\b/i, /\bmy goal is\b/i,
  /\bi'?m (not )?here to (just )?(throw|ask|help|dig|uncover)\b/i,
  // Metaphor + softening leakage
  /\bit'?s like (a |an )/i, /\bit'?s tough when\b/i,
  /\bwe'?re taught to\b/i, /\bwhere does it lean\b/i, /\bif you had to guess\b/i,
];

/** Advice patterns — only enforced after pushback */
const ADVICE_PATTERNS = [
  /\btry (this|it|to|doing|going|stepping|making|getting)\b/i,
  /\bstart (with|simple|by|small)\b/i, /\bhere'?s (what|a|the)\b/i, /\bstep \d/i,
  /\bmake your bed\b/i, /\bgo for a walk\b/i, /\btake a (breath|deep|few)\b/i,
  /\bminute[ -]\d/i, /\bstep outside\b/i, /\bdo this:/i,
];

/** Therapy/self-help vocabulary that should never be mirrored */
const THERAPY_VOCAB = [
  /\bboundaries\b/i, /\btrigger(s|ing|ed)?\b/i, /\bvalidat(e|ing)\b/i,
  /\bholding space\b/i, /\bunpack\b/i, /\bsafe space\b/i,
  /\bemotional labor\b/i, /\bself-care\b/i, /\btoxic\b/i,
  /\btrauma response\b/i, /\battachment style\b/i, /\bavoidant\b/i,
  /\bcodependent\b/i, /\bnarcissist\b/i, /\bgaslighting\b/i,
  /\binner child\b/i, /\blean into\b/i, /\bsit with that\b/i,
  /\bthat resonates\b/i, /\bpowerful share\b/i, /\bbrave share\b/i,
  /\bvulnerability is strength\b/i, /\bdo the work\b/i,
];

export interface BoundaryCheckResult {
  passed: boolean;
  violations: string[];
  advice_after_pushback: boolean;
}

/** Check a Composer output for boundary violations */
export function checkBoundary(
  content: string,
  pushbackCount: number = 0
): BoundaryCheckResult {
  const violations: string[] = [];

  for (const pattern of BANNED_PATTERNS) {
    const match = content.match(pattern);
    if (match) violations.push(`banned: "${match[0]}"`);
  }

  for (const pattern of THERAPY_VOCAB) {
    const match = content.match(pattern);
    if (match) violations.push(`therapy-vocab: "${match[0]}"`);
  }

  const adviceAfterPushback = pushbackCount >= 2 && ADVICE_PATTERNS.some(p => p.test(content));
  if (adviceAfterPushback) violations.push('advice-after-pushback');

  return {
    passed: violations.length === 0,
    violations,
    advice_after_pushback: adviceAfterPushback,
  };
}

/** Build BoundaryOutput for the State Envelope */
export function runBoundarySentinel(
  content: string,
  pushbackCount: number = 0
): BoundaryOutput {
  const result = checkBoundary(content, pushbackCount);
  return {
    enforcement_level: result.violations.length > 0 ? 'elevated' : 'standard',
    violations_found: result.violations,
    revision_needed: !result.passed,
  };
}

/** Get the override prompt for regeneration after boundary violation */
export function getBoundaryOverridePrompt(result: BoundaryCheckResult): string {
  if (result.advice_after_pushback) {
    return `[SYSTEM OVERRIDE] Your previous response gave ADVICE after the man already pushed back multiple times. Rewrite completely. Do NOT give advice. Do NOT suggest actions. Instead: acknowledge, sit with him, or go DEEPER. 2-3 sentences max.`;
  }
  return `[SYSTEM OVERRIDE] Your previous response contained banned therapist-speak phrases (${result.violations.slice(0, 3).join(', ')}). Rewrite. Speak as Marcus Aurelius — raw, direct, from lived experience. 2-3 sentences. End with weight.`;
}

