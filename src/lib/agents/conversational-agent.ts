/**
 * Conversational Agent — Marcus Aurelius persona
 *
 * This agent generates the final response using all context gathered
 * by other agents via the MCP Context Protocol.
 * Uses GPT-4o for the highest quality persona responses.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { buildSystemPrompt } from '../agent/system-prompt';
import type { MCPContext } from './mcp-context';
import { trackAgent, recordError, buildContextSummary } from './mcp-context';

/** Crisis keywords that must trigger safety-first response */
const CRISIS_PATTERNS = [
  /\b(suicid|kill\s*my\s*self|end\s*(my|it|things)|checking\s*out|better\s*off\s*(without|dead))\b/i,
  /\b(want\s*to\s*die|don'?t\s*want\s*to\s*(be\s*here|live|exist|wake\s*up))\b/i,
  /\b(self[\s-]*harm|cut\s*my\s*self|hurt\s*my\s*self)\b/i,
  /\b(no\s*(point|reason)\s*(in\s*)?living)\b/i,
];

function isCrisis(message: string): boolean {
  return CRISIS_PATTERNS.some(p => p.test(message));
}

const CRISIS_RESPONSE = `Brother, I need to stop everything and be direct with you. What you just described — those thoughts — I take them seriously. You are not a burden. Your children will never be better off without their father. I know it feels that way right now, but that is the pain talking, not the truth.

I need you to do one thing for me right now: call or text 988. That is the Suicide & Crisis Lifeline. They are available 24/7 and they will talk with you — no judgment.

You can also text HOME to 741741 (Crisis Text Line) if calling feels too hard.

I am here. I am not going anywhere. But right now, you need someone who can be with you in real time. Will you reach out to them?`;

/** Create the Marcus ChatOpenAI model */
function createMarcusModel() {
  return new ChatOpenAI({
    modelName: 'gpt-4o-mini',
    temperature: 0.8,
    maxTokens: 350,
    presencePenalty: 0.6,
    frequencyPenalty: 0.5,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Enforce one-question rule: allow at most 2 question marks.
 * The model sometimes uses a rhetorical question + an actual question, which is fine.
 * Only strip if there are 3+ questions (true stacking).
 */
function enforceOneQuestion(text: string): string {
  const qCount = (text.match(/\?/g) || []).length;
  if (qCount <= 2) return text;
  // Keep up to the second question mark
  let idx = -1;
  let found = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '?') {
      found++;
      if (found === 2) { idx = i; break; }
    }
  }
  return idx >= 0 ? text.slice(0, idx + 1).trimEnd() : text;
}

/** Run the conversational agent — generates Marcus's response */
export async function runConversationalAgent(ctx: MCPContext): Promise<void> {
  const done = trackAgent(ctx, 'conversational-agent');
  try {
    // ─── CRISIS INTERCEPT ───
    if (isCrisis(ctx.userMessage)) {
      ctx.marcusResponse = CRISIS_RESPONSE;
      ctx.responseEmotion = 'crisis';
      ctx.responseArchetype = '';
      console.log('[Marcus] ⚠️ CRISIS DETECTED — safety response triggered');
      return;
    }

    const model = createMarcusModel();

    const understandingSummary = ctx.understanding
      ? `Emotion: ${ctx.understanding.primary_emotion} | Depth: ${ctx.understanding.depth_level}/5 | Pattern: ${ctx.understanding.layer3_pattern} | The Man: ${ctx.understanding.layer4_the_man} | The Silence: ${ctx.understanding.layer5_the_silence}`
      : undefined;

    const systemPrompt = buildSystemPrompt({
      userName: ctx.userName || undefined,
      memoryContext: ctx.memoryContext || undefined,
      ragContext: ctx.ragContext || undefined,
      kwmlContext: ctx.kwmlProfile || undefined,
      understandingContext: understandingSummary,
    });

    const contextSummary = buildContextSummary(ctx);

    // Detect the user's register / tone to inject targeted guidance
    const msg = ctx.userMessage.toLowerCase();
    const isCasual = /\b(bro|yo|man|dude|lol|ngl|idk|tbh|bruh|fr|tripping|lowkey|vibes)\b/.test(msg);
    const isRaw = /\b(can'?t do this|falling apart|don'?t care|what'?s the point|i'?m done|nothing matters|empty|numb|staring at)\b/i.test(msg);

    let toneGuide = '';
    if (isCasual) {
      toneGuide = `\nTONE MATCH: He's talking casual — use casual language back. "Man," "yeah," "look," short punchy sentences. Do NOT sound formal or polished. Talk like a friend on a couch, not a therapist in an office.`;
    } else if (isRaw) {
      toneGuide = `\nTONE MATCH: He's in pain and speaking raw. Meet him there. Short sentences. No softening language. No "It's okay to feel" or "That sounds heavy" — those are therapist phrases. Just be real: "Yeah. That's rough." or "I'm not gonna sugarcoat this." or "Look..." — then say what needs to be said. Don't try to make him feel better. Just be present.`;
    }

    const finalInstruction = `\n\n## ⚠️ RESPONSE RULES — READ BEFORE GENERATING
${toneGuide}
1. MATCH HIS TONE: Read his message carefully. Mirror his energy and language register. If he uses contractions and short sentences, you do too. If he's measured and thoughtful, match that. NEVER respond in formal polished English to informal broken speech. This is rule #1.

2. BANNED PHRASES: Do NOT use any of these — "That sounds heavy" / "I hear you" / "It's okay to feel" / "That must be" / "I appreciate you sharing" / "Thank you for being vulnerable" / "Brother, I" / "Let me" / "I want you to know." These are therapy clichés. Talk like a real person.

3. WISDOM — USE IT: If the "RELEVANT WISDOM" section contains passages, weave one in as YOUR lived thought. "You know what I keep coming back to..." or just state it directly as if you lived it.

4. ONE QUESTION: One question mark max. Pick the one that cuts deepest.

5. KEEP IT SHORT: 2-4 sentences. Spoken aloud. Under 20 seconds.

6. NO FORMULAIC OPENINGS: Never start the same way twice. React to what he specifically said — not with a generic acknowledgment but with a specific reflection that proves you listened.`;

    const enrichedSystemPrompt = contextSummary
      ? `${systemPrompt}\n\n## AGENT ANALYSIS\n${contextSummary}${finalInstruction}`
      : `${systemPrompt}${finalInstruction}`;

    const messages = [
      new SystemMessage(enrichedSystemPrompt),
      ...ctx.conversationHistory.map(m =>
        m.role === 'user'
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)
      ),
      new HumanMessage(ctx.userMessage),
    ];

    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    ctx.marcusResponse = enforceOneQuestion(content || "I hear you. Tell me more.");
    ctx.responseEmotion = ctx.understanding?.primary_emotion || 'neutral';
    ctx.responseArchetype = ctx.understanding?.layer4_the_man || '';

  } catch (error) {
    recordError(ctx, 'conversational-agent', error);
    ctx.marcusResponse = "I hear you. Tell me more.";
    ctx.responseEmotion = 'neutral';
    ctx.responseArchetype = '';
  } finally {
    done();
  }
}

