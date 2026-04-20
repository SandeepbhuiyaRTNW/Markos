/**
 * Wisdom Council — Tier 3, §7
 * Selects which philosophical voice(s) lean into the conversation.
 * Currently 5 voices; each activated by Assessment Ring state.
 * The man never sees voice names — they manifest as tonal shifts in the Composer.
 */

import type { StateEnvelope, WisdomCouncilOutput } from '../agents/state-envelope';

/** Wisdom voice definitions — what each voice brings */
export const WISDOM_VOICES: Record<string, {
  name: string;
  when: string;
  tone: string;
  sources: string[];
}> = {
  stoic: {
    name: 'Stoic',
    when: 'When the man needs agency, control over what is his, the inner citadel',
    tone: 'Direct, unflinching, duty-bound. "What is in your control right now?"',
    sources: ['Meditations - Marcus Aurelius', 'Letters from a Stoic - Seneca', 'Discourses - Epictetus'],
  },
  existentialist: {
    name: 'Existentialist',
    when: 'When the man is searching for meaning in suffering, asking "why"',
    tone: 'Grave, purposeful. Suffering has meaning if you choose to find it.',
    sources: ["Man's Search for Meaning - Viktor Frankl"],
  },
  socratic: {
    name: 'Socratic',
    when: 'When the man needs to examine his own assumptions, when he is stuck in a loop',
    tone: 'Curious, probing, respectful. Questions that make him think, not feel attacked.',
    sources: ['Socratic method — question-led discovery'],
  },
  positive_psychology: {
    name: 'Positive Psychology',
    when: 'When the man has stabilized and can look forward, when strengths need naming',
    tone: 'Warm but not soft. Strengths-based. "What worked? What is still strong?"',
    sources: ['Flourish - Martin Seligman', 'Learned Optimism - Martin Seligman', 'Flow - Mihaly Csikszentmihalyi'],
  },
  moral_philosophy: {
    name: 'Moral Philosophy',
    when: 'When the man faces an ethical dilemma, a decision about right and wrong',
    tone: 'Principled but not preachy. "What does the man you want to be do here?"',
    sources: ['Nicomachean Ethics - Aristotle', 'Groundwork - Kant (simplified)'],
  },
};

/** Select which wisdom voices should lean in based on Assessment Ring state */
export function selectWisdomVoices(env: StateEnvelope): WisdomCouncilOutput {
  const invoked: string[] = [];
  const phase = env.assessment.phase.label;
  const silenceType = env.assessment.silence_type?.label;
  const arena = env.assessment.arena?.primary;
  const archetype = env.assessment.archetype?.active;
  const depth = env.sentinels.listener_stack?.depth_level || 2;
  const msg = env.utterance.toLowerCase();

  // Stoic: default voice, always at least a whisper
  // Stronger when: agency questions, control, duty, discipline, anger
  if (/\b(what (can|should|do) i (do|control)|my fault|responsibility|discipline|duty)\b/i.test(msg)
    || archetype === 'king' || archetype === 'warrior') {
    invoked.push('stoic');
  }

  // Existentialist: meaning, suffering, "why", grief, loss
  if (/\b(why|meaning|purpose|point|suffering|what'?s it (all )?for)\b/i.test(msg)
    || arena === 'grief' || silenceType === 'grief') {
    invoked.push('existentialist');
  }

  // Socratic: loops, assumptions, stuck patterns, avoidance
  if (silenceType === 'avoidance'
    || /\b(always|never|every time|she always|i always)\b/i.test(msg)
    || phase === 'unleashed') {
    invoked.push('socratic');
  }

  // Positive Psychology: stabilized, forward-looking, strengths
  if (phase === 'brothered'
    || /\b(what('?s| is) (working|good|right|strong)|strengths?|grateful|growth)\b/i.test(msg)
    || depth >= 4) {
    invoked.push('positive_psychology');
  }

  // Moral Philosophy: ethical dilemmas, decisions
  if (/\b(right thing|should i|wrong|fair|honest|integrity|moral|ethical|truth)\b/i.test(msg)) {
    invoked.push('moral_philosophy');
  }

  // If nothing matched, default to stoic
  if (invoked.length === 0) invoked.push('stoic');

  // Cap at 2 voices per turn (focus, not cacophony)
  return { invoked: invoked.slice(0, 2) };
}

/** Build Wisdom Council prompt section for the Composer */
export function buildWisdomCouncilPrompt(voices: WisdomCouncilOutput): string {
  if (voices.invoked.length === 0) return '';
  const parts = voices.invoked.map(v => {
    const voice = WISDOM_VOICES[v];
    if (!voice) return '';
    return `${voice.name}: ${voice.tone}`;
  }).filter(Boolean);
  return `## WISDOM COUNCIL — LEAN INTO:\n${parts.join('\n')}`;
}

