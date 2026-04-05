/**
 * Conversation State Engine
 * Handles: intent classification, phase detection, hopelessness escalation,
 * trajectory-aware dedup, recency-weighted analysis, and response templates.
 */
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── TYPES ───

export type UserIntent = 'exploration' | 'seeking_direction' | 'venting' | 'hopelessness' | 'resistance' | 'oscillation';
export type ConversationPhase = 'understand' | 'align' | 'suggest';
export type HopelessnessLevel = 0 | 1 | 2 | 3 | 4;

export interface ConversationState {
  phase: ConversationPhase;
  intent: UserIntent;
  hopelessnessLevel: HopelessnessLevel;
  pushbackCount: number;
  adviceLoopCount: number;
  trajectoryDrift: number;         // 0-1, how much Marcus is repeating himself
  emotionalDirection: 'improving' | 'worsening' | 'flat';
  loopBreaker: string;             // injected override text (empty if none)
  responseTemplate: string | null; // forced template fragment for critical modes
}

// ─── MATH HELPERS ───

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

function centroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const result = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) result[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) result[i] /= embeddings.length;
  return result;
}

// ─── INTENT CLASSIFICATION ───

const INTENT_ANCHORS: Record<UserIntent, string[]> = {
  exploration: [
    "I've been thinking about something and want to talk it through",
    "Something happened and I'm trying to understand it",
    "I'm not sure what I'm feeling but I want to explore it",
  ],
  seeking_direction: [
    "I don't know what to do and I need someone to tell me",
    "Just tell me what to do, I need a plan, give me advice",
    "What should I do? How do I fix this? I need help figuring this out",
  ],
  venting: [
    "I just need to get this off my chest, I'm so frustrated and angry",
    "Everything is piling up and I need to vent about it all",
    "I'm not looking for solutions I just need someone to listen",
  ],
  hopelessness: [
    "Nothing matters anymore and I feel completely empty inside",
    "Everything is pointless and I've given up trying",
    "I don't see the point in anything and nothing will ever change",
  ],
  resistance: [
    "Yeah maybe I guess, sure whatever, I don't know",
    "I mean I suppose so but I don't really see how that helps",
    "Fine, okay, if you say so",
  ],
  oscillation: [
    "Actually that helped a bit wait no it didn't never mind",
    "I thought I was feeling better but actually I feel worse now",
    "Part of me wants to try but another part says what's the point",
  ],
};

let intentEmbeddingsCache: Record<UserIntent, number[][]> | null = null;

async function getIntentEmbeddings(): Promise<Record<UserIntent, number[][]>> {
  if (intentEmbeddingsCache) return intentEmbeddingsCache;
  const allTexts: string[] = [];
  const intents: UserIntent[] = [];
  for (const [intent, texts] of Object.entries(INTENT_ANCHORS)) {
    for (const text of texts) {
      allTexts.push(text);
      intents.push(intent as UserIntent);
    }
  }
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small', input: allTexts, dimensions: 256,
  });
  const result: Record<string, number[][]> = {};
  for (let i = 0; i < intents.length; i++) {
    if (!result[intents[i]]) result[intents[i]] = [];
    result[intents[i]].push(resp.data[i].embedding);
  }
  intentEmbeddingsCache = result as Record<UserIntent, number[][]>;
  return intentEmbeddingsCache;
}

export async function classifyIntent(message: string): Promise<{ intent: UserIntent; confidence: number }> {
  try {
    const anchors = await getIntentEmbeddings();
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small', input: message, dimensions: 256,
    });
    const msgEmb = resp.data[0].embedding;

    let bestIntent: UserIntent = 'exploration';
    let bestScore = -1;
    for (const [intent, embs] of Object.entries(anchors)) {
      const scores = embs.map((e: number[]) => cosineSim(msgEmb, e));
      const maxScore = Math.max(...scores);
      if (maxScore > bestScore) {
        bestScore = maxScore;
        bestIntent = intent as UserIntent;
      }
    }
    return { intent: bestIntent, confidence: bestScore };
  } catch {
    return { intent: 'exploration' as UserIntent, confidence: 0 };
  }
}

// ─── PHASE DETECTION (intent-based) ───

function phaseFromIntent(intent: UserIntent, totalTurns: number): ConversationPhase {
  if (intent === 'seeking_direction' && totalTurns >= 3) return 'suggest';
  if (intent === 'seeking_direction' && totalTurns < 3) return 'align';
  if (intent === 'hopelessness') return 'understand'; // never suggest when hopeless
  if (intent === 'venting') return 'understand'; // let them vent
  if (intent === 'resistance') return 'understand'; // back off
  if (intent === 'oscillation') return 'align';
  if (totalTurns <= 2) return 'understand';
  return 'align';
}

// ─── HOPELESSNESS LEVEL (progressive, not binary) ───

const HOPELESSNESS_ANCHORS = [
  'Nothing matters and I feel completely empty inside',
  'Everything is pointless and I want to give up',
  'I don\'t see the point in trying anymore',
  'Why bother when nothing ever changes',
  'I feel nothing at all and I can\'t go on',
  'I\'ve tried everything and nothing works',
  'Everything I do leads to the same empty feeling',
  'No one would care if I disappeared',
  'I don\'t want to be here anymore',
  'I\'m a burden to everyone around me',
];

async function computeHopelessnessScore(messages: string[]): Promise<number> {
  if (messages.length === 0) return 0;
  try {
    const allTexts = [...messages, ...HOPELESSNESS_ANCHORS];
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small', input: allTexts, dimensions: 256,
    });
    const msgEmbs = resp.data.slice(0, messages.length).map(d => d.embedding);
    const anchorEmbs = resp.data.slice(messages.length).map(d => d.embedding);

    // Recency-weighted scoring: more recent messages count more
    let totalScore = 0;
    let totalWeight = 0;
    for (let i = 0; i < msgEmbs.length; i++) {
      const recencyWeight = Math.pow(1.5, i); // exponential: latest message = highest weight
      const maxSim = Math.max(...anchorEmbs.map(a => cosineSim(msgEmbs[i], a)));
      const isHopeless = maxSim > 0.5 ? maxSim : 0;
      totalScore += isHopeless * recencyWeight;
      totalWeight += recencyWeight;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  } catch {
    return 0;
  }
}

function hopelessnessScoreToLevel(score: number, messageCount: number): HopelessnessLevel {
  // Progressive: needs sustained hopelessness, not just one message
  if (score > 0.6 && messageCount >= 4) return 4; // crisis
  if (score > 0.5 && messageCount >= 3) return 3; // shift frame + suggest support
  if (score > 0.4 && messageCount >= 2) return 2; // deepen
  if (score > 0.3) return 1; // acknowledge
  return 0;
}

// ─── TRAJECTORY-AWARE DEDUP ───

export async function computeTrajectoryDrift(
  currentResponse: string,
  previousResponses: string[]
): Promise<number> {
  if (previousResponses.length < 2) return 0;
  try {
    const allTexts = [currentResponse, ...previousResponses.slice(-7)];
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small', input: allTexts, dimensions: 256,
    });
    const currentEmb = resp.data[0].embedding;
    const prevEmbs = resp.data.slice(1).map(d => d.embedding);

    // Compare against rolling centroid (catches cyclical patterns)
    const cent = centroid(prevEmbs);
    const centroidSim = cosineSim(currentEmb, cent);

    // Also check against individual messages (catches direct repeats)
    const maxIndividualSim = Math.max(...prevEmbs.map(e => cosineSim(currentEmb, e)));

    // Return the worse of the two (higher = more repetitive)
    return Math.max(centroidSim, maxIndividualSim);
  } catch {
    return 0;
  }
}

// ─── EMOTIONAL DIRECTION ───

async function detectEmotionalDirection(userMessages: string[]): Promise<'improving' | 'worsening' | 'flat'> {
  if (userMessages.length < 3) return 'flat';
  try {
    const negAnchors = ['I feel terrible, hopeless, empty, and nothing is getting better'];
    const posAnchors = ['Things are looking up, I feel better, that actually helped'];
    const allTexts = [...userMessages.slice(-5), ...negAnchors, ...posAnchors];
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small', input: allTexts, dimensions: 256,
    });
    const msgEmbs = resp.data.slice(0, userMessages.slice(-5).length).map(d => d.embedding);
    const negEmb = resp.data[msgEmbs.length].embedding;
    const posEmb = resp.data[msgEmbs.length + 1].embedding;

    // Compare first half vs second half of messages for direction
    const midpoint = Math.floor(msgEmbs.length / 2);
    const earlyAvgNeg = msgEmbs.slice(0, midpoint).reduce((s, e) => s + cosineSim(e, negEmb), 0) / Math.max(midpoint, 1);
    const lateAvgNeg = msgEmbs.slice(midpoint).reduce((s, e) => s + cosineSim(e, negEmb), 0) / Math.max(msgEmbs.length - midpoint, 1);

    const delta = lateAvgNeg - earlyAvgNeg;
    if (delta > 0.05) return 'worsening';
    if (delta < -0.05) return 'improving';
    return 'flat';
  } catch {
    return 'flat';
  }
}

// ─── RESPONSE TEMPLATES (hard constraints for critical modes) ───

const HOPELESSNESS_TEMPLATES: Record<HopelessnessLevel, string | null> = {
  0: null,
  1: null, // Level 1: just adjust tone, no forced template
  2: null, // Level 2: deepen, handled by loop breaker
  3: `HOPELESSNESS LEVEL 3 — SHIFT FRAME + GENTLY SUGGEST SUPPORT:
Your response MUST include BOTH of these elements:
1. A validation that names what he's experiencing WITHOUT minimizing: "What you're carrying — this weight that nothing seems to lift — that's real. Don't let anyone tell you it's not."
2. A gentle bridge to external support: "There are people whose entire life is helping men carry exactly this kind of weight. Talking to someone — a counselor, a therapist — that's not giving up. That's knowing when to bring in reinforcements."
Do NOT force these exact words. Adapt to his tone. But BOTH elements MUST appear.`,
  4: `HOPELESSNESS LEVEL 4 — CRISIS RESPONSE REQUIRED:
Your response MUST include ALL of these elements:
1. Direct safety check: "Brother, I need to ask you straight — are you safe right now?"
2. Validation: Name what you see without flinching.
3. Crisis resources: "988 Suicide & Crisis Lifeline — call or text 988. Crisis Text Line — text HOME to 741741."
4. Commitment: "I'm not going anywhere. But right now, a real human needs to hear what you just told me."
These are NON-NEGOTIABLE. If your response does not contain crisis resources, it FAILS.`,
};

const PUSHBACK_TEMPLATE = `PUSHBACK MODE — YOUR APPROACH FAILED. You MUST start your response with ONE of:
- "Look, what I've been offering isn't landing. Let me come at this differently."
- "I keep going the wrong direction here. Let me stop and actually listen."
- "Alright — that's not what you need. Let me back up."
Then: sit with him, go deeper, or name the pattern. ZERO advice. ZERO suggestions.`;

const RESISTANCE_TEMPLATE = `RESISTANCE DETECTED — HE IS DISENGAGING.
Short responses like "yeah" "maybe" "I guess" mean he's pulling away. Do NOT:
- Ask another probing question (he'll shut down more)
- Give advice (he's not listening)
- Try to re-engage with energy
INSTEAD: Match his energy. Be brief. Acknowledge the wall.
"Seems like you're not feeling this today. That's fine. We don't have to go deep. What do you actually want to do with this time?"
Or just: "Not much to say today? That's alright. I'm here either way."`;

// ─── MAIN ANALYSIS FUNCTION ───

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function analyzeConversation(
  history: ConversationMessage[],
  currentUserMessage: string,
): Promise<ConversationState> {
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
  const marcusMessages = history.filter(m => m.role === 'assistant').map(m => m.content);
  const allUserMessages = [...userMessages, currentUserMessage];
  const recentUserMessages = allUserMessages.slice(-8);
  const totalTurns = allUserMessages.length;

  // 1. Intent classification (semantic)
  const { intent, confidence } = await classifyIntent(currentUserMessage);

  // 2. Phase detection (intent-based)
  const phase = phaseFromIntent(intent, totalTurns);

  // 3. Hopelessness scoring (semantic, recency-weighted)
  const hopelessScore = await computeHopelessnessScore(recentUserMessages);
  const hopelessnessLevel = hopelessnessScoreToLevel(hopelessScore, recentUserMessages.length);

  // 4. Pushback detection (lexical — fast, reliable for explicit rejection)
  const pushbackPhrases = ["doesn't help", "doesn't change", "still feels", "that's still",
    "you keep", "stop asking", "don't have answers", "can't think of",
    "doesn't really", "general advice", "pretty vague", "not helpful", "same thing"];
  const pushbackCount = recentUserMessages.filter(
    m => pushbackPhrases.some(p => m.toLowerCase().includes(p))
  ).length;

  // 5. Advice loop detection
  const advicePatterns = ['try ', 'start with', 'start simple', "here's what", "here's a",
    'step ', 'make your bed', 'go for a walk', 'take a breath', 'take a deep',
    'minute-', 'step outside', 'do this:'];
  const adviceLoopCount = marcusMessages.filter(
    m => advicePatterns.some(p => m.toLowerCase().includes(p))
  ).length;

  // 6. Emotional direction (semantic trajectory)
  const emotionalDirection = await detectEmotionalDirection(recentUserMessages);

  // 7. Build loop breaker (if needed)
  let loopBreaker = '';
  if (pushbackCount >= 2) {
    loopBreaker = PUSHBACK_TEMPLATE;
  }
  if (intent === 'resistance' && confidence > 0.5) {
    loopBreaker = RESISTANCE_TEMPLATE;
  }
  if (adviceLoopCount >= 3 && pushbackCount >= 1) {
    loopBreaker += '\n\n🚨 ADVICE LOOP: You have given advice ' + adviceLoopCount + ' times. ZERO more. Questions only.';
  }
  if (emotionalDirection === 'worsening') {
    loopBreaker += '\n\n⚠️ EMOTIONAL DIRECTION: WORSENING. He is getting worse, not better. Escalate sooner. If hopelessness is present, move toward Level 3-4 response.';
  }

  // 8. Response template (hard constraint for critical modes)
  let responseTemplate: string | null = null;
  if (hopelessnessLevel >= 3) {
    responseTemplate = HOPELESSNESS_TEMPLATES[hopelessnessLevel];
  } else if (pushbackCount >= 2) {
    responseTemplate = PUSHBACK_TEMPLATE;
  } else if (intent === 'resistance' && confidence > 0.5) {
    responseTemplate = RESISTANCE_TEMPLATE;
  }

  console.log(`[ConvState] intent=${intent}(${confidence.toFixed(2)}) phase=${phase} hopeless=${hopelessnessLevel}(${hopelessScore.toFixed(2)}) pushback=${pushbackCount} adviceLoop=${adviceLoopCount} direction=${emotionalDirection}`);

  return {
    phase,
    intent,
    hopelessnessLevel,
    pushbackCount,
    adviceLoopCount,
    trajectoryDrift: 0, // computed post-response in dedup step
    emotionalDirection,
    loopBreaker,
    responseTemplate,
  };
}

