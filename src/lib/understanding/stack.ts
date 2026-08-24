import OpenAI from 'openai';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

export type TurnKind = 'problem_work' | 'emotional_disclosure' | 'mixed' | 'casual';

export interface UnderstandingAnalysis {
  layer1_words: string;          // What he literally said
  layer2_emotion: string;        // What he's feeling
  layer3_pattern: string;        // Recurring theme
  layer4_the_man: string;        // Identity/becoming
  // Silence fields are NULLABLE: when there is genuinely nothing hidden (a decision,
  // logistics, small talk) the analyzer returns null instead of inventing avoidance.
  layer5_the_silence: string | null;    // What's unsaid — THE DEPTH LEVER (or null)
  primary_emotion: string;
  depth_level: number;           // 1-5, how deep the conversation is
  depth_opportunity: string | null;     // Suggestion for going deeper (or null)
  silence_question: string | null;      // Question that cracks Layer 5 (or null)
  emotional_trajectory: string;  // Is he opening up, retreating, or flat?
  // turn_kind decides everything downstream: does he want the DECISION engaged, or to be
  // understood EMOTIONALLY? unfinished = he was cut off mid-thought.
  turn_kind: TurnKind;
  unfinished: boolean;
}

const TURN_KINDS: TurnKind[] = ['problem_work', 'emotional_disclosure', 'mixed', 'casual'];

/**
 * Coerce the model's turn_kind to the enum. Unknown/blank => 'emotional_disclosure' — the
 * SAFE default: treating a feeling as a feeling costs nothing, treating it as a problem
 * flattens him. NEVER default to problem_work.
 */
export function normalizeTurnKind(raw: unknown): TurnKind {
  const t = String(raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return (TURN_KINDS as string[]).includes(t) ? (t as TurnKind) : 'emotional_disclosure';
}

/**
 * Deterministic high-precision backstop for `unfinished`: a message that ends on a dangling
 * continuation word ("we need to figure out", "and then", a trailing "to/because/with") or a
 * hard em-dash cut. OR'd with the model's own read so an obvious cut-off is never missed.
 * Deliberately conservative (STT drops punctuation, so we do NOT flag on trailing pronouns).
 */
export function looksUnfinished(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/[—–-]\s*$/.test(t)) return true; // ends on an em/en dash or hyphen
  if (/[.!?…]["')]?\s*$/.test(t)) return false; // clean terminal punctuation
  return /\b(to|and|or|but|so|because|with|for|of|about|than|need to|have to|want to|going to|trying to|figure out|thinking about|such as)\s*$/i.test(t);
}

/** Empty / "null" / "none" -> null, so blank silence never reads as a hidden thing. */
export function nullifyEmpty(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(null|none|n\/a|nothing|too early to tell)$/i.test(s)) return null;
  return s;
}

/**
 * Normalize the model's free-text trajectory ("OPENING — he is...") into a
 * canonical lowercase enum so downstream phase/craft comparisons match reliably.
 */
function normalizeTrajectory(raw: string): 'opening' | 'retreating' | 'flat' {
  const t = (raw || '').toLowerCase();
  if (t.includes('open') || t.includes('deepen')) return 'opening';
  if (t.includes('retreat') || t.includes('guard') || t.includes('pull') || t.includes('withdraw')) return 'retreating';
  return 'flat';
}

export async function analyzeUnderstanding(
  userMessage: string,
  conversationHistory: string,
  memoryContext: string
): Promise<UnderstandingAnalysis> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are analyzing a man's message for a Stoic AI companion. Your analysis DIRECTLY shapes the depth and quality of the response. Be specific and actionable — not generic.

Return JSON:
{
  "layer1_words": "What he literally said — key facts, events, names mentioned",
  "layer2_emotion": "The emotion UNDERNEATH the words. Not what he claims to feel — what he IS feeling. Look for: anger masking hurt, humor masking pain, confidence masking fear, busyness masking avoidance",
  "layer3_pattern": "Recurring theme across this conversation and known history. Examples: 'avoidance of vulnerability', 'seeking permission he already has', 'deflecting through humor', 'caretaking others to avoid facing himself'. Say 'none yet' only if truly first message",
  "layer4_the_man": "What this reveals about his IDENTITY journey. Who was he? Who is he now? Who is he becoming or resisting becoming? This is not a summary — it is an insight about his self-concept",
  "layer5_the_silence": "What is he NOT saying that MATTERS — a topic skipped, a person unmentioned, an emotion avoided. Be SPECIFIC when it is real: 'He describes the loss but never uses the word grief'. Return null when there is genuinely nothing hidden — a decision, logistics, or small talk has NO silence, and inventing one is a failure. Only fill this when there is real evidence of avoidance; when in doubt, null.",
  "turn_kind": "THE SINGLE MOST IMPORTANT FIELD — it decides how he gets answered. One of: 'problem_work' — he is thinking through a DECISION, plan, or logistics: weighing named options, comparing paths, working out what to DO about an external situation (signals: options/forks he named, 'should I / whether to / trying to figure out / X vs Y', concrete details like dates, money, places, steps, a question about what to do). He wants the PROBLEM engaged, not his feelings read. 'emotional_disclosure' — he is sharing a FEELING or inner state: pain, grief, shame, fear, loneliness, a memory that hurts, something vulnerable. He wants to be understood. This is the DEFAULT whenever real emotion is what he brought. 'mixed' — a real decision AND real emotional weight, framed AS a decision (e.g. whether to lend money to a brother who never repaid: the choice is real, the resentment is real). 'casual' — small talk, a quick update, banter, logistics with no weight and no decision. CLASSIFY CONSERVATIVELY TOWARD EMOTION: use 'problem_work' ONLY when he is clearly working a decision and NOT asking to be understood. When a decision carries heavy emotion he has not subordinated to it (e.g. planning a funeral while grieving), choose 'emotional_disclosure' or 'mixed', never 'problem_work'. Mislabeling a hurting man as problem_work is the worst failure — bias to emotion when unsure.",
  "unfinished": "true ONLY if his message is cut off mid-thought — it ends before the sentence finished (trailing 'we need to figure out', 'and then I', a dangling 'to/and/because', an em-dash). false for any complete thought, however short. When true he should be invited to finish it, not answered.",
  "primary_emotion": "One word — the dominant emotion",
  "depth_level": "1-5 scale, rated by the EMOTIONAL WEIGHT this man brings in THIS message — NOT by how many exchanges have happened. 1=surface facts/logistics, 2=acknowledging feelings, 3=exploring patterns, 4=identity questioning, 5=confronting core truth. A man who opens with raw pain — a divorce, a death, suicidal weight, a shame he has never spoken — is at 4-5 even on his FIRST message. He has gone deep voluntarily. Do NOT rate a heavy message as 1-2 just because it is early in the conversation.",
  "depth_opportunity": "A specific, actionable move to go DEEPER — 'He used anger 3 times but never named what it protects. Ask what is underneath it.' Return null when there is no deeper opening: problem_work and casual turns get null. Do NOT manufacture a depth move for a man who is solving a problem.",
  "silence_question": "ONE specific question that would crack open Layer 5 — the question he is NOT asking himself. Return null when there is no silence to crack (problem_work, casual, or no real avoidance). NEVER invent one to fill the field.",
  "emotional_trajectory": "Is he OPENING (becoming more vulnerable/honest), RETREATING (pulling back, getting more guarded), or FLAT (staying at same level)? Look at the conversation arc. If there is no prior arc (first message), judge by THIS message: a man who brings vulnerability or raw emotion — even in his first words — is OPENING, not FLAT. Reserve FLAT for genuinely surface/logistical messages with no emotional weight."
}

CRITICAL RULES:
- turn_kind is the field that matters most; get it right and bias to emotion when unsure (see its instruction).
- NULL IS REQUIRED, not just allowed: on problem_work and casual turns, layer5_the_silence, depth_opportunity and silence_question must be null. Inventing a hidden feeling for a man who is working a decision or making small talk is THE failure this analysis exists to prevent. Only surface a silence when there is real evidence of avoidance.
- When Layer 5 IS real, it must be SPECIFIC to this man, not generic. "He might be avoiding deeper feelings" is USELESS. "He described his wife's threats but never mentioned whether he still loves her" is ACTIONABLE.
- depth_opportunity must be a CONCRETE move the companion can make, not a platitude — or null.
- silence_question must be a question that would make this specific man pause and think — or null.
- If the conversation has been surface-level for multiple exchanges, say so explicitly in depth_opportunity.
- PRESENTED DEPTH OVERRIDES TIMING: rate depth_level and trajectory by what the man actually brings, not by session position. Meeting a man at the depth he brought is the analysis's job — under-rating a heavy message produces a shallow, careful response that loses him.`
      },
      {
        role: 'user',
        content: `Message: "${userMessage}"\n\nConversation so far: ${conversationHistory}\n\nKnown about this man: ${memoryContext}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0].message.content || '{}';
  const parsed = JSON.parse(content);

  return {
    layer1_words: parsed.layer1_words || userMessage,
    layer2_emotion: parsed.layer2_emotion || 'unknown',
    layer3_pattern: parsed.layer3_pattern || 'none yet',
    layer4_the_man: parsed.layer4_the_man || 'still getting to know him',
    layer5_the_silence: nullifyEmpty(parsed.layer5_the_silence),
    primary_emotion: parsed.primary_emotion || 'neutral',
    depth_level: parsed.depth_level || 1,
    depth_opportunity: nullifyEmpty(parsed.depth_opportunity),
    silence_question: nullifyEmpty(parsed.silence_question),
    emotional_trajectory: normalizeTrajectory(parsed.emotional_trajectory),
    turn_kind: normalizeTurnKind(parsed.turn_kind),
    unfinished: parsed.unfinished === true || looksUnfinished(userMessage),
  };
}

