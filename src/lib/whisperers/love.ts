/**
 * Love & Intimacy Whisperer — Tier 4, §4.04
 * Romantic connection, attachment, longing, the Lover archetype in mature and shadow forms.
 * Often co-activates with Sex (4.05), Divorce (4.01), and Friendship (4.06).
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const LOVE_LENSES = {
  attachment_wound: 'Attachment injury active — anxious, avoidant, or disorganized patterns showing. Use as reading lens ONLY. Never name attachment theory to the man.',
  addicted_lover: 'Lover shadow: obsessive longing, inability to let go, love-as-addiction pattern. The fix is not detachment but discovering what he is actually hungry for.',
  impotent_lover: 'Lover shadow: numbness, inability to feel or connect. The man who has shut down romantic desire as self-protection.',
  heartbreak: 'Acute heartbreak — the wound is fresh. He needs witnessing, not wisdom. Enter the pain; do not explain it.',
  longing: 'Chronic longing — for connection, for being known, for someone who stays. This is often deeper than the specific person.',
  vulnerability_fear: 'He wants to love but fears what it costs. The armor that protected him now imprisons him.',
};

const LOVE_RED_LINES = [
  'Never give relationship advice or dating strategy',
  'Never diagnose attachment style explicitly to the man',
  'Never encourage pursuing or leaving a specific person',
  'Never frame love as a problem to solve — it is a territory to inhabit',
  'Never minimize heartbreak ("there are other fish")',
  'Never assume heteronormativity',
];

export async function runLoveWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'love', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'love', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(can't let go|obsess|can't stop thinking|addicted to her|addicted to him|need (her|him))\b/i.test(msg)) frameworks.push('addicted_lover');
  if (/\b(numb|don't feel|shut down|can't connect|walls up|closed off|don't let)\b/i.test(msg)) frameworks.push('impotent_lover');
  if (/\b(broke(n)? heart|she left|he left|dumped|it's over|ended|cheated)\b/i.test(msg)) frameworks.push('heartbreak');
  if (/\b(miss (her|him)|still love|wish|lonely|want someone|no one)\b/i.test(msg)) frameworks.push('longing');
  if (/\b(scared|afraid|vulnerable|open up|hurt again|trust|risk)\b/i.test(msg)) frameworks.push('vulnerability_fear');
  if (/\b(attach|clingy|avoidant|push.*away|pull.*close|pattern|always end)\b/i.test(msg)) frameworks.push('attachment_wound');
  if (frameworks.length === 0) frameworks.push('longing');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Love & Intimacy Whisperer for Markos. Produce 2-3 sentences of INTERNAL guidance for the Composer. Never include anything the man would see.\n\nActive frameworks: ${frameworks.map(f => LOVE_LENSES[f as keyof typeof LOVE_LENSES]).join(' | ')}\n\nRed lines: ${LOVE_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('heartbreak')) landmines.push('Acute heartbreak: WITNESS, do not explain. No silver linings.');
  if (frameworks.includes('addicted_lover')) landmines.push('Addicted Lover shadow: the obsession IS the wound talking. Probe what he is really hungry for.');
  if (frameworks.includes('impotent_lover')) landmines.push('Impotent Lover shadow: numbness is protection. Do not force feeling. Create conditions.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
