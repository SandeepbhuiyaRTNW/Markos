/**
 * Health & Body Whisperer — Tier 4, §4.09
 * Physical health, chronic pain, weight, aging body, diagnosis shock.
 * Clinical gate: Yes — Kami. Boundary Sentinel coordination around medical advice.
 * Layer 5 somatic-substitution often surfaces here.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const HEALTH_LENSES = {
  diagnosis_shock: 'A new diagnosis. The man is in shock. He needs to process what this means for his identity before he can act. Do not rush to "what now."',
  chronic_pain: 'Chronic pain reshapes identity. He cannot do what he once did. The grief is for the capable self he was.',
  somatic_substitution: 'The body is carrying what the mouth will not say. Chest tightness, insomnia, weight gain may be grief, shame, or stress in disguise.',
  aging_body: 'The aging body forces mortality awareness. Strength, speed, stamina — the metrics by which he measured himself — are declining.',
  body_shame: 'Weight, appearance, disability. The body he inhabits does not match the body he believes he should have.',
  invincibility_collapse: 'He believed his body would not fail. It did. The shock is not the condition — it is the myth that shattered.',
};

const HEALTH_RED_LINES = [
  'Never give medical advice, treatment suggestions, or health recommendations',
  'Never prescribe exercise, diet, or wellness routines',
  'Never diagnose any medical or psychological condition',
  'Never minimize a health concern ("it\'s probably nothing")',
  'Never encourage ignoring medical professionals',
  'Never provide nutrition or supplement guidance',
  'Anti-pattern: precise nutrition/exercise guidance to men showing disordered-eating signals',
];

export async function runHealthWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'health', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'health', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(diagnos|found out|test results|doctor said|told me i have|biopsy|scan)\b/i.test(msg)) frameworks.push('diagnosis_shock');
  if (/\b(chronic|always hurts|pain every|fibro|back pain|migraines|can't move|disability)\b/i.test(msg)) frameworks.push('chronic_pain');
  if (/\b(can't sleep|chest|stomach|headache|exhausted|body aches|tense|clenching)\b/i.test(msg)) frameworks.push('somatic_substitution');
  if (/\b(getting old|used to (be|run|lift)|can't do what|slower|weaker|decline)\b/i.test(msg)) frameworks.push('aging_body');
  if (/\b(fat|overweight|ugly|out of shape|hate my body|mirror|disgusted)\b/i.test(msg)) frameworks.push('body_shame');
  if (/\b(never thought|invincible|always healthy|first time|shocked|can't believe)\b/i.test(msg)) frameworks.push('invincibility_collapse');
  if (frameworks.length === 0) frameworks.push('somatic_substitution');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Health & Body Whisperer for Markos. Clinical gate active. Produce 2-3 sentences of INTERNAL guidance. Watch for somatic substitution — the body may carry what the mouth won't say.\n\nActive frameworks: ${frameworks.map(f => HEALTH_LENSES[f as keyof typeof HEALTH_LENSES]).join(' | ')}\n\nRed lines: ${HEALTH_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('diagnosis_shock')) landmines.push('Diagnosis shock: he needs to process identity impact, not medical facts. Ask what changed when he heard the words.');
  if (frameworks.includes('somatic_substitution')) landmines.push('Somatic substitution: the body carries the unspoken. Gently explore what the body might be saying.');
  landmines.push('BOUNDARY: Markos gives ZERO medical advice. Explore the man\'s experience of his body, not the condition.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
