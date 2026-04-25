/**
 * Addiction & Recovery Whisperer — Tier 4, §4.10
 * Substance use, behavioral addictions, recovery journey, relapse.
 * Highest clinical load. Clinical gate: Yes — Kami.
 * Can NEVER replace 12-step, SMART Recovery, or clinical treatment — only bridge to them.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const ADDICTION_LENSES = {
  active_use: 'Currently using. No judgment. No intervention plan. Witness his experience. If substance crisis, defer to Crisis Sentinel.',
  relapse: 'Relapse is not failure — it is data. The shame of relapse is often more destructive than the use itself. Do not lecture.',
  recovery_identity: 'He is building a new identity around recovery. The old self had a script; the sober self does not yet. Accompany the construction.',
  hidden_addiction: 'He has not named it as addiction. Behavioral (gambling, porn, work) or substance. Let HIM name the pattern.',
  family_impact: 'Addiction ripples: children, partner, parents. He may carry shame about the damage. Do not minimize or quantify it.',
  sobriety_loneliness: 'Sobriety often means losing the community that gathered around the substance. The friend group was the bottle\'s friend group.',
};

const ADDICTION_RED_LINES = [
  'Never diagnose addiction or substance use disorder',
  'Never prescribe sobriety or any specific recovery path',
  'Never replace AA, NA, SMART Recovery, or clinical treatment',
  'Never shame current use or relapse',
  'Never count days/months of sobriety — that is his counter, not ours',
  'Never provide harm reduction medical advice',
  'Never act as sponsor or accountability partner',
  'If substance crisis detected, DEFER to Crisis Sentinel immediately',
];

export async function runAddictionWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'addiction', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'addiction', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(using|drinking|high|wasted|binge|blacked out|hit|snort|inject)\b/i.test(msg)) frameworks.push('active_use');
  if (/\b(relapse|fell off|slipped|broke|went back|couldn't resist|again)\b/i.test(msg)) frameworks.push('relapse');
  if (/\b(sober|clean|recovery|meeting|sponsor|step|chip|milestone)\b/i.test(msg)) frameworks.push('recovery_identity');
  if (/\b(habit|can't stop|compulsive|every day|need it|depend|out of control)\b/i.test(msg)) frameworks.push('hidden_addiction');
  if (/\b(kids saw|wife found|family|damage|hurt them|what i did|destroyed)\b/i.test(msg)) frameworks.push('family_impact');
  if (/\b(lonely|no friends|lost.*friends|don't fit|boring|sober.*alone)\b/i.test(msg)) frameworks.push('sobriety_loneliness');
  if (frameworks.length === 0) frameworks.push('hidden_addiction');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Addiction & Recovery Whisperer for Markos. Highest clinical load. Produce 2-3 sentences of INTERNAL guidance. Bridge to resources, never replace them.\n\nActive frameworks: ${frameworks.map(f => ADDICTION_LENSES[f as keyof typeof ADDICTION_LENSES]).join(' | ')}\n\nRed lines: ${ADDICTION_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('active_use')) landmines.push('Active use: NO judgment, NO intervention plan. If crisis-adjacent, signal to Crisis Sentinel.');
  if (frameworks.includes('relapse')) landmines.push('Relapse: the shame is worse than the slip. DO NOT lecture. Ask what happened before the moment.');
  landmines.push('CLINICAL GATE: Markos bridges to recovery resources. He is not a sponsor, counselor, or treatment program.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
