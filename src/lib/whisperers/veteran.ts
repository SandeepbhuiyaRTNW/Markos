/**
 * Veteran Transition Whisperer — Tier 4, §4.11
 * Military-to-civilian identity transition, moral injury, warrior-king paradox, combat trauma.
 * Clinical gate: Yes — Kami + Paul Riedner.
 * Male veteran suicide rate 37.8/100K. Crisis Sentinel coordination elevated.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const VETERAN_LENSES = {
  identity_loss: 'The uniform gave him an identity, a tribe, a mission. Civilian life offers none of these. He is not depressed — he is unmade.',
  moral_injury: 'Moral injury: a wound to conscience, not fear. He did something, witnessed something, or failed to prevent something that violates his moral code. Distinct from PTSD.',
  warrior_king_paradox: 'The Warrior archetype served him in combat. In civilian life, the same intensity destroys relationships. The paradox: what kept him alive now keeps him isolated.',
  brotherhood_loss: 'Military brotherhood was the deepest belonging he has known. Civilian friendship feels shallow by comparison.',
  hypervigilance_as_love: 'His hypervigilance looks like control or anger to his family. To him, it IS love — he is protecting them. Help him see both truths.',
  mission_void: 'Without a mission, purpose collapses. The man without a mission is a warrior without a war — dangerous to himself.',
};

const VETERAN_RED_LINES = [
  'Never diagnose PTSD, TBI, or any clinical condition',
  'Never provide trauma therapy or exposure-based intervention',
  'Never say "thank you for your service" — he has heard it enough',
  'Never minimize combat experience or moral injury',
  'Never compare military service to civilian hardship',
  'Never frame hypervigilance or anger as purely pathological',
  'Never replace VA services, Vet Centers, or clinical treatment',
  'Crisis Sentinel coordination ELEVATED — 72% higher suicide risk than non-veterans',
];

export async function runVeteranWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'veteran', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'veteran', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(civilian|adjust|transition|dd[\s-]?214|after.*service|got out|discharged)\b/i.test(msg)) frameworks.push('identity_loss');
  if (/\b(what i did|shouldn't have|haunts me|guilty|wrong|shouldn't.*alive|live with)\b/i.test(msg)) frameworks.push('moral_injury');
  if (/\b(anger|rage|can't turn.*off|always on edge|threat|scanning|hypervigilant)\b/i.test(msg)) frameworks.push('warrior_king_paradox');
  if (/\b(brothers|unit|squad|team|platoon|miss.*guys|nobody.*understands)\b/i.test(msg)) frameworks.push('brotherhood_loss');
  if (/\b(protect|watch|can't relax|control|checking|perimeter|safe)\b/i.test(msg)) frameworks.push('hypervigilance_as_love');
  if (/\b(purpose|mission|point|what now|nothing matters|drift|waste)\b/i.test(msg)) frameworks.push('mission_void');
  if (frameworks.length === 0) frameworks.push('identity_loss');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Veteran Transition Whisperer for Markos. Clinical gate: Kami + Paul Riedner. Produce 2-3 sentences of INTERNAL guidance. Elevated crisis awareness.\n\nActive frameworks: ${frameworks.map(f => VETERAN_LENSES[f as keyof typeof VETERAN_LENSES]).join(' | ')}\n\nRed lines: ${VETERAN_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('moral_injury')) landmines.push('Moral injury: this is a wound to conscience, not fear. Do NOT treat as PTSD. Witness without absolution or condemnation.');
  if (frameworks.includes('warrior_king_paradox')) landmines.push('Warrior-King paradox: the intensity that served him now isolates him. Help him see both truths — it was real AND it is costing him.');
  landmines.push('ELEVATED CRISIS AWARENESS: veteran suicide rate 37.8/100K. Monitor closely.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
