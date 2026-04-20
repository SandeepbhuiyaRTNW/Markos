/**
 * Grief Whisperer — Tier 4, §8
 * Running agent for the grief arena. Integrates:
 *   - Neimeyer: Presence/Process/Procedure, affect trail, retelling, continuing bonds
 *   - Worden: 4 Tasks of Mourning (Task 2 block is male-primary)
 *   - Rubin: Two-Track Model (functioning vs. relationship to deceased)
 *   - Cacciatore: Selah principle (Pause → Turn Toward → Turn Outward)
 *   - Kosminsky: Grief is not one emotion — it contains multitudes
 *
 * Markos is not a grief therapist. He is a grief WITNESS.
 * The empathic spirit is the intervention.
 */

import OpenAI from 'openai';
import type { StateEnvelope } from '../agents/state-envelope';
import { retrieveWhispererQuestions, retrieveTrainingContext, type WhispererResult } from './base-whisperer';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

/** Core grief frameworks from Neimeyer training doc */
const GRIEF_FRAMEWORKS = {
  presence: 'Be fully, undistracted, responsively available. No agenda. No destination. The man sets the pace.',
  affect_trail: 'Follow the emotion, not the topic. When the voice trembles on a word, STAY THERE. Privilege experience over explanation.',
  wordens_task2: 'Task 2 block: experiencing the pain. Men suppress, manage, move through pain — not INTO it. Create conditions where he can go into the pain.',
  two_track: 'Track I: daily functioning. Track II: relationship to deceased. A man may function fine (Track I) while the bond is frozen (Track II). Attend to both.',
  selah: 'PAUSE (create safety) → TURN TOWARD (approach the grief, name feelings) → TURN OUTWARD (what does this loss ask of him). Never rush Phase 3.',
  continuing_bonds: 'The deceased does not have to be "let go." The relationship transforms — from external presence to internal companionship.',
  event_vs_back_story: 'Event story: how they died. Back story: who they were, what they meant. Men often get stuck retelling the event story without entering the back story.',
  grief_not_depression: 'Grief: sadness focused on missing the person, waves, positive emotions possible. Depression: hopelessness about self/future, flat, persistent. Do NOT conflate.',
};

/** Male-specific grief intelligence */
const MALE_GRIEF_PATTERNS = {
  anger_as_grief: 'Male grief often presents as anger. Rage at the hospital, the driver, God, himself. The anger IS the grief — wearing a mask the man learned was acceptable.',
  instrumental_grief: 'Some men grieve through DOING — building a memorial, running a race, fixing something. This is valid grief, not avoidance. Honor it.',
  delayed_grief: 'Men may seem "fine" for weeks or months, then collapse. This is not pathological — it is the structure giving way once the emergency is over.',
  grief_in_the_body: 'Men often feel grief somatically: chest tightness, exhaustion, appetite loss, inability to sleep. The body grieves what the mouth cannot say.',
  permission_to_grieve: 'Many men have never been given explicit permission to grieve. Markos provides this not by saying "it\'s okay to grieve" but by treating his grief as matter-of-fact reality.',
};

/** Red lines — what the Grief Whisperer must NEVER do */
const GRIEF_RED_LINES = [
  'Never say "they\'re in a better place" or any spiritual platitude',
  'Never say "at least..." — there is no silver lining in active grief',
  'Never compare one loss to another ("at least you still have...")',
  'Never rush the man to Phase 3 (turning outward). That is months/years, not sessions.',
  'Never diagnose complicated grief or prolonged grief disorder',
  'Never suggest "moving on" or "letting go" — the bond transforms, it doesn\'t end',
  'Never treat instrumental grief (doing) as avoidance',
  'Never minimize: "it will get easier" — you don\'t know that, and it\'s not your promise to make',
];

/** Run the Grief Whisperer */
export async function runGriefWhisperer(env: StateEnvelope): Promise<WhispererResult> {
  const questionCandidates = await retrieveWhispererQuestions(env, 'grief', 5);
  const trainingContext = await retrieveTrainingContext(env.utterance, 'grief', 3);

  // Determine active frameworks
  const frameworks: string[] = [];
  const msg = env.utterance.toLowerCase();
  const silence = env.sentinels.listener_stack?.the_silence || '';

  // Detect which grief framework is most relevant
  if (/\b(angry|furious|rage|hate|pissed|how could)\b/i.test(msg)) {
    frameworks.push('anger_as_grief');
  }
  if (/\b(how (he|she|they) died|accident|hospital|found (him|her)|that day|that night)\b/i.test(msg)) {
    frameworks.push('event_vs_back_story');
  }
  if (/\b(remember when|used to|we would|favorite|laugh|smile|voice)\b/i.test(msg)) {
    frameworks.push('continuing_bonds');
  }
  if (/\b(fine|okay|handling it|keeping busy|staying strong|got through it)\b/i.test(msg)) {
    frameworks.push('wordens_task2');
  }
  if (/\b(chest|can't sleep|exhausted|can't eat|body|stomach|headache)\b/i.test(msg)) {
    frameworks.push('grief_in_the_body');
  }
  if (frameworks.length === 0) frameworks.push('presence', 'affect_trail');

  // LLM context notes
  let contextNotes = '';
  if (trainingContext) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are the Grief Whisperer intelligence layer for Markos. Given a grieving man's message and clinical training, produce 2-3 sentences of INTERNAL guidance for the Composer. What to attend to, where the affect trail leads, what NOT to do. Be precise. Never include anything the man would see.

Active frameworks: ${frameworks.map(f => {
  const all = { ...GRIEF_FRAMEWORKS, ...MALE_GRIEF_PATTERNS };
  return all[f as keyof typeof all] || f;
}).join(' | ')}

Red lines: ${GRIEF_RED_LINES.join('; ')}`
          },
          {
            role: 'user',
            content: `Man's message: "${env.utterance}"\nSilence: ${silence}\nPhase: ${env.assessment.phase.label}\nTraining:\n${trainingContext.substring(0, 1500)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 200,
      });
      contextNotes = response.choices[0].message.content || '';
    } catch { contextNotes = ''; }
  }

  // Grief-specific landmines
  const landmines: string[] = [];
  if (frameworks.includes('wordens_task2')) {
    landmines.push('Task 2 block: he is suppressing the pain. DO NOT push. Create conditions for contact — one gentle question, then wait.');
  }
  if (frameworks.includes('event_vs_back_story')) {
    landmines.push('He is in the event story (how they died). Eventually invite the back story (who they were). But not yet — let the event story complete first.');
  }
  if (env.assessment.silence_type?.label === 'grief') {
    landmines.push('Grief-silence detected. He needs WITNESS, not questions. Acknowledge what is present before probing deeper.');
  }
  landmines.push('NEVER offer platitudes. No "better place." No "at least." No "time heals."');

  return {
    question_candidates: questionCandidates,
    frameworks_applied: frameworks,
    landmines,
    context_notes: contextNotes,
  };
}

