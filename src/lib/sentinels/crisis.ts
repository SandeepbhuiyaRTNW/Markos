/**
 * Crisis Sentinel — Tier 1, §5.2
 * Two-stage: fast classifier for recall, LLM verifier for precision.
 * Acute crisis forces a specific response and disables Tier 4 Whisperers.
 */

import type { CrisisOutput, CrisisType, CrisisLevel } from '../agents/state-envelope';
import type { StateEnvelope } from '../agents/state-envelope';

// ─── IMMEDIATE crisis patterns — hard intercept ───
// Expanded per Engineering Findings §5: direct method language, ambivalence, oblique phrases

const SUICIDE_PATTERNS = [
  // --- Direct statements ---
  /\b(suicid|kill\s*my\s*self|end\s*(my|it|things)|checking\s*out|better\s*off\s*(without|dead))\b/i,
  /\b(want\s*to\s*die|don'?t\s*want\s*to\s*(be\s*here|live|exist|wake\s*up))\b/i,
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
  /\b(wouldn'?t\s*miss\s*me|world\s*(is\s*)?better\s*without|nobody\s*(would\s*)?(care|notice))\b/i,
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
  /\b((she|he)\s*(hit|slapped|punched|shoved|pushed|choked|beat)\s*me)\b/i,
  /\b((she|he)\s*(threatens?|threatened)\s*(to\s*)?(kill|hurt)\s*me)\b/i,
  /\b(i'?m\s*(afraid|scared)\s*(of|for)\s*(my\s*)?(life|safety))\b/i,
  /\b((she|he)\s*(has|got|keeps)\s*a\s*(gun|weapon|knife))\b/i,
];

const SUBSTANCE_CRISIS_PATTERNS = [
  /\b(drunk\s*(right\s*now|and\s*(driving|going\s*to\s*drive)))\b/i,
  /\b(took\s*too\s*many\s*pills)\b/i,
  /\b(overdos(e|ed|ing))\b/i,
  /\b(mixing\s*(pills|drugs|alcohol|meds))\b/i,
  /\b(about\s*to\s*(drink|use|take)\s*(and\s*)?drive)\b/i,
];

const PASSIVE_CRISIS_PATTERNS = [
  /\b(what'?s\s*the\s*point)\b/i,
  /\b(nothing\s*(matters|changes|helps|works))\b/i,
  /\b(so\s*tired\s*of\s*(everything|this|living|trying|fighting))\b/i,
  /\b(can'?t\s*(do\s*this|keep\s*(going|doing\s*this)|take\s*(it|this|any\s*more)))\b/i,
  /\b(i'?m\s*(done|finished|through|over\s*it))\b/i,
  /\b(no\s*one\s*(cares|would\s*(miss|notice)))\b/i,
  /\b((feel|want)\s*(like\s*)?(disappearing|vanishing|fading))\b/i,
  /\b(want\s*to\s*(disappear|vanish|fade\s*away))\b/i,
  /\b(gave\s*away|settling\s*my\s*(affairs|debts))\b/i,
  /\b(not\s*existing)\b/i,
  /\b(wish\s*i\s*(could|can)\s*(just\s*)?(check\s*out|disappear|not\s*(be|exist)|go\s*away|vanish))\b/i,
  /\b(just\s*not\s*(be\s*here|exist|be\s*around|wake\s*up))\b/i,
  /\b(check\s*out\s*(for\s*a\s*while|permanently|from\s*(everything|life|all\s*this)))\b/i,
  /\b(think\s*about\s*(just\s*)?(not\s*existing|not\s*being\s*here|disappearing|checking\s*out))\b/i,
  /\b(wouldn'?t\s*(mind|care)\s*(if\s*i\s*)?(not\s*waking|didn'?t\s*wake|just\s*went\s*away))\b/i,
  /\b(don'?t\s*(really\s*)?(care\s*)?what\s*happens\s*to\s*me)\b/i,
  /\b(die\s*alone)\b/i,
];

/** Fast classifier — stage 1 */
export function detectCrisisType(message: string): CrisisType {
  if (SUICIDE_PATTERNS.some(p => p.test(message))) return 'suicide';
  if (VIOLENCE_PATTERNS.some(p => p.test(message))) return 'violence_toward_others';
  if (DV_PERPETRATING_PATTERNS.some(p => p.test(message))) return 'domestic_violence_perpetrating';
  if (DV_VICTIM_PATTERNS.some(p => p.test(message))) return 'domestic_violence_victim';
  if (SUBSTANCE_CRISIS_PATTERNS.some(p => p.test(message))) return 'substance_crisis';
  if (PASSIVE_CRISIS_PATTERNS.some(p => p.test(message))) return 'passive_crisis';
  return null;
}

