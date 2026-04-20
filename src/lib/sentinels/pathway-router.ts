/**
 * Pathway Router — Tier 1, §5.4
 * Identifies bridging opportunities to therapy, men's circles, partner orgs.
 * Pro-all-pathways: never competes with external resources.
 */

import type { PathwayRouterOutput, PathwayCandidate, StateEnvelope } from '../agents/state-envelope';

/** Core bridging pathways by category */
const PATHWAY_DEFINITIONS: Array<{
  target: string;
  description: string;
  triggers: RegExp[];
  category: string;
  min_sessions: number;
}> = [
  {
    target: 'therapy',
    description: 'A therapist or counselor can reach places I can\'t — that\'s not weakness, that\'s knowing when to call in reinforcements.',
    triggers: [
      /\b(depressed|depression|anxiety|panic\s*attack|medication|meds|therapist|counselor|diagnosis)\b/i,
      /\b(can'?t\s*(stop|sleep|eat|function)|trauma|ptsd|flashback)\b/i,
    ],
    category: 'clinical',
    min_sessions: 2,
  },
  {
    target: 'mens_circle',
    description: 'A men\'s circle — real men, face to face, no script. Different from what I can give you.',
    triggers: [
      /\b(lonely|no\s*friends|no\s*one\s*to\s*talk\s*to|isolated|alone)\b/i,
      /\b(other\s*men|other\s*guys|brotherhood|community)\b/i,
    ],
    category: 'mens_circles',
    min_sessions: 3,
  },
  {
    target: 'crisis_line',
    description: '988 Suicide & Crisis Lifeline — call or text 988, anytime.',
    triggers: [], // Handled by Crisis Sentinel, not here
    category: 'crisis',
    min_sessions: 0,
  },
  {
    target: 'veterans_support',
    description: 'Veterans Crisis Line: 988, press 1. Or text 838255. They understand service in a way civilians don\'t.',
    triggers: [
      /\b(veteran|military|deployed|combat|service|army|navy|marines|air\s*force|coast\s*guard|national\s*guard)\b/i,
      /\b(dd-?214|discharge|mos|ptsd|va\b|moral\s*injury)\b/i,
    ],
    category: 'veterans',
    min_sessions: 2,
  },
  {
    target: 'recovery_program',
    description: 'AA, NA, SMART Recovery — whatever fits. Real rooms with real people who\'ve been where you are.',
    triggers: [
      /\b(drinking|drunk|alcohol|sober|sobriety|relapse|twelve\s*step|aa\b|na\b|recovery)\b/i,
      /\b(addict|addiction|substance|using|high|weed|cocaine|pills|opioid|heroin)\b/i,
    ],
    category: 'recovery',
    min_sessions: 2,
  },
  {
    target: 'divorce_support',
    description: 'A divorce support group — men who\'ve walked through the same fire. Not theory, experience.',
    triggers: [
      /\b(divorce|separated|ex[\s-]?wife|custody|alimony|co[\s-]?parent)\b/i,
    ],
    category: 'divorce_separation',
    min_sessions: 3,
  },
  {
    target: 'faith_community',
    description: 'Your faith community might have more for you than Sunday mornings. A pastor, a mentor, someone who knows your name.',
    triggers: [
      /\b(church|pray|prayer|god|faith|pastor|priest|imam|rabbi|spiritual|congregation)\b/i,
    ],
    category: 'faith',
    min_sessions: 4,
  },
];

/** Run the Pathway Router against the current state */
export function runPathwayRouter(env: StateEnvelope): PathwayRouterOutput {
  const message = env.utterance;
  const sessionCount = env.sentinels.memory.session_count;
  const candidates: PathwayCandidate[] = [];

  for (const pathway of PATHWAY_DEFINITIONS) {
    if (pathway.triggers.length === 0) continue; // Skip crisis line (handled by Crisis Sentinel)

    const triggered = pathway.triggers.some(p => p.test(message));
    if (!triggered) continue;

    const when: 'now' | 'later' | 'not_yet' =
      sessionCount >= pathway.min_sessions ? 'now'
      : sessionCount >= 1 ? 'later'
      : 'not_yet';

    candidates.push({
      target: pathway.target,
      description: pathway.description,
      when,
      confidence: triggered ? 0.7 : 0.3,
    });
  }

  // Boost confidence for arena matches
  if (env.assessment.arena) {
    for (const candidate of candidates) {
      if (candidate.target === 'divorce_support' && env.assessment.arena.weights['divorce'] > 0.3) {
        candidate.confidence = Math.min(1, candidate.confidence + 0.2);
      }
      if (candidate.target === 'recovery_program' && env.assessment.arena.weights['addiction'] > 0.3) {
        candidate.confidence = Math.min(1, candidate.confidence + 0.2);
      }
    }
  }

  return { candidates: candidates.sort((a, b) => b.confidence - a.confidence) };
}

