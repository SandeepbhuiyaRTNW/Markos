/**
 * Fatherhood Whisperer — Tier 4, §4.03
 * The man's experience as father — current, absent, fearful, grieving.
 * Distinct from Fatherless Son (4.14): this is the man AS father.
 *
 * Clinical frameworks INVISIBLE to the man.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const FATHERHOOD_LENSES = {
  shame_of_absence: 'The shame of not being the father he intended. This is the most common territory. He measures himself against an ideal and falls short. Do NOT reassure — let him name the gap.',
  divorced_fatherhood: 'Co-parenting after divorce. Identity fracture: from full-time father to visitor. Coordinate with Divorce Whisperer lens.',
  legacy_question: 'What am I passing on? Legacy questions belong here, not in Work & Purpose. The man is asking what his children will remember.',
  fear_of_repeating: 'Fear of becoming his own father. The cycle question. Often connects to Fatherless Son territory.',
  provider_identity: 'Fatherhood fused with provision. When the paycheck falters, the father identity fractures. Common entry point.',
  presence_vs_performance: 'He confuses performance (providing, fixing, coaching) with presence (being there, being still). Help him see the difference without naming it.',
};

const FATHERHOOD_RED_LINES = [
  'Never advise on custody, visitation, or legal strategy',
  'Never judge his parenting — he is already judging himself',
  'Never compare him to other fathers or "good dad" ideals',
  'Never prescribe activities or routines with his children',
  'Never minimize time-limited fatherhood (every-other-weekend IS fatherhood)',
  'Never act as family therapist or co-parenting mediator',
];

export async function runFatherhoodWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'fatherhood', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'fatherhood', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(not there|miss(ed|ing)|away|absent|every other|weekend dad|visit)\b/i.test(msg)) {
    frameworks.push('shame_of_absence');
  }
  if (/\b(ex|custody|co[\s-]?parent|her house|my time|split|schedule)\b/i.test(msg)) {
    frameworks.push('divorced_fatherhood');
  }
  if (/\b(legacy|remember me|pass(ed|ing) on|what kind of (father|dad)|my (son|daughter) will)\b/i.test(msg)) {
    frameworks.push('legacy_question');
  }
  if (/\b(like my (father|dad|old man)|same mistake|repeat|cycle|become him|turn into)\b/i.test(msg)) {
    frameworks.push('fear_of_repeating');
  }
  if (/\b(provid|paycheck|earn|support|money|can't afford|enough for)\b/i.test(msg)) {
    frameworks.push('provider_identity');
  }
  if (frameworks.length === 0) frameworks.push('presence_vs_performance');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Fatherhood Whisperer intelligence layer for Markos. Given a man's message about fatherhood and training context, produce 2-3 sentences of INTERNAL guidance for the Composer. Be precise and clinical. Never include anything the man would see.\n\nActive frameworks: ${frameworks.map(f => FATHERHOOD_LENSES[f as keyof typeof FATHERHOOD_LENSES]).join(' | ')}\n\nRed lines: ${FATHERHOOD_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('shame_of_absence')) {
    landmines.push('He is in father-shame. DO NOT reassure ("you\'re a great dad"). Let him name what he sees in the gap.');
  }
  if (frameworks.includes('divorced_fatherhood')) {
    landmines.push('Divorced fatherhood: identity fracture active. He is not a part-time father — help him see fatherhood as identity, not schedule.');
  }
  if (env.assessment.silence_type?.label === 'shame') {
    landmines.push('Shame-silence around fatherhood. The wound is in the gap between intention and reality.');
  }

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
