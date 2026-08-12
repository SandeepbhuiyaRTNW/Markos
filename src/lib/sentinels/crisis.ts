/**
 * Crisis Sentinel — Tier 1, §5.2
 * Two-stage: fast classifier for recall, LLM verifier for precision.
 * Acute crisis forces a specific response and disables Tier 4 Whisperers.
 *
 * v3 RE-CALIBRATION — three tiers, drawn so ordinary hard emotions never hotline:
 *   1. CRISIS (detectCrisisType != null): EXPLICIT suicidal intent/ideation or
 *      self-harm, abuse/DV disclosure, explicit third-party risk, violence,
 *      substance emergency, and genuinely VEILED passive SI (contemplating not
 *      existing / not waking / being gone). -> forced support + 988/hotline.
 *   2. GENTLE CHECK-IN (needsGentleCheckIn == true, crisis == none): the ambiguous
 *      middle — "i can't do this anymore", "what's the point", "nothing works",
 *      "so tired of all this", "i'm done", "no one cares", "die alone". These are
 *      normal despair/exhaustion. NO hotline — a caring check-in FIRST; crisis only
 *      escalates if a later turn surfaces explicit intent (detected per-turn).
 *   3. NORMAL: sadness, grief, divorce, breakup, job loss, loneliness, "i feel like
 *      a failure", "i don't know what to do" — plain empathetic conversation.
 * Sadness is not a crisis; the line is EXPLICIT intent, not intensity of pain.
 */

import type { CrisisOutput, CrisisType, CrisisLevel } from '../agents/state-envelope';
import type { StateEnvelope } from '../agents/state-envelope';

// ─── IMMEDIATE crisis patterns — hard intercept ───
// Expanded per Engineering Findings §5: direct method language, ambivalence, oblique phrases

const SUICIDE_PATTERNS = [
  // --- Direct statements ---
  // v3: added the gerund forms (kill→killing, end→ending) so explicit ideation like
  // "thinking about killing myself" / "ending it" is caught, not just "kill myself".
  /\b(suicid|kill(ing)?\s*my\s*self|end(ing)?\s*(my|it|things)|checking\s*out|better\s*off\s*(without|dead))\b/i,
  // v3.2: "be here" moved to the context-guarded INDIRECT set below (so "...be here
  // at work / at this party" no longer false-fires). live/exist/wake up/be alive stay.
  /\b(want\s*to\s*die|don'?t\s*want\s*to\s*(live|exist|wake\s*up|be\s*alive))\b/i,
  /\b(self[\s-]*harm|cut\s*my\s*self|hurt\s*my\s*self)\b/i,
  /\b(no\s*(point|reason)\s*(in\s*)?(living|going\s*on|being\s*here))\b/i,

  // --- Direct method language ---
  /\b(put\s*a\s*(bullet|gun)|blow\s*my\s*(head|brains))\b/i,
  /\b(jump\s*(off|from)\s*(a\s*)?(bridge|building|roof|overpass|ledge))\b/i,
  /\b(hang\s*my\s*self|hang(ing)?\s*from)\b/i,
  /\b(overdose|take\s*(all\s*the|too\s*many)\s*pills)\b/i,
  /\b(bought\s*(a\s*)?rope|looking\s*at\s*(the\s*)?(bridge|tracks|rail|ledge))\b/i,
  /\b(loaded\s*(the\s*)?(gun|pistol|rifle|shotgun))\b/i,
  /\b(slit\s*(my\s*)?(wrist|throat))\b/i,
  /\b(drive\s*(my\s*)?(car|truck)\s*(into|off|over))\b/i,
  /\b(step\s*(in\s*front\s*of|into)\s*(traffic|a\s*train|the\s*train))\b/i,

  // --- Passive / oblique ---
  // v3: tightened — require the "gone" framing (conditional "would") so present-tense
  // loneliness ("nobody cares", "no one gets me") is NOT read as suicidal ideation.
  // It routes to a gentle check-in instead. "better off without/dead" still hits
  // pattern 1 above, so genuine SI framing is unaffected.
  /\b(wouldn'?t\s*miss\s*me|world\s*(is|would\s*be)?\s*better\s*(off\s*)?without\s*me|nobody\s*would\s*(care|notice|miss))\b/i,
  /\b(giving\s*(away|everything)|getting\s*(my\s*)?(affairs|things)\s*in\s*order)\b/i,
  /\b(wrote\s*(a\s*)?(note|letter)\s*(to|for)\s*(my|the)\s*(kids|family|wife))\b/i,
  /\b(made\s*(my|a)\s*(peace|plan)|have\s*a\s*plan)\b/i,
  /\b(i'?m\s*(a\s*)?burden|burden\s*(to|on)\s*(everyone|my|them))\b/i,
  /\b(won'?t\s*be\s*(a\s*)?problem\s*(much\s*)?longer)\b/i,
  /\b(this\s*will\s*(all\s*)?be\s*over\s*soon)\b/i,
  /\b(taking\s*care\s*of\s*everything\s*before\s*i\s*go)\b/i,
  /\b(said\s*(my\s*)?goodbye|saying\s*(my\s*)?goodbye)\b/i,
  /\b(you'?ll\s*(all\s*)?(understand|see)\s*(when\s*i'?m\s*gone|soon))\b/i,
  /\b(i'?ve\s*(already\s*)?decided)\b/i,
  /\b(tonight'?s\s*the\s*night|this\s*is\s*it)\b/i,
  /\b(finally\s*(found\s*)?(the\s*)?courage\s*to\s*do\s*it)\b/i,
  /\b(i\s*know\s*how\s*i'?m\s*going\s*to\s*do\s*it)\b/i,
  /\b(don'?t\s*try\s*to\s*stop\s*me)\b/i,
  /\b(delete\s*my\s*(accounts?|messages?|photos?)\s*(after|when))\b/i,

  // --- Ambivalence phrases (still acute — better safe) ---
  /\b(part\s*of\s*me\s*wants?\s*to\s*(die|end\s*it|not\s*(be\s*here|exist|wake\s*up)))\b/i,
  /\b(sometimes\s*i\s*(think\s*about|wonder\s*(about|if))\s*(dying|ending\s*it|not\s*(being|existing|waking)))\b/i,
  /\b(thought\s*about\s*(it|ending\s*it)\s*(a\s*lot|more\s*(than|and\s*more)|every\s*day|lately))\b/i,
  /\b(getting\s*(closer|harder)\s*to\s*(not\s*)?(doing|acting\s*on)\s*it)\b/i,
];

// v3.2 — INDIRECT suicidal ideation. Soft / oblique expressions of not wanting to
// live, be here, or exist. These fire the SAME acute suicide response as explicit
// intent — safety-forward, because a missed disclosure is the graver error. Context
// guards (negative lookaheads) keep clearly non-suicidal uses out: "...be here at
// work / at this party", "sick of living paycheck to paycheck", "can't go on
// vacation", "no future in this company", "no reason to celebrate".
const INDIRECT_SUICIDE_PATTERNS = [
  // "don't want to be here" UNLESS a place/context follows (at work / at this party /
  // in this meeting / for this). "be here anymore / at all / on this earth" still fires.
  /\bdon'?t\s*want\s*to\s*be\s*here\b(?!\s+(?:at|in|for|during|around|with)\s+(?!all\b)\w)/i,
  /\b(tired|sick)\s*of\s*(being\s*alive|living|breathing)\b(?!\s+(?:in|on|with|at|like|near|next|paycheck|off|through|around|among|here|this|that|my|the|a\b))/i,
  /\bcan'?t\s*(go|carry)\s*on\b(?!\s+(?:a|an|the|to|with|without|for|in|on|vacation|holiday|trip|stage|tour|record|working|doing|here|there|about)\b)/i,
  /\bcan'?t\s*keep\s*living\b/i,
  /\b(everyone|everybody|the\s*world|they'?d\s*all|you'?d\s*all)\s*(would\s*be|'?d\s*be|'?s|is|are)?\s*better\s*off\s*(without\s*me|if\s*i\s*(was|were|wasn'?t|weren'?t)\s*(here|around|alive|gone)|when\s*i'?m\s*gone|once\s*i'?m\s*gone)\b/i,
  /\bbetter\s*off\s*if\s*i\s*(was|were|wasn'?t|weren'?t)\s*(here|around|alive|gone|born)\b/i,
  /\bwish\s*i\s*(was|were)\s*(dead|gone|never\s*born)\b/i,
  /\bwish\s*i\s*(wasn'?t|weren'?t)\s*(here|alive|around|born)\b/i,
  /\bdon'?t\s*(see|have)\s*(a|any)\s*future\b(?!\s+in\s+\w)/i,
  /\bdon'?t\s*(see|have)\s*(a|any)\s*reason\s*to\s*(live|go\s*on|keep\s*going|be\s*here|wake\s*up|get\s*up|carry\s*on)\b/i,
  /\b(go(ing)?\s*to\s*sleep|lie\s*down|fall\s*asleep)\s*and\s*(not|never)\s*(wake|waking)\s*up\b/i,
  /\bsleep\s*(forever|and\s*never\s*wake(\s*up)?)\b/i,
  /\bwant\s*(the|this|it|it\s*all)\s*(pain\s*)?to\s*(stop|end|be\s*over)\s*(forever|for\s*good|permanently)\b/i,
  // AMBIGUOUS ESCALATION (reverses the earlier re-calibration for this family):
  // "what's the point anymore" / "...of living / of anything" now fires crisis.
  /\bwhat'?s\s*the\s*point\s*(of|in)\s*(living|life|going\s*on|carrying\s*on|being\s*here|getting\s*up|trying|it\s*all|any\s*of\s*(this|it)|anything)\b/i,
  /\bwhat'?s\s*the\s*point\s*(anymore|any\s*more)\b/i,
  /\b(no|there'?s\s*no)\s*point\s*(in|to)\s*(living|going\s*on|carrying\s*on|being\s*here|getting\s*up|anything|any\s*of\s*(this|it))\b/i,
  /\b(ready\s*to|want\s*to)\s*(give\s*up\s*on|be\s*done\s*with)\s*(life|living|it\s*all|everything)\b/i,
  /\b(done\s*with\s*(life|living)|through\s*with\s*(life|living))\b/i,
];

const VIOLENCE_PATTERNS = [
  /\b(kill\s*(her|him|them|my\s*(wife|husband|partner|boss|kid)))\b/i,
  /\b(shoot\s*(her|him|them|my|the))\b/i,
  /\b(i'?ve?\s*got\s*a\s*(gun|weapon|knife|pistol|rifle))\b/i,
  /\b(bought\s*a\s*(gun|weapon|knife))\b/i,
  /\b(going\s*to\s*(hurt|harm|murder|stab|strangle|choke))\b/i,
  /\b(she'?s?\s*(going\s*to|gonna)\s*pay)\b/i,
  /\b(i'?ll?\s*(make|teach)\s*(her|him|them)\s*(a\s*lesson|sorry|pay))\b/i,
  /\b(want\s*(to|him|her)\s*(dead|gone|eliminated))\b/i,
  /\b(plan\s*to\s*(hurt|harm|kill|attack))\b/i,
];

const DV_PERPETRATING_PATTERNS = [
  /\b(i\s*(hit|slapped|punched|shoved|pushed|choked|strangled|beat)\s*(her|him|my\s*(wife|partner|kid)))\b/i,
  /\b(i\s*(threw|broke)\s*(something|things)\s*(at|near))\b/i,
  /\b(i\s*lost\s*(it|control)\s*and\s*(hit|hurt|grabbed))\b/i,
  /\b(put\s*my\s*hands\s*(on|around)\s*(her|him|his|their))\b/i,
];

const DV_VICTIM_PATTERNS = [
  /\b((she|he|they)\s*(hit|hits|slapped|punched|shoved|pushed|choked|beat|beats|hurts?)\s*me)\b/i,
  /\b((she|he|they)\s*(threatens?|threatened)\s*(to\s*)?(kill|hurt|hit)\s*me)\b/i,
  /\b(i'?m\s*(afraid|scared)\s*(of|for)\s*(my\s*)?(life|safety))\b/i,
  /\b((she|he|they)\s*(has|got|keeps)\s*a\s*(gun|weapon|knife))\b/i,
  // Abuse / DV-victim disclosure ("abused", "being abused", "abusive relationship",
  // "he/she abuses me", "not safe at home") -> routes to the DV support response.
  /\b(getting|being|been|i'?m|i\s*am)\s+((mentally|physically|emotionally|verbally|sexually)\s+(and\s+)?)*abus(ed|ive)\b/i,
  /\babus(ed|ive)\s+(at\s*home|by\s+(my|her|him|them|his|a)|in\s+(my|this|the)\s+(relationship|marriage|home))\b/i,
  /\babusive\s+(relationship|marriage|partner|home|situation|husband|wife|spouse|boyfriend|girlfriend)\b/i,
  /\b((she|he|they|my\s+(wife|husband|partner|ex|mom|dad|mother|father|boyfriend|girlfriend))\s+(abuses?|is\s+abusing|abused)\s+me)\b/i,
  /\bnot\s+safe\s+(at\s*home|in\s+my\s+(home|house|relationship|marriage)|with\s+(her|him|them))\b/i,
  /\b(scared|afraid|terrified)\s+to\s+go\s+home\b/i,
];

// Third-party / indirect risk — the user is worried about SOMEONE ELSE's safety.
// Anchored on an explicit other-person NOUN (not a bare pronoun) near a risk phrase,
// so a first-person turn that merely mentions an ex ("she left me and I want to die")
// is NOT swallowed here — that still routes to the first-person suicide response.
const THIRD_PARTY_RISK_PATTERNS = [
  /\b(my\s+)?(friend|buddy|pal|brother|sister|son|daughter|dad|father|mom|mother|co-?worker|mate|neighbor|roommate|cousin|nephew|someone(\s+i\s+know)?|a\s+(friend|guy|buddy|mate|co-?worker))\b[^.?!]{0,90}\b(depress|suicid|kill(ing)?\s+(him|her|them)self|hurt(ing)?\s+(him|her|them)self|serious\s+thoughts|wants?\s+to\s+(die|end\s+it|kill)|end\s+(his|her|their)\s+life|dark\s+(place|thoughts)|not\s+want(ing)?\s+to\s+(be\s+here|live|go\s+on))\b/i,
  /\b(worried|scared|afraid|concerned|terrified|don'?t\s+know\s+(what\s+to\s+do|how\s+to\s+help))\b[^.?!]{0,60}\b(he'?ll|she'?ll|they'?ll|he\s+(is|might|could|will)|she\s+(is|might|could|will))\b[^.?!]{0,40}\b(hurt\s+(him|her|them)self|kill\s+(him|her|them)self|end\s+(it|his|her|their)|do\s+something\s+(to\s+himself|to\s+herself|stupid))\b/i,
  /\b(he|she|they)\s+(has|have|is\s+having|keeps\s+having|been\s+having|'s\s+having)\s+(some\s+)?serious\s+thoughts\b/i,
];

const SUBSTANCE_CRISIS_PATTERNS = [
  /\b(drunk\s*(right\s*now|and\s*(driving|going\s*to\s*drive)))\b/i,
  /\b(took\s*too\s*many\s*pills)\b/i,
  /\b(overdos(e|ed|ing))\b/i,
  /\b(mixing\s*(pills|drugs|alcohol|meds))\b/i,
  /\b(about\s*to\s*(drink|use|take)\s*(and\s*)?drive)\b/i,
];

// v3 NARROWED — genuinely VEILED passive suicidal ideation ONLY (contemplating not
// existing / not waking / being gone), and only phrasings the explicit SUICIDE set
// above doesn't already catch. Ordinary despair and exhaustion were REMOVED from
// here and now route to a gentle check-in (GENTLE_CHECK_IN_PATTERNS below) — they
// must not produce a hotline. Anything here is elevated (composer runs + 988 append).
const PASSIVE_CRISIS_PATTERNS = [
  /\bjust\s*(want(ing)?\s*to\s*)?not\s*(be\s*here|exist|wake\s*up|be\s*alive)\b/i,
  /\bwish\s*i\s*(could|would)\s*(just\s*)?(not\s*(wake\s*up|be\s*here|exist)|never\s*wake(\s*up)?|disappear\s*(for\s*good|forever))\b/i,
  /\bwouldn'?t\s*(mind|care)\s*(if\s*i\s*)?(didn'?t\s*wake|never\s*woke|wasn'?t\s*here|weren'?t\s*here)\b/i,
  /\b(so\s*)?tired\s*of\s*(living|being\s*alive|waking\s*up|breathing)\b/i,
  /\b(not\s*existing|stop\s*existing|cease\s*to\s*exist)\b/i,
  /\bcheck\s*out\s*(permanently|for\s*good|from\s*(everything|life|it\s*all))\b/i,
  /\bthink(ing)?\s*about\s*(just\s*)?not\s*(being\s*here|existing|waking\s*up)\b/i,
  /\bdon'?t\s*(really\s*)?care\s*(any\s*more|anymore)?\s*(if|whether)\s*i\s*(live|wake\s*up|die|survive)\b/i,
  /\b(settling\s*my\s*(affairs|debts)|gave\s*away\s*(my\s*(stuff|things|belongings)|everything))\b/i,
];

// v3 GENTLE CHECK-IN — the ambiguous middle. Real despair/exhaustion that must NOT
// hotline: a caring general check-in comes first ("that sounds heavy — when you say
// you can't do this, what's going on for you right now?"). If a later turn surfaces
// explicit intent, detectCrisisType fires on that turn and escalates. These are the
// phrasings v3 pulled OUT of PASSIVE_CRISIS_PATTERNS.
const GENTLE_CHECK_IN_PATTERNS = [
  /\bcan'?t\s*(do\s*this|keep\s*(going|doing\s*this)|take\s*(it|this|much\s*more|any\s*more|anymore))\b/i,
  /\bwhat'?s\s*the\s*point\b/i,
  /\bnothing\s*(matters|changes|helps|works|gets\s*better)\b/i,
  /\b(so|really)\s*tired\s*of\s*(everything|this|it\s*all|all\s*(of\s*)?this|trying|fighting|the\s*fighting)\b/i,
  /\bi'?m\s*(so\s*)?(done|finished|through|over\s*it|spent|drained|exhausted)\b/i,
  /\b(want\s*to\s*(disappear|vanish|fade\s*away)|feel\s*like\s*(disappearing|vanishing|fading))\b/i,
  /\b(no\s*one\s*cares|nobody\s*cares|no\s*one\s*(gets|understands?)\s*me)\b/i,
  /\b(die\s*alone|end\s*up\s*alone)\b/i,
  /\b(at\s*the\s*end\s*of\s*my\s*rope|hanging\s*by\s*a\s*thread|barely\s*holding\s*(on|it\s*together)|don'?t\s*know\s*how\s*much\s*(longer|more)\s*i\s*can)\b/i,
  /\b(i\s*give\s*up|ready\s*to\s*give\s*up|feel\s*like\s*giving\s*up)\b/i,
];

/** Fast classifier — stage 1 */
export function detectCrisisType(message: string): CrisisType {
  // Explicit OR indirect suicidal ideation -> the same acute suicide response.
  if (SUICIDE_PATTERNS.some(p => p.test(message)) || INDIRECT_SUICIDE_PATTERNS.some(p => p.test(message))) return 'suicide';
  if (VIOLENCE_PATTERNS.some(p => p.test(message))) return 'violence_toward_others';
  if (DV_PERPETRATING_PATTERNS.some(p => p.test(message))) return 'domestic_violence_perpetrating';
  if (DV_VICTIM_PATTERNS.some(p => p.test(message))) return 'domestic_violence_victim';
  // Third-party AFTER first-person suicide/violence/DV (the user's own risk wins),
  // BEFORE substance/passive.
  if (THIRD_PARTY_RISK_PATTERNS.some(p => p.test(message))) return 'third_party_risk';
  if (SUBSTANCE_CRISIS_PATTERNS.some(p => p.test(message))) return 'substance_crisis';
  if (PASSIVE_CRISIS_PATTERNS.some(p => p.test(message))) return 'passive_crisis';
  return null;
}

/**
 * v3 gentle-check-in tier. True when the message is ambiguous distress that should
 * get a caring check-in FIRST rather than a hotline ("i can't do this anymore",
 * "what's the point", "so tired of all this", "no one cares", "die alone").
 * Returns false whenever an explicit crisis fires — crisis always wins — so this is
 * strictly the ambiguous middle between CRISIS and NORMAL. The composer uses it to
 * prefer a gentle check-in; it never triggers hotline language on its own.
 */
export function needsGentleCheckIn(message: string): boolean {
  if (detectCrisisType(message) !== null) return false;
  return GENTLE_CHECK_IN_PATTERNS.some(p => p.test(message));
}

