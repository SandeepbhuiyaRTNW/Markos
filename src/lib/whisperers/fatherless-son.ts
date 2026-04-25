/**
 * Fatherless Son Whisperer — Tier 4, §4.14
 * The man whose father was absent, abusive, addicted, deceased, or emotionally unavailable.
 * Distinct from Fatherhood (4.03): this is the man AS SON of an absent father.
 * Clinical gate: Yes — Kami. Trust threshold: minimum 8 sessions before activation.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const FATHERLESS_SON_LENSES = {
  absence_wound: 'The primary wound: he was not fathered. The absence shaped him in ways he may not see. Often emerges via Layer 5 — the man who never mentions his father.',
  anger_at_father: 'Rage at the man who left, drank, hit, or simply was not there. The anger is legitimate. Let it exist before exploring what it protects.',
  self_fathering: 'He has been fathering himself. The self-reliance is both his strength and his prison. He learned to need no one.',
  re_parenting_cycle: 'He is now a father, parenting without a model. The fear of repeating intersects with Fatherhood Whisperer territory.',
  idealized_father: 'He carries an image of the father who should have been. The idealization blocks grief for the father who was.',
  forgiveness_territory: 'He may or may not be ready to forgive. This is HIS timeline. Never rush. Forgiveness is a horizon, not a destination.',
};

const FATHERLESS_SON_RED_LINES = [
  'Never push forgiveness — his timeline, not ours',
  'Never minimize the absence ("at least you had...")',
  'Never diagnose the father (alcoholic, narcissist, etc.) — the man names his own experience',
  'Never frame the wound as something to "get over"',
  'Never assume the absence was physical — emotional absence is equally formative',
  'Never activate before trust threshold (minimum 8 sessions) unless the man raises it explicitly',
];

/** Trust threshold check: requires minimum 8 sessions unless man raises it */
function meetsActivationThreshold(env: StateEnvelope): boolean {
  const sessionCount = env.sentinels.memory.session_count;
  // Activate if 8+ sessions OR if the man explicitly raises fatherless topics
  if (sessionCount >= 8) return true;
  // Check if the man is explicitly naming it
  const msg = env.utterance.toLowerCase();
  return /\b(my (dad|father)|grew up without|fatherless|absent father|never knew my|dad.*left|father.*abandon)\b/i.test(msg);
}

export async function runFatherlessSonWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  if (!meetsActivationThreshold(env)) {
    return { question_candidates: [], frameworks_applied: ['trust_threshold_not_met'], landmines: ['Trust threshold not met — deferring activation.'], context_notes: '' };
  }

  const questionCandidates = await retrieveWhispererQuestions(env, 'fatherless_son', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'fatherless_son', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(wasn't there|never (there|around|knew)|absent|left|abandon|where was)\b/i.test(msg)) frameworks.push('absence_wound');
  if (/\b(hate (him|my dad|my father)|angry|rage|furious|resent|how could he)\b/i.test(msg)) frameworks.push('anger_at_father');
  if (/\b(on my own|taught myself|raised myself|didn't need|figured it out|no help)\b/i.test(msg)) frameworks.push('self_fathering');
  if (/\b(my (son|daughter|kid)|don't want.*like him|different father|break.*cycle)\b/i.test(msg)) frameworks.push('re_parenting_cycle');
  if (/\b(wish he|if he had|should have been|imagin|the father i|deserved)\b/i.test(msg)) frameworks.push('idealized_father');
  if (/\b(forgive|let go|move on|reconcile|understand why|make peace)\b/i.test(msg)) frameworks.push('forgiveness_territory');
  if (frameworks.length === 0) frameworks.push('absence_wound');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Fatherless Son Whisperer for Markos. Clinical gate active. Produce 2-3 sentences of INTERNAL guidance. This territory requires deep trust.\n\nActive frameworks: ${frameworks.map(f => FATHERLESS_SON_LENSES[f as keyof typeof FATHERLESS_SON_LENSES]).join(' | ')}\n\nRed lines: ${FATHERLESS_SON_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nSessions: ${env.sentinels.memory.session_count}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('forgiveness_territory')) landmines.push('Forgiveness territory: HIS timeline. Never suggest, encourage, or model forgiveness. Let it emerge or not.');
  if (frameworks.includes('absence_wound')) landmines.push('Absence wound: this may be the first time he has named what was missing. The naming IS the work.');
  landmines.push('Layer 5 territory: the silence around the father is structurally different from other silences. Tread carefully.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
