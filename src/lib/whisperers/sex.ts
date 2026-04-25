/**
 * Sex Whisperer — Tier 4, §4.05
 * Sexuality, desire, performance, shame, identity.
 * The territory for honest sexual conversation most systems avoid.
 * Cultural Context Sentinel routing critical. No heteronormative assumptions.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const SEX_LENSES = {
  performance_shame: 'Performance anxiety or erectile issues. The shame is not about the body — it is about masculinity. The body is the presenting symptom; the wound is in the identity.',
  desire_mismatch: 'Desire discrepancy in a relationship. Neither partner is wrong. Help him name what desire means to him beyond the physical.',
  identity_exploration: 'Sexual identity question or confusion. NEUTRAL accompaniment. No assumptions. No labels until he chooses them.',
  porn_relationship: 'Relationship with pornography — not a clinical diagnosis. Explore what it replaces, not whether it is "wrong."',
  intimacy_avoidance: 'He wants physical closeness but avoids it. The avoidance protects something. Discover what.',
  body_shame: 'Shame about his body in sexual context. Aging, weight, scars, disability. The body tells a story he has not been allowed to tell.',
};

const SEX_RED_LINES = [
  'Never give sexual technique advice or performance tips',
  'Never diagnose sexual dysfunction or disorder',
  'Never assume heterosexuality or any orientation',
  'Never moralize about pornography, frequency, or preferences',
  'Never play therapist for couples sexual dynamics',
  'Never frame sex as purely physical — it carries identity weight',
  'Never minimize sexual shame — it is among the deepest male silences',
];

export async function runSexWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'sex', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'sex', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(can't perform|erectile|viagra|hard|couldn't|impotent|premature)\b/i.test(msg)) frameworks.push('performance_shame');
  if (/\b(she wants|he wants|mismatch|different drives|not enough|too much|never initiates)\b/i.test(msg)) frameworks.push('desire_mismatch');
  if (/\b(gay|bi|queer|confused|attraction|orientation|coming out|closet)\b/i.test(msg)) frameworks.push('identity_exploration');
  if (/\b(porn|watch|habit|screen|online|compulsive|can't stop)\b/i.test(msg)) frameworks.push('porn_relationship');
  if (/\b(avoid|won't touch|scared of|push away|don't want to be close)\b/i.test(msg)) frameworks.push('intimacy_avoidance');
  if (/\b(body|ugly|fat|small|ashamed|naked|exposed)\b/i.test(msg)) frameworks.push('body_shame');
  if (frameworks.length === 0) frameworks.push('performance_shame');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Sex Whisperer for Markos. Produce 2-3 sentences of INTERNAL guidance for the Composer. Shame-silence is the dominant type here. Never include anything the man would see.\n\nActive frameworks: ${frameworks.map(f => SEX_LENSES[f as keyof typeof SEX_LENSES]).join(' | ')}\n\nRed lines: ${SEX_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  landmines.push('Sexual territory: shame-silence is the dominant type. NORMALIZE by treating the topic as matter-of-fact, never by saying "it\'s normal."');
  if (frameworks.includes('identity_exploration')) landmines.push('Identity exploration: NEUTRAL. No labels. No assumptions. Let him lead.');
  if (frameworks.includes('performance_shame')) landmines.push('Performance shame: the wound is in identity, not the body. Do NOT offer solutions.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
