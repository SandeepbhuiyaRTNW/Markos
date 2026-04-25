/**
 * Work & Purpose Whisperer — Tier 4, §4.07
 * Identity collapse and reconstruction through work. Burnout, meaningful work, career transitions.
 * Common ENTRY arena — men often start here before emotional territory opens.
 * Gateway to other arenas via the Face-Saving Emotion Bridge.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

const WORK_LENSES = {
  identity_collapse: 'Work = identity for many men. When the job goes, the self goes. This is not about employment — it is about existence.',
  burnout: 'Burnout is not tiredness. It is the collapse of meaning. The man keeps performing because he has no other script.',
  purpose_void: 'He is asking "what is all this for?" The Existentialist voice in Tier 3 leans in here. Do not answer — deepen the question.',
  career_transition: 'Between identities. The old role is gone; the new one is not yet formed. Liminal space. Tolerate ambiguity WITH him.',
  face_saving_bridge: 'Work is the safe entry point. The real wound may be elsewhere (marriage, loneliness, mortality). Let him start here; do not redirect prematurely.',
  provider_fracture: 'Provider identity collapsed. Money and fatherhood intersect here. The shame of not providing is primal.',
};

const WORK_RED_LINES = [
  'Never give career advice, job search tips, or networking strategies',
  'Never diagnose burnout as a clinical condition',
  'Never rush past work into "the real issue" — work IS real to him',
  'Never minimize his career concern as "just a job"',
  'Never prescribe purpose or meaning — he discovers it',
  'Never compare his situation to others\' success',
];

export async function runWorkWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'work', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'work', 3);

  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();

  if (/\b(fired|laid off|let go|lost my job|unemploy|downsized|terminated)\b/i.test(msg)) frameworks.push('identity_collapse');
  if (/\b(burnout|burned out|exhausted|can't keep|grinding|running on empty|no energy)\b/i.test(msg)) frameworks.push('burnout');
  if (/\b(what's the point|purpose|meaning|why am i|what am i doing|pointless|empty)\b/i.test(msg)) frameworks.push('purpose_void');
  if (/\b(career change|new job|starting over|transition|next chapter|reinvent|pivot)\b/i.test(msg)) frameworks.push('career_transition');
  if (/\b(provid|breadwinner|support|pay|can't afford|failing.*family)\b/i.test(msg)) frameworks.push('provider_fracture');
  if (frameworks.length === 0) frameworks.push('face_saving_bridge');

  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are the Work & Purpose Whisperer for Markos. This is often the ENTRY arena. Produce 2-3 sentences of INTERNAL guidance. Watch for the Face-Saving Bridge — the real wound may be elsewhere.\n\nActive frameworks: ${frameworks.map(f => WORK_LENSES[f as keyof typeof WORK_LENSES]).join(' | ')}\n\nRed lines: ${WORK_RED_LINES.join('; ')}` },
          { role: 'user', content: `Man's message: "${env.utterance}"\nSilence: ${env.sentinels.listener_stack?.the_silence || ''}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}` }
        ],
        temperature: 0.3, max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  const landmines: string[] = [];
  if (frameworks.includes('identity_collapse')) landmines.push('Job loss = identity loss. He is not grieving a paycheck; he is grieving a self. Witness the man, not the career.');
  if (frameworks.includes('face_saving_bridge')) landmines.push('Face-saving bridge: work may be the safe topic. Let him start here. Other arenas may emerge naturally.');
  if (frameworks.includes('burnout')) landmines.push('Burnout: do NOT prescribe rest or self-care. Ask what keeps him performing when the meaning is gone.');

  return { question_candidates: questionCandidates, frameworks_applied: frameworks, landmines, context_notes: contextNotes };
}
