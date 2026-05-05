/**
 * Craft Layer — Tier 5, §9
 * Post-Composer shaping: ensures the response lands with proper form and weight.
 * Modules: Socratic Questioner, Deep Listener, Vocative Filter,
 *          Vocabulary Fidelity Filter, Forbidden Phrase Filter,
 *          Fantasy-Identity Blocker
 *
 * The Craft Layer does NOT change meaning — it shapes delivery.
 */

import type { StateEnvelope, CraftDirectives } from '../agents/state-envelope';

// ─── VOCATIVE PRINCIPLE (Engineering Findings §4) ───
// Markos addresses men by their first names ONLY.
// No fraternal, archetypal, or category labels.
const BANNED_VOCATIVES = [
  'brother', 'bro', 'man', 'buddy', 'friend', 'sir',
  'king', 'warrior', 'lover', 'magician',
  'your honor', 'champ', 'chief', 'boss',
  'fellow', 'mate', 'pal', 'dude', 'my friend', 'my man',
];

// Match vocatives at sentence start/end, after/before commas
const VOCATIVE_REGEX = new RegExp(
  `(?:^|(?<=,\\s?)|(?<=\\.\\s))(?:${BANNED_VOCATIVES.map(v => v.replace(/\s+/g, '\\s+')).join('|')})(?=[,\\.!?\\s]|$)`,
  'gi'
);

/**
 * Vocative Principle Filter — strips banned vocatives, replaces with first name.
 * Ships Day 1. Applies to ALL output surfaces.
 */
export function enforceVocativePrinciple(response: string, userName: string | null): string {
  let result = response;
  for (const vocative of BANNED_VOCATIVES) {
    // Case-insensitive replacement of vocative patterns
    const patterns = [
      // "Brother, " at start of sentence or after period
      new RegExp(`(^|[.!?]\\s*)${vocative}[,.]?\\s*`, 'gi'),
      // ", brother" at end of phrase
      new RegExp(`,\\s*${vocative}([.!?\\s]|$)`, 'gi'),
      // "brother" as standalone address
      new RegExp(`\\b${vocative}\\b`, 'gi'),
    ];
    for (const pattern of patterns) {
      result = result.replace(pattern, (match, prefix) => {
        if (userName) {
          // Preserve the prefix (sentence start) and replace vocative with name
          if (prefix && /[.!?]/.test(prefix)) return `${prefix}${userName}, `;
          return userName;
        }
        // No name available — strip the vocative
        if (prefix && /[.!?]/.test(prefix)) return prefix;
        return '';
      });
    }
  }
  // Clean up double spaces and leading/trailing whitespace
  return result.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
}

// ─── FORBIDDEN PHRASES (Appendix C.7) ───
// Phrases the system NEVER says in any generative output.
const FORBIDDEN_PHRASES = [
  /\bi am here for you\b/i,
  /\btake a deep breath\b/i,
  /\byou are stronger than you think\b/i,
  /\bthis too shall pass\b/i,
  /\beverything happens for a reason\b/i,
  /\byou should be proud of yourself for opening up\b/i,
  /\bi'?m so glad you shared that with me\b/i,
  /\bthat is so brave\b/i,
  /\bimagine yourself a year from now\b/i,
  /\byour future self\b/i,
  /\bwhere you want to be in\b/i,
  /\bsun people\b/i,
  /\bunsilenced\b/i,
  /\bbrothered\b/i,
  /\bfrom silence to sun\b/i,
  /\bwhat i'?m hearing you say is\b/i,
  /\bwhat i am hearing you say is\b/i,
];

/**
 * Forbidden Phrase Filter — checks draft for phrases that must never appear.
 * Returns list of violations. Empty = clean.
 */
export function detectForbiddenPhrases(response: string): string[] {
  const violations: string[] = [];
  for (const pattern of FORBIDDEN_PHRASES) {
    const match = response.match(pattern);
    if (match) violations.push(match[0]);
  }
  return violations;
}

// ─── FANTASY-IDENTITY BLOCKER (Finding 4) ───
// Detects forward-projecting fantasy-identity question templates in draft output.
const FANTASY_IDENTITY_PATTERNS = [
  /imagine yourself a year from now/i,
  /picture yourself/i,
  /who would you be if/i,
  /what does your future self/i,
  /where do you want to be in (five|5|ten|10) years/i,
  /what is the version of you/i,
  /what would that version of you/i,
  /who you'?re becoming/i,
  /who are you becoming/i,
  /what does the man you'?re becoming/i,
  /what would your best self/i,
  /picture it clearly/i,
  /what'?s one (small )?step you could take today/i,
  /where do you want to be in a year/i,
];

/**
 * Fantasy-Identity Blocker — detects fantasy-identity templates in draft.
 * Returns true if the draft contains forward-projecting templates that should be re-rolled.
 */
export function detectFantasyIdentity(response: string): boolean {
  return FANTASY_IDENTITY_PATTERNS.some(p => p.test(response));
}

// ─── VOCABULARY FIDELITY CHECK (Finding 3) ───
// Extracts concrete words from user message and checks if draft substitutes them.
const SOMATIC_SUBSTITUTIONS: Record<string, RegExp> = {
  'throw up': /\b(heavy feeling|weight in the chest|somatic distress|visceral response)\b/i,
  'sick': /\b(heavy feeling|somatic distress|visceral response)\b/i,
  'nauseous': /\b(heavy feeling|somatic distress)\b/i,
  'can\'t breathe': /\b(anxiety|panic|dysregulation|activated nervous system)\b/i,
  'chest tight': /\b(anxiety|panic|dysregulation)\b/i,
  'numb': /\b(dissociation|depressed affect|emotional blunting|frozen state)\b/i,
  'dead inside': /\b(dissociation|depressed affect|emotional blunting)\b/i,
  'tired': /\b(depleted|fatigue|depressive symptoms|low energy)\b/i,
  'exhausted': /\b(depleted|fatigue|depressive symptoms)\b/i,
  'can\'t sleep': /\b(insomnia|sleep disturbance|hyperarousal|rumination)\b/i,
  'crying': /\b(tearful|lacrimating|emotional release|processing)\b/i,
  'shaking': /\b(tremor|somatic activation|physiological response)\b/i,
  'drowning': /\b(overwhelmed|flooded|dysregulated)\b/i,
};

const MORAL_SUBSTITUTIONS: Record<string, RegExp> = {
  'cheated': /\b(betrayal|infidelity|breach of trust|broken commitment)\b/i,
  'lied': /\b(deception|dishonesty|lack of transparency)\b/i,
  'abandoned': /\b(left|separated|departed|exited the relationship)\b/i,
  'destroyed': /\b(impacted|affected|transformed the family system)\b/i,
  'manipulated': /\b(exhibited control patterns|displayed manipulative behavior)\b/i,
  'controlling': /\b(exhibited control patterns|displayed manipulative behavior)\b/i,
  'failed': /\b(experienced challenges|things did not work out)\b/i,
  'coward': /\b(fear-avoidance|conflict-avoidant)\b/i,
  'worthless': /\b(experiencing low self-esteem|internalizing)\b/i,
};

/**
 * Vocabulary Fidelity Check — detects when draft substitutes user's concrete words
 * with clinical/wellness abstractions.
 * Returns list of substitution violations.
 */
export function detectVocabSubstitutions(userMessage: string, draftResponse: string): string[] {
  const violations: string[] = [];
  const msgLower = userMessage.toLowerCase();

  // Check somatic substitutions
  for (const [userWord, forbiddenPattern] of Object.entries(SOMATIC_SUBSTITUTIONS)) {
    if (msgLower.includes(userWord) && forbiddenPattern.test(draftResponse)) {
      violations.push(`vocab: user said "${userWord}", draft substituted with clinical term`);
    }
  }

  // Check moral substitutions
  for (const [userWord, forbiddenPattern] of Object.entries(MORAL_SUBSTITUTIONS)) {
    if (msgLower.includes(userWord) && forbiddenPattern.test(draftResponse)) {
      violations.push(`vocab: user said "${userWord}", draft substituted with clinical term`);
    }
  }

  // Generic check: if user said a concrete word, did the draft use it?
  // Extract key nouns/verbs from user message for fidelity check
  const concreteWords = extractConcreteWords(userMessage);
  const draftLower = draftResponse.toLowerCase();
  const hasAnyUserWord = concreteWords.some(w => draftLower.includes(w.toLowerCase()));

  if (concreteWords.length > 0 && !hasAnyUserWord && draftResponse.length > 50) {
    violations.push('vocab: no concrete user words preserved in response');
  }

  return violations;
}

/** Extract concrete nouns/verbs from user message (somatic, domestic, morally loaded) */
function extractConcreteWords(message: string): string[] {
  const words: string[] = [];
  const msg = message.toLowerCase();

  // Somatic words
  const somaticPatterns = [
    /throw up/i, /sick/i, /nauseous/i, /can't breathe/i, /chest tight/i,
    /numb/i, /dead inside/i, /tired/i, /exhausted/i, /drained/i,
    /can't sleep/i, /crying/i, /shaking/i, /pacing/i, /drowning/i,
  ];
  for (const p of somaticPatterns) {
    const match = msg.match(p);
    if (match) words.push(match[0]);
  }

  // Morally loaded words
  const moralPatterns = [
    /cheated/i, /lied/i, /abandoned/i, /destroyed/i, /manipulated/i,
    /controlling/i, /failed/i, /coward/i, /worthless/i, /idiot/i, /stupid/i,
  ];
  for (const p of moralPatterns) {
    const match = msg.match(p);
    if (match) words.push(match[0]);
  }

  // Domestic specifics — locations, times, names in quotes
  const domesticPatterns = [
    /kitchen/i, /garage/i, /basement/i, /bedroom/i, /truck/i,
    /2am/i, /3am/i, /4am/i, /tuesday/i, /thanksgiving/i,
  ];
  for (const p of domesticPatterns) {
    const match = msg.match(p);
    if (match) words.push(match[0]);
  }

  return words;
}

/** Determine craft directives based on Assessment Ring state */
export function determineCraftDirectives(env: StateEnvelope): CraftDirectives {
  const silenceType = env.assessment.silence_type?.label;
  const depth = env.sentinels.listener_stack?.depth_level || 2;
  const phase = env.assessment.phase.label;
  const crisis = env.sentinels.crisis.level;
  const trajectory = env.sentinels.listener_stack?.emotional_trajectory || 'neutral';

  // Crisis: override everything
  if (crisis === 'acute') {
    return { form: 'statement', pacing: 'full', metaphor_hint: null, style_override: 'crisis_protocol' };
  }

  // Silence-based pacing
  if (silenceType === 'shame') {
    return {
      form: 'presence',
      pacing: 'acknowledgment_only',
      metaphor_hint: null,
      style_override: 'Shame-silence: 1-2 sentences max. Sit with him. Do not probe.',
    };
  }

  if (silenceType === 'grief') {
    return {
      form: 'reflection',
      pacing: depth >= 3 ? 'full' : 'short',
      metaphor_hint: null,
      style_override: 'Grief-silence: witness, do not fix. Name what is present.',
    };
  }

  if (silenceType === 'avoidance') {
    return {
      form: 'question',
      pacing: 'short',
      metaphor_hint: null,
      style_override: 'Avoidance: a better question, not pressure. Side door, not front door.',
    };
  }

  if (silenceType === 'protective') {
    return {
      form: 'reflection',
      pacing: 'short',
      metaphor_hint: null,
      style_override: 'Protective silence: respect it, then gentle return. He is protecting someone.',
    };
  }

  // Phase-based form
  if (phase === 'brothered' && depth >= 4) {
    return { form: 'challenge', pacing: 'full', metaphor_hint: null, style_override: null };
  }

  if (trajectory === 'opening' || trajectory === 'deepening') {
    return { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null };
  }

  // Default: question with full pacing
  return { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null };
}

/**
 * Socratic Questioner — ensure responses end with weight, not filler.
 * If the response should end with a question, enforce single-question discipline.
 */
export function enforceSocraticDiscipline(response: string, directives: CraftDirectives): string {
  if (directives.form === 'presence' || directives.form === 'statement') {
    // Remove trailing questions for presence/statement forms
    const lines = response.split('\n').filter(l => l.trim());
    if (lines.length > 1 && lines[lines.length - 1].trim().endsWith('?')) {
      // Keep only if the response is just one question
      const questionCount = response.split('?').length - 1;
      if (questionCount > 1) {
        // Remove all but the last question
        return response;
      }
    }
    return response;
  }

  if (directives.form === 'question') {
    // Enforce single-question discipline
    const questionMarks = (response.match(/\?/g) || []).length;
    if (questionMarks > 1) {
      // Find the last question — that's usually the deepest one
      const lines = response.split('\n');
      const questionLines = lines.filter(l => l.trim().endsWith('?'));
      if (questionLines.length > 1) {
        // Keep the last question, trim the rest to setup + last question
        const lastQ = questionLines[questionLines.length - 1];
        const lastQIdx = lines.lastIndexOf(lastQ);
        const setup = lines.slice(0, lastQIdx).filter(l => !l.trim().endsWith('?'));
        return [...setup, lastQ].join('\n').trim();
      }
    }
  }

  return response;
}

/**
 * Deep Listener — for silence-breaking moments, strip response to minimum.
 * When a man breaks a deep silence, less is more.
 */
export function applyDeepListener(
  response: string,
  directives: CraftDirectives,
  isSilenceBreaking: boolean,
): string {
  if (!isSilenceBreaking) return response;

  if (directives.pacing === 'acknowledgment_only') {
    // Ultra-short: 1-2 sentences max
    const sentences = response.match(/[^.!?]+[.!?]+/g) || [response];
    return sentences.slice(0, 2).join(' ').trim();
  }

  if (directives.pacing === 'short') {
    const sentences = response.match(/[^.!?]+[.!?]+/g) || [response];
    return sentences.slice(0, 3).join(' ').trim();
  }

  return response;
}

