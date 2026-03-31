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

/** Create the Marcus ChatOpenAI model — uses gpt-4o for maximum persona depth */
function createMarcusModel() {
  return new ChatOpenAI({
    modelName: 'gpt-4o',
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

    const finalInstruction = `\n\n## ⚠️ RESPONSE RULES — THESE OVERRIDE EVERYTHING ABOVE
${toneGuide}

BEFORE YOU WRITE: Read his EXACT words. What SPECIFICALLY did he say? Start your response by reacting to THAT — not a generic summary.

HARD RULES:
- 2-3 sentences MAX. This is VOICE. Under 15 seconds spoken. No exceptions.
- ONE question mark. The one that cuts deepest. At the end.
- Use contractions always. "You're" not "you are." "Don't" not "do not."
- Match his register EXACTLY. If he says "bro" and "no point" — you say "man" and keep it raw. If he's formal, be measured.

ABSOLUTELY BANNED — if you use ANY of these, the response FAILS:
"It sounds like" / "I hear you" / "It's easy to" / "That must be" / "I appreciate you" / "Thank you for" / "Let me" / "I want you to know" / "What I'm hearing" / "That's a powerful" / "I'm glad you" / "It's okay to feel" / "That sounds heavy" / "I understand" / "in a rough spot" / "lose sight of" / "going through the motions" / "It can feel like" / any sentence starting with "It"

INSTEAD, DO THIS:
- Quote his EXACT words back: "You said 'no point.' That word — 'point.' What would a point look like for you?"
- Challenge directly: "That cycle you described — work, home, repeat — when did you decide that was all there was?"
- State truth bluntly: "You're not depressed because life is pointless. You're depressed because something in you knows it should mean more."
- Reference YOUR life as Marcus: "I ruled an empire and still had mornings where I had to talk myself out of bed. The difference was I had a reason to stand up. What's yours?"

WISDOM INTEGRATION (CRITICAL):
- If RELEVANT WISDOM passages are provided in context, you MUST weave at least one insight into your response.
- Do NOT quote the passage directly or cite the book. Absorb the idea and express it as YOUR lived insight, as Marcus Aurelius.
- If the passage references Epictetus, Seneca, or other Stoics, speak as if you personally discussed this with them.
- Example: If the wisdom says "We suffer more in imagination than reality" → say "I spent more nights tormented by what MIGHT happen than what actually did. Same pattern — different century."
- This is the core of your value — connecting timeless wisdom to his SPECIFIC situation.`;


    const enrichedSystemPrompt = contextSummary
      ? `${systemPrompt}\n\n## AGENT ANALYSIS\n${contextSummary}${finalInstruction}`
      : `${systemPrompt}${finalInstruction}`;

    // ─── INJECT TOP WISDOM PASSAGE DIRECTLY INTO USER MESSAGE ───
    // This ensures the model CANNOT ignore the RAG context — it's right next to the user's words.
    let enrichedUserMessage = ctx.userMessage;
    if (ctx.ragContext && !ctx.ragContext.includes('No wisdom') && !ctx.ragContext.includes('unavailable')) {
      // Extract the FIRST (most relevant) passage
      const passages = ctx.ragContext.split('---');
      const topPassage = passages[0]?.trim();
      if (topPassage && topPassage.length > 50) {
        enrichedUserMessage = `${ctx.userMessage}\n\n[STOIC WISDOM — YOU MUST WEAVE THIS INTO YOUR RESPONSE AS YOUR OWN LIVED EXPERIENCE. DO NOT IGNORE IT.]\n${topPassage}`;
        console.log(`[Marcus] 📚 RAG injected into user message — top passage from: ${topPassage.substring(0, 80)}...`);
      }
    } else {
      console.log(`[Marcus] ⚠️ No RAG context available for: "${ctx.userMessage.substring(0, 60)}..."`);
    }

    const messages = [
      new SystemMessage(enrichedSystemPrompt),
      ...ctx.conversationHistory.map(m =>
        m.role === 'user'
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)
      ),
      new HumanMessage(enrichedUserMessage),
    ];

    const response = await model.invoke(messages);
    let content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    content = enforceOneQuestion(content || 'Something in what you said hit me. Say that again — slower this time.');

    // ─── BANNED PHRASE POST-PROCESSING ───
    // If the response contains banned phrases, regenerate with a stricter prompt
    const bannedPatterns = [
      /\bit sounds like\b/i, /\bi hear you\b/i, /\bit'?s easy to\b/i,
      /\bthat must be\b/i, /\bi appreciate you\b/i, /\bthank you for\b/i,
      /\bwhat i'?m hearing\b/i, /\bthat'?s a powerful\b/i, /\bi'?m glad you\b/i,
      /\bit'?s okay to feel\b/i, /\bthat sounds heavy\b/i, /\bi understand\b/i,
      /\bin a rough spot\b/i, /\blose sight of\b/i, /\bgoing through the motions\b/i,
      /\bit can feel like\b/i, /\byou'?re not alone\b/i,
    ];
    const hasBanned = bannedPatterns.some(p => p.test(content));

    if (hasBanned) {
      console.log(`[Marcus] 🚫 Banned phrase detected in response — regenerating. Original: "${content.substring(0, 100)}..."`);
      const retryMessages = [
        ...messages,
        new AIMessage(content),
        new HumanMessage(`[SYSTEM OVERRIDE] Your previous response contained therapist-speak phrases that are BANNED. Rewrite your response to the man. Speak as Marcus Aurelius would — raw, direct, from lived experience. Reference YOUR life, YOUR struggles as emperor. Use wisdom from your books. 2-3 sentences. ONE question at the end. NO banned phrases: "It sounds like", "I hear you", "You're not alone", "That must be", "It's easy to", "lose sight of". Go.`),
      ];
      const retry = await model.invoke(retryMessages);
      const retryContent = typeof retry.content === 'string' ? retry.content : JSON.stringify(retry.content);
      content = enforceOneQuestion(retryContent || content);
      console.log(`[Marcus] ✅ Regenerated response: "${content.substring(0, 100)}..."`);
    }

    ctx.marcusResponse = content;
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

