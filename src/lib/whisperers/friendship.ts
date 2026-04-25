/**
 * Friendship & Brotherhood Whisperer — Tier 4, §4.06
 * The friendship desert. 15% of men with zero close friends.
 * Phase 3 (BROTHERED) core arena. Pro-all-pathways operationalized here.
 * Foundation: Olaf Kuhlke's fraternal-belonging research.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const FRIENDSHIP_LENSES = {
  friendship_desert: 'The man has no close friends and may not recognize this as a wound. 15% of men report zero close friendships. The loneliness is structural, not personal failure.',
  lost_tribe: 'He once had friends — in the military, college, a team — and lost the container. The skills remain; the structure does not.',
  vulnerability_barrier: 'He has acquaintances but cannot go deeper. The barrier is vulnerability — male friendship deepens through shared exposure, not shared activities.',
  reciprocity_need: 'Men accept help more readily where they can also give. Reciprocity matters. Markos bridges to circles, not therapy groups.',
  brotherhood_hunger: 'He hungers for brotherhood but does not have language for it. "I just need guys who get it." This is the bridge to human connection.',
  isolation_as_strength: 'He frames isolation as self-sufficiency. "I don\'t need people." The strength narrative protects the loneliness.',
};

const FRIENDSHIP_RED_LINES = [
  'Never prescribe social activities or "just join a group"',
  'Never frame his isolation as pathology',
  'Never compare male friendship to female friendship norms',
  'Never push vulnerability faster than trust allows',
  'Never position Markos as replacement for human friendship',
  'Never minimize the difficulty of making friends as an adult man',
];

export async function runFriendshipWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'friendship', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'friendship', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(no friends|zero friends|don't have (any|a) friend|nobody|no one to)\b/i.test(msg)) frameworks.push('friendship_desert');
  if (/\b(used to have|lost touch|moved away|drifted|back in|when I was)\b/i.test(msg)) frameworks.push('lost_tribe');
  if (/\b(can't open up|surface|shallow|don't go deep|acquaintance|not real)\b/i.test(msg)) frameworks.push('vulnerability_barrier');
  if (/\b(guys who get it|brotherhood|circle|men's group|need men|tribe)\b/i.test(msg)) frameworks.push('brotherhood_hunger');
  if (/\b(don't need|lone wolf|fine alone|self[\s-]?sufficient|prefer alone)\b/i.test(msg)) frameworks.push('isolation_as_strength');
  if (frameworks.length === 0) frameworks.push('friendship_desert');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Friendship & Brotherhood Whisperer for Markos. Produce 2-3 sentences of INTERNAL guidance. Pro-all-pathways: bridge to human connection, never compete with it.\n\nActive frameworks: ${frameworks.map(f => FRIENDSHIP_LENSES[f as keyof typeof FRIENDSHIP_LENSES]).join(' | ')}\n\nRed lines: ${FRIENDSHIP_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('isolation_as_strength')) landmines.push('Isolation framed as strength. DO NOT challenge directly. Ask what the strength protects.');
  if (frameworks.includes('friendship_desert')) landmines.push('Friendship desert: this may be the first time he names the loneliness. Witness it.');
  landmines.push('Pro-all-pathways: if he is ready, bridge to men\'s circles or community. If not, let it be.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
