/**
 * Arena Classifier — Tier 2, §6.7
 * Maps conversation to one or more of 14 life arenas with weighted vector.
 * Multi-arena conversations are common; returns weights, not a single label.
 */

import OpenAI from 'openai';
import type { ArenaOutput, ArenaWeights } from '../agents/state-envelope';

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** The 14 life arenas per the architecture spec §8 */
export const ARENAS = [
  'divorce', 'grief', 'addiction', 'love', 'sex', 'fatherhood',
  'fatherless_son', 'work', 'money', 'health', 'friendship',
  'veteran', 'midlife', 'faith_crisis',
] as const;

export type Arena = typeof ARENAS[number];

/** Fast keyword-based pre-classifier for common arenas */
function keywordPreClassify(message: string): ArenaWeights {
  const msg = message.toLowerCase();
  const weights: ArenaWeights = {};

  const patterns: [Arena, RegExp[]][] = [
    ['divorce', [/\b(divorce|separated|ex[\s-]?wife|ex[\s-]?husband|custody|alimony|co[\s-]?parent|split\s*up|marriage\s*(ended|over|done))\b/i]],
    ['grief', [/\b(died|death|funeral|grief|griev|loss|passed\s*(away)?|mourning|burial|widow|miscarriage|stillborn)\b/i]],
    ['addiction', [/\b(addict|drinking|drunk|sober|sobriety|relapse|aa\b|na\b|recovery|substance|pills|cocaine|heroin|meth|weed|porn\s*(addict|habit))\b/i]],
    ['love', [/\b(girlfriend|boyfriend|wife|husband|partner|relationship|dating|breakup|broken\s*heart|love|romantic|she\s*(left|cheated)|he\s*(left|cheated))\b/i]],
    ['sex', [/\b(sex|intimacy|desire|performance|erectile|libido|porn|mismatch|bedroom)\b/i]],
    ['fatherhood', [/\b(father|dad|my\s*(son|daughter|kid|child)|parenting|custody|stepdad|stepfather)\b/i]],
    ['fatherless_son', [/\b(absent\s*father|my\s*(dad|father)\s*(left|wasn't|never|died|abandoned|abusive)|grew\s*up\s*without\s*(a\s*)?dad|fatherless)\b/i]],
    ['work', [/\b(job|career|boss|fired|laid\s*off|burnout|promotion|purpose|unemployment|work|office|company|business)\b/i]],
    ['money', [/\b(money|broke|debt|bankrupt|financial|bills|rent|mortgage|provide|provision)\b/i]],
    ['health', [/\b(diagnosis|cancer|chronic|pain|surgery|hospital|doctor|aging|body|weight|health|disability)\b/i]],
    ['friendship', [/\b(friend|lonely|loneliness|isolated|no\s*one|alone|brotherhood|buddies|mates)\b/i]],
    ['veteran', [/\b(veteran|military|deployed|combat|service|army|navy|marines|air\s*force|ptsd|moral\s*injury|dd[\s-]?214)\b/i]],
    ['midlife', [/\b(midlife|turning\s*(40|50|60)|half[\s-]?way|legacy|mortality|getting\s*old|aging|crisis)\b/i]],
    ['faith_crisis', [/\b(faith|god|pray|church|doubt|belief|spiritual|religion|lost\s*(my\s*)?faith|deconstruct)\b/i]],
  ];

  for (const [arena, regexes] of patterns) {
    for (const regex of regexes) {
      if (regex.test(msg)) {
        weights[arena] = (weights[arena] || 0) + 0.3;
      }
    }
  }

  return weights;
}

/** Run the Arena Classifier — LLM-based with keyword boost */
export async function classifyArena(
  message: string,
  conversationHistory: string,
  memoryContext: string,
): Promise<ArenaOutput> {
  // Stage 1: keyword pre-classification
  const keywordWeights = keywordPreClassify(message);

  // Stage 2: LLM classification
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You classify a man's message into life arenas. Return JSON with weights 0-1 for ONLY the relevant arenas (skip arenas with 0 weight).

Arenas: ${ARENAS.join(', ')}

Return: { "weights": { "arena_name": 0.0-1.0, ... }, "primary": "strongest_arena" }

Rules:
- Multi-arena is common: a man talking about divorce often also touches love, fatherhood, money
- Return weights for all arenas that are present, even weakly
- Primary is the arena with highest weight
- If truly unclear, return { "weights": { "work": 0.3 }, "primary": "work" } as default`
        },
        {
          role: 'user',
          content: `Message: "${message}"\nHistory: ${conversationHistory.substring(0, 500)}\nMemory: ${memoryContext.substring(0, 300)}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const llmWeights: ArenaWeights = parsed.weights || {};

    // Merge: keyword + LLM, capped at 1.0
    const merged: ArenaWeights = { ...keywordWeights };
    for (const [arena, weight] of Object.entries(llmWeights)) {
      merged[arena] = Math.min(1, (merged[arena] || 0) + (weight as number));
    }

    // Normalize so highest is 1.0
    const maxWeight = Math.max(...Object.values(merged), 0.1);
    for (const key of Object.keys(merged)) {
      merged[key] = Math.round((merged[key] / maxWeight) * 100) / 100;
    }

    const primary = parsed.primary || Object.entries(merged).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work';
    return { weights: merged, primary };
  } catch {
    // Fallback to keyword-only
    const primary = Object.entries(keywordWeights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work';
    return { weights: keywordWeights, primary };
  }
}

