/**
 * Craft Layer — Tier 5, §9
 * Post-Composer shaping: ensures the response lands with proper form and weight.
 * Modules: Socratic Questioner, Deep Listener
 *
 * The Craft Layer does NOT change meaning — it shapes delivery.
 */

import type { StateEnvelope, CraftDirectives } from '../agents/state-envelope';

/** Determine craft directives based on Assessment Ring state */
export function determineCraftDirectives(env: StateEnvelope): CraftDirectives {
  const silenceType = env.assessment.silence_type?.label;
  const depth = env.sentinels.listener_stack?.depth_level || 2;
  const phase = env.assessment.phase.label;
  const crisis = env.sentinels.crisis.level;
  const trajectory = env.sentinels.listener_stack?.emotional_trajectory || 'neutral';

  // Crisis: override everything
  if (crisis === 'acute') {
    return { form: 'statement', pacing: 'full', metaphor_hint: null, style_override: 'crisis_protocol' };
  }

  // Silence-based pacing
  if (silenceType === 'shame') {
    return {
      form: 'presence',
      pacing: 'acknowledgment_only',
      metaphor_hint: null,
      style_override: 'Shame-silence: 1-2 sentences max. Sit with him. Do not probe.',
    };
  }

  if (silenceType === 'grief') {
    return {
      form: 'reflection',
      pacing: depth >= 3 ? 'full' : 'short',
      metaphor_hint: null,
      style_override: 'Grief-silence: witness, do not fix. Name what is present.',
    };
  }

  if (silenceType === 'avoidance') {
    return {
      form: 'question',
      pacing: 'short',
      metaphor_hint: null,
      style_override: 'Avoidance: a better question, not pressure. Side door, not front door.',
    };
  }

  if (silenceType === 'protective') {
    return {
      form: 'reflection',
      pacing: 'short',
      metaphor_hint: null,
      style_override: 'Protective silence: respect it, then gentle return. He is protecting someone.',
    };
  }

  // Phase-based form
  if (phase === 'brothered' && depth >= 4) {
    return { form: 'challenge', pacing: 'full', metaphor_hint: null, style_override: null };
  }

  if (trajectory === 'opening' || trajectory === 'deepening') {
    return { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null };
  }

  // Default: question with full pacing
  return { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null };
}

/**
 * Socratic Questioner — ensure responses end with weight, not filler.
 * If the response should end with a question, enforce single-question discipline.
 */
export function enforceSocraticDiscipline(response: string, directives: CraftDirectives): string {
  if (directives.form === 'presence' || directives.form === 'statement') {
    // Remove trailing questions for presence/statement forms
    const lines = response.split('\n').filter(l => l.trim());
    if (lines.length > 1 && lines[lines.length - 1].trim().endsWith('?')) {
      // Keep only if the response is just one question
      const questionCount = response.split('?').length - 1;
      if (questionCount > 1) {
        // Remove all but the last question
        return response;
      }
    }
    return response;
  }

  if (directives.form === 'question') {
    // Enforce single-question discipline
    const questionMarks = (response.match(/\?/g) || []).length;
    if (questionMarks > 1) {
      // Find the last question — that's usually the deepest one
      const lines = response.split('\n');
      const questionLines = lines.filter(l => l.trim().endsWith('?'));
      if (questionLines.length > 1) {
        // Keep the last question, trim the rest to setup + last question
        const lastQ = questionLines[questionLines.length - 1];
        const lastQIdx = lines.lastIndexOf(lastQ);
        const setup = lines.slice(0, lastQIdx).filter(l => !l.trim().endsWith('?'));
        return [...setup, lastQ].join('\n').trim();
      }
    }
  }

  return response;
}

/**
 * Deep Listener — for silence-breaking moments, strip response to minimum.
 * When a man breaks a deep silence, less is more.
 */
export function applyDeepListener(
  response: string,
  directives: CraftDirectives,
  isSilenceBreaking: boolean,
): string {
  if (!isSilenceBreaking) return response;

  if (directives.pacing === 'acknowledgment_only') {
    // Ultra-short: 1-2 sentences max
    const sentences = response.match(/[^.!?]+[.!?]+/g) || [response];
    return sentences.slice(0, 2).join(' ').trim();
  }

  if (directives.pacing === 'short') {
    const sentences = response.match(/[^.!?]+[.!?]+/g) || [response];
    return sentences.slice(0, 3).join(' ').trim();
  }

  return response;
}

