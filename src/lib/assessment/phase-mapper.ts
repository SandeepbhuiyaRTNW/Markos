/**
 * Phase Mapper — Tier 2, §6.1
 * Identifies whether the man is in Unsilenced, Unleashed, or Brothered.
 * Phase determines question depth and Whisperer modality availability.
 *
 * Unsilenced — He is beginning to say what he hasn't said. Breaking the initial silence.
 * Unleashed — He is exploring, deepening, confronting patterns. Active growth.
 * Brothered — He is integrating, mentoring, connecting. Walking the path.
 */

import type { PhaseOutput, Phase } from '../agents/state-envelope';

/**
 * Map phase from session context.
 * Phase is per-user-journey (not per-conversation).
 */
export function mapPhase(
  sessionCount: number,
  depthLevel: number,
  emotionalTrajectory: string,
  trustCognitive: number,
  trustAffective: number,
): PhaseOutput {
  // Brothered: deep trust, high depth, many sessions
  if (sessionCount >= 20 && trustAffective >= 0.7 && depthLevel >= 3) {
    return { label: 'brothered', confidence: 0.8 };
  }

  // Unleashed: moderate trust established, willing to go deep
  if (
    (sessionCount >= 5 && trustCognitive >= 0.5 && depthLevel >= 2) ||
    (sessionCount >= 8 && trustAffective >= 0.4) ||
    (depthLevel >= 3 && emotionalTrajectory === 'opening')
  ) {
    const confidence = Math.min(0.9,
      0.4 + (sessionCount >= 10 ? 0.2 : 0) + (depthLevel >= 3 ? 0.15 : 0) + (trustAffective >= 0.5 ? 0.15 : 0)
    );
    return { label: 'unleashed', confidence };
  }

  // Unsilenced: default for most V1 users
  const confidence = sessionCount <= 2 ? 0.9 : Math.max(0.5, 0.9 - sessionCount * 0.03);
  return { label: 'unsilenced', confidence };
}

/**
 * Get phase-appropriate response constraints.
 * Used by the Composer to calibrate depth and directness.
 */
export function getPhaseConstraints(phase: Phase): {
  max_depth: number;
  can_challenge: boolean;
  can_suggest: boolean;
  question_style: string;
} {
  switch (phase) {
    case 'unsilenced':
      return {
        max_depth: 3,
        can_challenge: false,
        can_suggest: false,
        question_style: 'open, inviting, low-pressure — earn the right to go deeper',
      };
    case 'unleashed':
      return {
        max_depth: 4,
        can_challenge: true,
        can_suggest: false,
        question_style: 'direct, pattern-naming, permission to confront',
      };
    case 'brothered':
      return {
        max_depth: 5,
        can_challenge: true,
        can_suggest: true,
        question_style: 'peer, mutual, identity-level — walking alongside',
      };
  }
}

