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
 *
 * ⚠️ LIVE-TEST-REQUIRED — STRICT-CATEGORY OVER-REFUSAL (custody & alienation):
 *   The custody and parental-alienation patterns cannot distinguish the man as
 *   VICTIM/grieving ("I'm scared I'll never see my kids", "she'll take the kids
 *   from me") from the man as AGGRESSOR ("she'll never see the kids again", "I'll
 *   take the kids from her") — same words, opposite intent. They therefore REFUSE
 *   the archetypal sympathetic case, the single most common thing this app's user
 *   says. This is a SEMANTIC distinction regex MUST NOT attempt: any pronoun-based
 *   carve-out either blocks grieving fathers or lets real threats through on one
 *   wrong boundary — in the highest-stakes category. The correct fix is DEFERRING
 *   these strict-category matches to the semantic judge ("Option B") — but that
 *   rests on the judge (F1), which is unproven and injectable, so it CANNOT ship
 *   until the judge is red-teamed live. Until then these over-refuse BY DESIGN;
 *   the concrete cases are pinned in scripts/test-harm-gate.ts as
 *   expectedCurrentlyRefused() so the over-refusal is tracked, not forgotten.
 *
 * ⚠️ LIVE-TEST-REQUIRED — THREAT NEGATION (owner decision C1): the threat category
 *   makes NO attempt to distinguish a real threat from an apology/negated reference
 *   ("I'll never threaten her again", "I regret threatening her") in regex. No
 *   window value is safe — a distant negation lets a real threat slip (unsafe), a
 *   nearby one over-refuses an apology (safe). So threat OVER-refuses genuine
 *   apologies BY DESIGN; the semantic call is deferred to the judge (Option B),
 *   blocked on F1. Tracked in test-harm-gate.ts as expectedCurrentlyRefused().
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
  // F3: third-person / imperative only — first-person remorse ("I regret leaving
  // her") is NOT a threat. "make her regret" is also caught by pattern 2 above.
  /\b(make (her|him|them) regret|(she|he|they)(?:'?ll| will) regret) (leaving|the day|ever|it|this|that)\b/i,
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
  /\b((she|he|they)(?:'?ll| will| is going to)? (leave|walk away|end up|be left)|leave (her|him|them)|make (her|him|them) (leave|walk away|end up|be left)) with nothing\b/i,
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

// ─── Negation / retrospective / first-person suppression ───────────────────
// Some categories over-refuse on DIRECTLY-NEGATED phrasings ("so I don't make her
// doubt herself", "I don't want to pretend"). We suppress the regex hit for those
// and let the semantic judge decide — but ONLY with a SHORT preceding-context
// window, so a negation in a DIFFERENT clause ("it's not okay, gaslight her")
// cannot mask genuine harm. An under-refusal is worse than an over-refusal here.
//
// Scope is deliberate (NEGATION_AWARE_CATEGORIES): threat, deception, and
// impersonation, where benign negated/first-person forms are common. Custody,
// alienation, harassment, coercion, and blackmail do NOT defer negated cases —
// there a nearby negation usually IS the harm ("never see the kids again").
// Retrospective/apology framing ("I regret threatening her") is threat-only, with
// an even tighter window so "I regret nothing. You'll be sorry." is NOT masked.
const DIRECT_NEGATION_CUES = /\b(don'?t|do not|won'?t|will not|will never|never|no longer|not going to)\b|n'?t\b/i;
// C1 (owner-approved): the THREAT category no longer attempts a negation/apology
// distinction in regex. No window value is correct — a DISTANT negation lets a real
// threat slip ("I won't lie, you'll regret this" → under-refusal, the UNSAFE
// failure), a NEARBY one over-refuses a genuine apology (the SAFE failure). This is
// a SEMANTIC call that belongs to the judge (Option B), same rationale as the F9
// custody/alienation decision. So threat now OVER-refuses apologies BY DESIGN until
// judge-deferral lands; the cases are pinned as expectedCurrentlyRefused() in the
// test suite. deception & impersonation KEEP a short-window direct-negation guard
// (benign negated forms are common there and the under-refusal risk is lower).
const NEGATION_AWARE_CATEGORIES = new Set(['deception_manipulation', 'impersonation']);

function isSuppressed(key: string, text: string, matchIndex: number): boolean {
  if (NEGATION_AWARE_CATEGORIES.has(key)) {
    const w = text.slice(Math.max(0, matchIndex - 14), matchIndex);
    if (DIRECT_NEGATION_CUES.test(w)) return true;
  }
  return false;
}

// ─── C2: Unicode apostrophe normalization ────────────────────────────────
// Contraction patterns use '? (an ASCII apostrophe). Phones type curly
// apostrophes (U+2019 by default; also U+2018 and U+02BC), so a threat like
// "she'll lose the kids" typed on iOS would evade EVERY '?-based pattern in this
// file — a silent under-refusal (verified). We normalize those code points to
// ASCII ' ONCE on the input, so every category pattern AND the negation-guard
// windows see straight apostrophes. This covers every contraction in the file
// (not one line), and any pattern added later benefits automatically.
const UNICODE_APOSTROPHES = /[‘’ʼ]/g;

// ─── C3: explicit, once-at-load global-regex construction ──────────────────
// matchAll requires a global ('g') regex. The category patterns are authored
// WITHOUT 'g' (they use /i only). Rather than string-splice `p.flags + 'g'` per
// call — which throws on an already-global pattern and silently hides that
// assumption — we build a global clone of each pattern ONCE at module load.
// makeGlobal FAILS LOUDLY if a pattern is ever authored with 'g', so a future
// edit surfaces the problem instead of misbehaving. No behavior change: the
// existing test-harm-gate suite (same inputs) is the before/after parity proof.
function makeGlobal(re: RegExp): RegExp {
  if (re.global) throw new Error(`harm-gate pattern must not use the 'g' flag: /${re.source}/${re.flags}`);
  return new RegExp(re.source, re.flags + 'g');
}
const GLOBAL_HARM_CATEGORIES: Array<[string, RegExp[]]> =
  Object.entries(HARM_CATEGORIES).map(([key, patterns]) => [key, patterns.map(makeGlobal)]);

/**
 * Scan text for harmful content. Runs every category; harmful = any match.
 * Pure and deterministic. Safe to call on the user's request AND on a draft.
 *
 * F2: uses matchAll (not match) so a negated FIRST occurrence of a pattern cannot
 * hide a genuine LATER occurrence of the same pattern in the same text
 * ("I regret nothing. You'll be sorry." → the threat is still caught).
 * C2: input apostrophes are normalized to ASCII first (curly-apostrophe threats).
 * C3: iterates the precompiled global patterns (GLOBAL_HARM_CATEGORIES).
 */
export function checkHarm(text: string): HarmVerdict {
  const categories: string[] = [];
  const matched: string[] = [];
  const s = (text || '').replace(UNICODE_APOSTROPHES, "'");
  for (const [key, patterns] of GLOBAL_HARM_CATEGORIES) {
    for (const g of patterns) {
      for (const m of s.matchAll(g)) {
        if (isSuppressed(key, s, m.index ?? 0)) continue;
        if (!categories.includes(key)) categories.push(key);
        matched.push(m[0]);
        break; // one non-suppressed occurrence is enough for this pattern
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
// CATEGORY → REFUSAL RESPONSE (plumbed from checkHarm().categories)
//
// Two tones, by intent behind the category:
//   • CONCERNED — custody/child leverage & parental alienation. These usually
//     come from a desperate father, not a malicious one. Firm boundary, but we
//     meet the fear underneath, not the words.
//   • REDIRECT  — threat / coercion / harassment / deception / impersonation /
//     blackmail. Clear boundary, then redirect toward communication that is
//     actually safe to help with.
// Templates are ADJUSTABLE — tone/wording expected to change once §7 lands.
// ─────────────────────────────────────────────────────────────────────────────

const CONCERNED_CATEGORIES = new Set(['custody_child_leverage', 'parental_alienation']);

export const HARM_REFUSAL_RESPONSES: Record<string, string> = {
  custody_child_leverage:
    `I am not going to help write that. Using the kids as leverage will cost you the thing you are trying to hold onto — them. I can hear how scared you are of losing them. That fear is real. What is it you are actually terrified of here?`,
  parental_alienation:
    `I will not help turn your kids against their mother. I know it does not feel like that is what you are asking — it feels like telling the truth. But they need both of you. What is the anger underneath this that is looking for somewhere to go?`,
  threat:
    `I am not going to help write a message meant to frighten or punish her. That is not a message — it is a threat, and it will not get you what you want. What are you actually trying to make her understand?`,
  coercion_leverage:
    `I will not help write something designed to make her afraid of what she would lose. Pressure is not connection. If there is something real you need her to hear, I will help you find the honest version of it — what is it?`,
  harassment:
    `I am not going to help you keep contacting her against her wishes. If she has asked for space, the message that helps you is the one you do not send. What is making it so hard to sit with the silence right now?`,
  deception_manipulation:
    `I will not help write something meant to deceive her or make her doubt herself. That road ends badly for you too. What is the truth you are trying to avoid saying straight?`,
  impersonation:
    `I am not going to help you pretend to be someone you are not — a lawyer, or anyone else. That can cross into real legal trouble. What is the fear that is making you reach for someone else's authority?`,
  blackmail_exposure:
    `I will not help you threaten to expose her. That is not leverage, it is something you cannot take back — and in many places it is a crime. Set that down. What has hurt you badly enough that this felt like the option?`,
};

const GENERIC_HARM_REFUSAL =
  `I am not going to help write that. Let's find the version of what you need to say that does not do harm. What is the real thing underneath it?`;

/**
 * Pick a refusal for the matched categories. If multiple matched, a CONCERNED
 * category wins (softer, and usually the more human read of the situation);
 * otherwise the first matched category's template; else a generic harm refusal.
 */
export function getHarmRefusal(categories: string[]): string {
  if (!categories || categories.length === 0) return GENERIC_HARM_REFUSAL;
  const concerned = categories.find(c => CONCERNED_CATEGORIES.has(c));
  const key = concerned || categories[0];
  return HARM_REFUSAL_RESPONSES[key] || GENERIC_HARM_REFUSAL;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION POINTS — add Engineering Findings §7 patterns here.
//   • New lexical patterns → the matching category array above.
//   • New category → add an array + register it in HARM_CATEGORIES.
//   • Semantic coercion (benign words, harmful intent) is OUT OF REACH of regex.
//     The follow-up is an LLM-judge layer over the request+draft; §7 should
//     define its rubric. Do NOT rely on this file alone for that residual.
//   • NEGATION_AWARE_CATEGORIES (deception, impersonation ONLY) defer directly-
//     negated phrasings to the judge ("so I don't make her doubt herself") via a
//     short-window guard. THREAT does NOT (C1) — threat negation is semantic and
//     belongs to the judge (Option B), so threat OVER-refuses genuine apologies
//     until judge-deferral lands. Custody, alienation, harassment, coercion, and
//     blackmail also do NOT defer negated cases — there a nearby negation usually
//     IS the harm. §7's rubric MUST cover soft/negated/retrospective/implied cases.
// ─────────────────────────────────────────────────────────────────────────────
