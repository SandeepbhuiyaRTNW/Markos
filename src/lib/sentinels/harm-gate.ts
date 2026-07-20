/**
 * Harm Gate — Safe Communication Assistance, Step 4 (the input + output safety check).
 *
 * PROVISIONAL — pending Engineering Findings §7 (the "Ben Report"), which is NOT
 * in the repo. The audit (audit/communication-refusal) found that the
 * frame-refusal sentinel is currently the ONLY thing blocking harmful drafts,
 * and that NOTHING inspects Marcus's OUTPUT for harm. This gate is that missing
 * output+input safety control. Treat every pattern below as a first pass to be
 * extended when §7 arrives — see the EXTENSION POINTS block at the bottom.
 *
 * WHAT THIS IS
 *   A pure, deterministic, ALWAYS-AVAILABLE check (NOT behind COMM_ASSIST_ENABLED —
 *   the feature is flagged, the safety control is not). It scans a piece of text
 *   for content that turning drafting ON could enable: threats, coercion/leverage
 *   (including the calmly-worded case with no violent words), custody/child
 *   leverage, parental alienation, harassment, deception/manipulation,
 *   impersonation, and blackmail/exposure.
 *
 * HOW IT IS USED (fail-closed contract; wiring is a later step, flag stays off)
 *   The drafting flow must call checkHarm() on BOTH surfaces and refuse if EITHER
 *   is harmful:
 *     1. the user's REQUEST  (intent — "help me write a message that…")
 *     2. the produced DRAFT  (content — what Marcus actually wrote)
 *   If either returns harmful, the flow does NOT draft; it falls back to the
 *   existing refusal/redirect. A harmful draft never reaches the user.
 *
 * HONEST LIMITATION (see the test suite for proof)
 *   Pattern matching catches LEXICAL harm. It fundamentally cannot catch SEMANTIC
 *   coercion phrased with benign words ("so she understands the practical
 *   realities before she sees a lawyer"). The real net for that residual is an
 *   LLM-judge layer, which §7 should inform. This file is the extensible first
 *   layer, not the whole safety story.
 */

export interface HarmVerdict {
  harmful: boolean;
  categories: string[]; // category keys that matched (for the caller + instrumentation)
  matched: string[];    // the actual matched substrings — for logging only, NEVER shown to the user
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY PATTERNS — each array is named, commented, and easily extendable.
// Add §7 patterns to the matching array. Keep the false-positive discipline:
// leverage/threat patterns target harm DIRECTED AT another person, not the
// speaker's own vulnerability ("i don't want to lose her" is grief, not coercion).
// ─────────────────────────────────────────────────────────────────────────────

/** Explicit or veiled threats of harm/retaliation. */
export const THREAT_PATTERNS: RegExp[] = [
  /\b(you'?ll|you will|she'?ll|he'?ll|they'?ll) (be sorry|regret (it|this|leaving|that)|pay for)\b/i,
  /\b(make|making|makes) (her|him|them|you) (pay|regret|suffer|sorry|hurt)\b/i,
  /\b(or else|watch what happens|you have no idea what i)\b/i,
  /\bi'?ll (make sure|ruin|destroy|end|wreck) (her|him|them|your|his|this)\b/i,
  /\b(threaten(ing)?|a threat) (her|him|them|to (hurt|harm|leave|take))\b/i,
  /\bregret (leaving|the day|ever)\b/i,
];

/**
 * Coercion / leverage — the calmly-worded case. Targets making ANOTHER person
 * fear loss or act under pressure. Deliberately NOT triggered by first-person
 * loss ("i don't want to lose you" — that is vulnerability, not coercion).
 */
export const COERCION_LEVERAGE_PATTERNS: RegExp[] = [
  /\b(what|how much) (she|he|they|you) (stands? to|will|would|could|might|has to) (lose|be losing|give up)\b/i,
  /\b(remind(ing)?|show(ing)?|tell(ing)?|make sure) (her|him|them|you) .{0,40}(stands? to lose|will lose|has to lose|could lose|giving up|gives? up|would be losing|walk(ing)? away from|what she'?ll lose|what he'?ll lose)\b/i,
  /\bremind(ing)? (her|him|them) (who|what|that|how much) (she|he|they) (needs?|depends? on|owes?|can'?t (do|make it)|would be nothing without)\b/i,
  /\bunless (she|he|they|you) (comes? back|agrees?|does what|stops|changes|apologi)\b/i,
  /\bhold(ing)? .{0,24} over (her|his|their) head\b/i,
  /\b(leave|walk away|end up|be left) with nothing\b/i,
  /\bmake (her|him|them) (afraid|scared|understand what (happens|she'?ll lose) if)\b/i,
  /\b(what'?s at stake for (her|him|them)|the consequences (for her|for him|she'?ll face|of leaving))\b/i,
  /\bif (she|he|they) (doesn'?t|don'?t|won'?t|leaves?|files?) .{0,40}(then )?(i'?ll|i will|she'?ll|he'?ll|there (will|won'?t)|nobody|no one)\b/i,
];

/** Using the children / custody as a weapon or bargaining chip. */
export const CUSTODY_CHILD_LEVERAGE_PATTERNS: RegExp[] = [
  /\b(never|won'?t|not going to|make sure .{0,15} doesn'?t) (see|get) (the )?(kids|children|them) again\b/i,
  /\b(take (the )?(kids|children|custody) (away|from)|keep (the )?(kids|children|them) (from|away from))\b/i,
  /\b(she|he)'?ll (lose|never get) (the )?(kids|custody)\b/i,
  /\buse (the )?(kids|children) (to|against|as (leverage|a bargaining))\b/i,
  /\b(full |sole )?custody (unless|if she|if he|or (she|he))\b/i,
];

/** Turning the children against the other parent (parental alienation). */
export const PARENTAL_ALIENATION_PATTERNS: RegExp[] = [
  /\bturn(ing)? (the )?(kids|children|them|him|her) against\b/i,
  /\bmake (the )?(kids|children|them) (hate|resent|distrust|not trust|not want|afraid of|see that .{0,24}(is|did|doesn'?t))\b/i,
  /\btell(ing)? (the )?(kids|children) (that )?(their )?(mom|mum|dad|mother|father) (is|isn'?t|doesn'?t|never|did|left|abandoned|lied|cheated|doesn'?t love)\b/i,
  /\bso (the )?(kids|children) (know|see|blame) (that )?(their )?(mom|dad|mother|father)\b/i,
];

/** Harassment / intimidation / contact against stated wishes. */
export const HARASSMENT_PATTERNS: RegExp[] = [
  /\b(keep (messaging|texting|calling|contacting|emailing)|won'?t stop (until|messaging|texting|calling))\b/i,
  /\b(blow up (her|his|their) phone|bombard (her|him|them))\b/i,
  /\bshow up (at|to|outside) (her|his|their) (work|job|house|home|place|apartment|office)\b/i,
  /\bmake (her|his|their) life (hell|miserable|difficult|impossible)\b/i,
  /\bkeep (showing up|reaching out|messaging|contacting) (even |right )?(after|though) (she|he|they) (said|asked|told|blocked)\b/i,
];

/** Deception / psychological manipulation. */
export const DECEPTION_MANIPULATION_PATTERNS: RegExp[] = [
  /\bmake(s|ing)? (her|him|them) (think|believe|feel) .{0,40}(her|his|their) fault\b/i,
  /\b(guilt(ing)? (her|him|them) (into|about)|a guilt trip)\b/i,
  /\b(manipulat|gaslight|gaslighting)\b/i,
  /\b(trick (her|him|them)|deceive (her|him|them)|lie (to|about) (her|him|them))\b/i,
  /\b(twist (it|the story|things|the truth) (so|to|around)|spin (it|this) (so|to make))\b/i,
  /\bconvince (her|him|them) (it was|she was|he was|they were|it'?s all) (wrong|crazy|imagining|overreacting|in her head|her fault)\b/i,
  /\bmake (her|him|them) doubt (herself|himself|themselves|what)\b/i,
];

/** Impersonation — pretending to be someone else, or a false source. */
export const IMPERSONATION_PATTERNS: RegExp[] = [
  /\b(pretend(ing)? to be|pose as|posing as|impersonat)\b/i,
  /\bmake it (look|seem) like (it'?s|it was|the (message|text|email|letter) is) from (someone|her|him|them|my|a lawyer|an attorney|the)\b/i,
  /\bsign (it|the (letter|message|email|text)) (with|as|in) (her|his|their|someone else'?s?|a lawyer'?s?) name\b/i,
  /\bas if (i'?m|it'?s from|this is from) (her|his|the|my (lawyer|boss|attorney|doctor))\b/i,
  /\bfrom (a|my) (lawyer|attorney) (when|but|even though) (i|there) (don'?t|do not|isn'?t|haven'?t|have no)\b/i,
];

/** Blackmail / threatened exposure of private material. */
export const BLACKMAIL_EXPOSURE_PATTERNS: RegExp[] = [
  /\bthreaten(ing)? to (tell|show|post|release|expose|share|send|leak)\b/i,
  /\bif (she|he|they) (doesn'?t|don'?t|won'?t) .{0,50} i'?ll (tell|show|post|release|expose|share|send|leak)\b/i,
  /\bpost(ing)? (the|her|his|their) (photos|pictures|messages|texts|nudes|screenshots)\b/i,
  /\b(expose (her|him|them) (to|for)|share (the )?(photos|screenshots|messages|texts) (with|to (her|his|their)))\b/i,
  /\beveryone (will|is going to) (know|see) (what|that|how) (she|he|they)\b/i,
  /\bunless (she|he|they) .{0,40} (post|tell|show|send|expose|release)\b/i,
];

/** The registry — category key → its patterns. Extend a category, or add one. */
export const HARM_CATEGORIES: Record<string, RegExp[]> = {
  threat: THREAT_PATTERNS,
  coercion_leverage: COERCION_LEVERAGE_PATTERNS,
  custody_child_leverage: CUSTODY_CHILD_LEVERAGE_PATTERNS,
  parental_alienation: PARENTAL_ALIENATION_PATTERNS,
  harassment: HARASSMENT_PATTERNS,
  deception_manipulation: DECEPTION_MANIPULATION_PATTERNS,
  impersonation: IMPERSONATION_PATTERNS,
  blackmail_exposure: BLACKMAIL_EXPOSURE_PATTERNS,
};

/**
 * Scan text for harmful content. Runs every category; harmful = any match.
 * Pure and deterministic. Safe to call on the user's request AND on a draft.
 */
export function checkHarm(text: string): HarmVerdict {
  const categories: string[] = [];
  const matched: string[] = [];
  const s = text || '';
  for (const [key, patterns] of Object.entries(HARM_CATEGORIES)) {
    for (const p of patterns) {
      const m = s.match(p);
      if (m) {
        if (!categories.includes(key)) categories.push(key);
        matched.push(m[0]);
      }
    }
  }
  return { harmful: categories.length > 0, categories, matched };
}

/** Convenience boolean. */
export function isHarmful(text: string): boolean {
  return checkHarm(text).harmful;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION POINTS — add Engineering Findings §7 patterns here.
//   • New lexical patterns → the matching category array above.
//   • New category → add an array + register it in HARM_CATEGORIES.
//   • Semantic coercion (benign words, harmful intent) is OUT OF REACH of regex.
//     The follow-up is an LLM-judge layer over the request+draft; §7 should
//     define its rubric. Do NOT rely on this file alone for that residual.
// ─────────────────────────────────────────────────────────────────────────────
