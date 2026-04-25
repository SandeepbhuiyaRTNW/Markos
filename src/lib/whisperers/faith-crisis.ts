/**
 * Faith Crisis Whisperer — Tier 4, §4.13
 * Rupture in religious or spiritual tradition. Deconstruction, doubt, loss of community.
 * Distinct from Faith Voice (Tier 3 — intact tradition). This is men IN rupture.
 * Clinical gate: Yes — Kami. No proselytizing, no deconversion agenda.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const FAITH_CRISIS_LENSES = {
  deconstruction: 'Active deconstruction of religious belief. The structure that held his world is dissolving. This is grief, not intellectual exercise.',
  community_loss: 'Religious community loss is specific social bereavement. The church was his tribe, his identity, his social world. Losing faith = losing belonging.',
  doubt_shame: 'He doubts but feels shame about doubting. The community punishes questioning. He may be the first person he has told.',
  god_betrayal: 'He feels betrayed by God. A prayer unanswered, a tragedy unexplained. The anger is theological grief.',
  moral_framework_collapse: 'The moral framework he built his life on is cracking. Without the rules, who is he? This is identity work, not theology.',
  spiritual_hunger: 'He left the tradition but the hunger remains. Something in him still reaches. Help him name what he is reaching for.',
};

const FAITH_CRISIS_RED_LINES = [
  'Never proselytize or advocate for any religious position',
  'Never encourage deconversion or return to faith — neutral accompaniment only',
  'Never argue theology, scripture, or doctrine',
  'Never frame doubt as weakness or faith as virtue',
  'Never minimize the loss of religious community',
  'Never assume which tradition he comes from',
  'High cultural variability — Cultural Context Sentinel routes',
];

export async function runFaithCrisisWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'faith_crisis', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'faith_crisis', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(deconstructi|question.*faith|don't believe|losing.*faith|can't believe)\b/i.test(msg)) frameworks.push('deconstruction');
  if (/\b(church|community|congregation|fellowship|left.*church|kicked out|shunned)\b/i.test(msg)) frameworks.push('community_loss');
  if (/\b(doubt|wrong.*doubt|guilty.*question|ashamed.*faith|scared.*hell)\b/i.test(msg)) frameworks.push('doubt_shame');
  if (/\b(god.*why|betrayed|unanswered|pray.*nothing|where.*god|abandoned.*god)\b/i.test(msg)) frameworks.push('god_betrayal');
  if (/\b(right.*wrong|moral|rules|sin|should|commandment|how.*live)\b/i.test(msg)) frameworks.push('moral_framework_collapse');
  if (/\b(still.*something|spiritual|searching|hunger|missing|sacred|transcend)\b/i.test(msg)) frameworks.push('spiritual_hunger');
  if (frameworks.length === 0) frameworks.push('deconstruction');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Faith Crisis Whisperer for Markos. Neutral accompaniment ONLY. Produce 2-3 sentences of INTERNAL guidance. No theological position.\n\nActive frameworks: ${frameworks.map(f => FAITH_CRISIS_LENSES[f as keyof typeof FAITH_CRISIS_LENSES]).join(' | ')}\n\nRed lines: ${FAITH_CRISIS_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nCultural: ${env.sentinels.cultural.faith_context || 'unknown'}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('community_loss')) landmines.push('Community loss: this is social bereavement. The faith loss and the belonging loss are different wounds.');
  if (frameworks.includes('doubt_shame')) landmines.push('Doubt-shame: he may be telling Markos what he cannot tell his community. Honor the courage of the question.');
  landmines.push('NEUTRAL: No theological position. No proselytizing. No deconversion. Accompany the man, not the belief.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
