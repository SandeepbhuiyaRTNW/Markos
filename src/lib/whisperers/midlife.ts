/**
 * Midlife & Aging Whisperer — Tier 4, §4.12
 * Identity shifts in middle age, mortality awareness, legacy, aging parents, existential stocktaking.
 * Men 35–64 account for 46.8% of all U.S. suicides — crisis-adjacent weight.
 * Strong Tier 3 Existentialist voice affinity.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const MIDLIFE_LENSES = {
  mortality_awareness: 'He is aware that time is finite. This is not depression — it is clarity. The question becomes: what remains essential?',
  existential_stocktaking: 'He is measuring his life against what he expected. The gap between what-is and what-should-have-been is the wound.',
  aging_parents: 'His parents are aging or dying. The role reversal — child becomes caretaker — reshapes his identity and surfaces his own mortality.',
  legacy_urgency: 'What will I leave behind? Legacy questions carry urgency in midlife. Different from fatherhood legacy — this is about the man himself.',
  loss_of_younger_self: 'Grief for who he was. The body, the energy, the possibilities that have closed. This is real grief, not nostalgia.',
  second_half_meaning: 'The first half was accumulation; the second half asks for meaning. He may not have language for what is happening.',
};

const MIDLIFE_RED_LINES = [
  'Never dismiss midlife questioning as "just a phase" or "midlife crisis"',
  'Never prescribe solutions (sports car, new relationship, career change)',
  'Never minimize mortality awareness — it is a doorway, not a symptom',
  'Never compare his timeline to others',
  'Never rush past the stocktaking — the accounting matters',
  'Never frame aging as purely loss — it also carries authority and depth',
];

export async function runMidlifeWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'midlife', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'midlife', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(die|death|mortal|finite|time left|how long|end|tick)\b/i.test(msg)) frameworks.push('mortality_awareness');
  if (/\b(thought i'd|supposed to|by now|expected|planned|should have|imagined)\b/i.test(msg)) frameworks.push('existential_stocktaking');
  if (/\b(parents|mom|dad|mother|father).*(sick|old|dying|hospital|care|decline|alzheimer|dementia)\b/i.test(msg)) frameworks.push('aging_parents');
  if (/\b(legacy|leave behind|remembered|matter|impact|contribution)\b/i.test(msg)) frameworks.push('legacy_urgency');
  if (/\b(used to be|young|back when|miss who|energy|can't anymore|body)\b/i.test(msg)) frameworks.push('loss_of_younger_self');
  if (/\b(what's next|second (half|act)|meaning|purpose|now what|rest of)\b/i.test(msg)) frameworks.push('second_half_meaning');
  if (frameworks.length === 0) frameworks.push('existential_stocktaking');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Midlife & Aging Whisperer for Markos. Strong Existentialist voice affinity (Tier 3). Produce 2-3 sentences of INTERNAL guidance. This territory carries crisis-adjacent weight.\n\nActive frameworks: ${frameworks.map(f => MIDLIFE_LENSES[f as keyof typeof MIDLIFE_LENSES]).join(' | ')}\n\nRed lines: ${MIDLIFE_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('mortality_awareness')) landmines.push('Mortality awareness: this is clarity, not crisis. Unless crisis signals present, treat as a doorway to depth.');
  if (frameworks.includes('existential_stocktaking')) landmines.push('Existential stocktaking: let him do the accounting. The gap between expectation and reality IS the conversation.');
  landmines.push('CRISIS-ADJACENT: Men 35-64 = 46.8% of suicides. Monitor for hopelessness beneath the philosophical questioning.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
