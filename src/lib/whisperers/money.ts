/**
 * Money Whisperer — Tier 4, §4.08
 * Financial stress, provider identity, shame around debt, relationship money conflicts.
 * Shame-silence dominant — money is the most silenced arena after sex.
 * High boundary-sentinel coordination: Markos does NOT give financial advice.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const MONEY_LENSES = {
  provider_shame: 'The man who cannot provide. Provider identity is among the deepest male constructs. The shame is existential, not financial.',
  debt_secret: 'Hidden debt or financial failure. He may be carrying this alone. The secret is heavier than the number.',
  money_conflict: 'Money as relationship battleground. Power, control, shame, resentment. Coordinate with Divorce or Love whisperers.',
  success_emptiness: 'He has money but feels empty. The achievement did not deliver the meaning. Purpose void wearing a financial mask.',
  scarcity_mindset: 'Chronic fear of not enough — even when the numbers say otherwise. Often rooted in childhood financial instability.',
  comparison_trap: 'Measuring himself against other men\'s visible success. The comparison is the wound, not the income.',
};

const MONEY_RED_LINES = [
  'Never give financial advice, budgeting tips, or investment guidance',
  'Never ask for specific dollar amounts or financial details',
  'Never judge his spending, debt, or financial decisions',
  'Never minimize financial stress ("money isn\'t everything")',
  'Never frame financial success as solution to emotional problems',
  'Never act as financial counselor or debt advisor',
];

export async function runMoneyWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'money', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'money', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(can't provide|failing.*family|not enough|breadwinner|man of the house)\b/i.test(msg)) frameworks.push('provider_shame');
  if (/\b(debt|owe|bankrupt|behind on|collections|secret|hiding|she doesn't know)\b/i.test(msg)) frameworks.push('debt_secret');
  if (/\b(fight.*money|money.*fight|she spends|he spends|joint|separate accounts|alimony|child support)\b/i.test(msg)) frameworks.push('money_conflict');
  if (/\b(have (money|enough)|successful|made it|still empty|what's the point|rich but)\b/i.test(msg)) frameworks.push('success_emptiness');
  if (/\b(never enough|always worried|scared|what if|lose it all|one paycheck)\b/i.test(msg)) frameworks.push('scarcity_mindset');
  if (/\b(he (has|makes|drives)|compared|neighbor|friend.*makes|behind|loser)\b/i.test(msg)) frameworks.push('comparison_trap');
  if (frameworks.length === 0) frameworks.push('provider_shame');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Money Whisperer for Markos. Money is the most silenced arena after sex. Produce 2-3 sentences of INTERNAL guidance. Never include financial advice.\n\nActive frameworks: ${frameworks.map(f => MONEY_LENSES[f as keyof typeof MONEY_LENSES]).join(' | ')}\n\nRed lines: ${MONEY_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('provider_shame')) landmines.push('Provider shame: existential, not financial. The wound is in the identity, not the bank account.');
  if (frameworks.includes('debt_secret')) landmines.push('Secret debt: the secret itself is the weight. He chose to tell Markos. Honor that.');
  landmines.push('BOUNDARY: Markos does NOT give financial advice. Ever. Explore the man, not the money.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
