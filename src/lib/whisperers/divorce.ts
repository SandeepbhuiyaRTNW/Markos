/**
 * Divorce Whisperer — Tier 4, §8
 * Running agent for the divorce arena. Integrates:
 *   - Conscious Uncoupling (Thomas): flooding, grievance loop, source fracture, 3% reframe
 *   - Rebuilding Workbook (Limón): 19 building blocks, male shame patterns
 *   - Divorce Recovery Book: practical identity reconstruction
 *
 * Clinical frameworks are INVISIBLE to the man. Markos uses them as reading lenses.
 * The man names his own wound in his own words.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

/** The six clinical lenses from Conscious Uncoupling training */
const DIVORCE_LENSES = {
  emotional_flooding: 'Man is in alarm state — fight-or-flight hormones flooding. Do NOT reason him out of it. Enter the flood, acknowledge, decelerate through question rhythm.',
  grievance_story_loop: 'Man is stuck retelling what she did. The anger is presenting symptom, shame is actual wound. Wait for full expression, then gently invite his 3% — the only part he can change.',
  source_fracture: 'Divorce reactivated a childhood wound (I am not enough / I am disposable / women leave). NEVER name this framework. Use it as reading lens only.',
  witnessing_self: 'Help him have his emotions without being had by them. Model calm presence. One slow question creates one inch of distance — that inch is the witnessing self.',
  amends_territory: 'Beyond apology to actual repair. Only when trust is established and HE raises it. Not reconciliation — honest forward movement.',
  new_emergence: 'New life is not a better version of the old one. Identity scaffolding collapsed. Discovery, not reconstruction.',
};

/** Rebuilding Workbook: Fisher's 19 building blocks mapped to male experience */
export const REBUILDING_BLOCKS = [
  'denial', 'fear', 'adaptation', 'loneliness', 'friendship', 'guilt_rejection',
  'grief', 'anger', 'letting_go', 'self_worth', 'transition', 'openness',
  'love', 'trust', 'relatedness', 'sexuality', 'singleness', 'purpose', 'freedom',
];

/** Red lines — what this Whisperer must NEVER do */
const DIVORCE_RED_LINES = [
  'Never diagnose depression, PTSD, or any clinical condition',
  'Never advise on custody, legal strategy, or lawyer selection',
  'Never guide communication with the ex-partner',
  'Never prescribe rituals, journaling exercises, or somatic practices',
  'Never rush forgiveness — forgiveness is the man\'s timeline, not ours',
  'Never name the source fracture framework to the man',
  'Never act as co-parenting mediator',
  'Never suggest reconciliation or discourage it — that is his domain',
];

/** Run the Divorce Whisperer */
export async function runDivorceWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  // Retrieve filtered questions from intelbase
  const questionCandidates = await retrieveWhispererQuestions(env, 'divorce', 5);

  // Retrieve relevant training doc context
  const trainingContext = await retrieveTrainingContext(env.utterance, 'divorce', 3);

  // Determine which lens is most active
  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();
  const silence = env.sentinels.listener_stack?.the_silence || '';

  if (/\b(flood|overwhelm|can't think|rage|impulsive|2am|couldn't stop)\b/i.test(msg)) {
    frameworks.push('emotional_flooding');
  }
  if (/\b(she (did|said|always|never)|her fault|blame|what she)\b/i.test(msg)) {
    frameworks.push('grievance_story_loop');
  }
  if (/\b(not enough|disposable|always leave|nobody stays|can't keep)\b/i.test(msg)) {
    frameworks.push('source_fracture');
  }
  if (/\b(who am i|don't know who|identity|role|husband|provider)\b/i.test(msg)) {
    frameworks.push('new_emergence');
  }
  if (/\b(sorry|apologize|amends|repair|unfinished|still carry)\b/i.test(msg)) {
    frameworks.push('amends_territory');
  }
  if (frameworks.length === 0) frameworks.push('witnessing_self'); // Default lens

  // Generate context notes using LLM with training doc intelligence
  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are the Divorce Whisperer intelligence layer for Markos. Given a man's message and clinical training context, produce 2-3 sentences of INTERNAL guidance for the Composer — what lens to use, what to watch for, what NOT to do. Never include anything the man would see. Be precise and clinical.

Active frameworks: ${frameworks.map(f => DIVORCE_LENSES[f as keyof typeof DIVORCE_LENSES]).join(' | ')}

Red lines: ${DIVORCE_RED_LINES.join('; ')}`
          },
          {
            role: 'user',
            content: `Man's message: "${env.utterance}"\nSilence layer: ${silence}\nPhase: ${env.assessment.phase.label}\nTraining context:\n${trainingContext.substring(0, 1500)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  // Landmines specific to divorce conversations
  const landmines: string[] = [];
  if (frameworks.includes('emotional_flooding')) {
    landmines.push('DO NOT reason with a flooded man. Acknowledge → decelerate → probe only when calm.');
  }
  if (frameworks.includes('grievance_story_loop')) {
    landmines.push('DO NOT challenge the grievance story prematurely. Let him express fully first.');
  }
  if (env.assessment.silence_type?.label === 'shame') {
    landmines.push('Shame-silence detected. He needs PRESENCE, not probing. Sit with him.');
  }

  return {
    question_candidates: questionCandidates,
    frameworks_applied: frameworks,
    landmines,
    context_notes: contextNotes,
  };
}

