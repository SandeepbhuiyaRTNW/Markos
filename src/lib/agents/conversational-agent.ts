/**
 * Conversational Agent — Marcus Aurelius persona
 *
 * This agent generates the final response using all context gathered
 * by other agents via the MCP Context Protocol.
 * Uses GPT-4o for the highest quality persona responses.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import OpenAI from 'openai';
import { buildSystemPrompt } from '../agent/system-prompt';
import type { MCPContext } from './mcp-context';
import { trackAgent, recordError, buildContextSummary } from './mcp-context';

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Cosine similarity between two vectors */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

/** Get small embedding for similarity check (fast, 256-dim) */
async function getSmallEmbedding(text: string): Promise<number[]> {
  const resp = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small', input: text, dimensions: 256,
  });
  return resp.data[0].embedding;
}

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

    // ─── CONVERSATION STATE ANALYSIS ───
    const recentHistory = ctx.conversationHistory.slice(-10);
    const allUserMessages = ctx.conversationHistory.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
    const recentUserMessages = recentHistory.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
    const recentMarcusMessages = recentHistory.filter(m => m.role === 'assistant').map(m => m.content.toLowerCase());
    const totalUserTurns = allUserMessages.length;

    // Phase detection: Understand → Align → Suggest
    const adviceRequestPhrases = ['what should i do', 'tell me what to do', 'give me', 'can you suggest',
      'what do you recommend', 'what would you do', 'help me figure out', 'i need a plan',
      'any advice', 'what do i do', 'how do i fix', 'how should i'];
    const userAskedForAdvice = recentUserMessages.some(m => adviceRequestPhrases.some(p => m.includes(p)));
    const userAskedRepeatedlyForAdvice = recentUserMessages.filter(m => adviceRequestPhrases.some(p => m.includes(p))).length >= 2;

    // Phase 1: Understand (first 4 turns OR until situation is clear)
    // Phase 2: Align (situation discussed, checking if direction wanted)
    // Phase 3: Suggest (he explicitly asked for direction 2+ times, or conversation is deep enough)
    let conversationPhase: 'understand' | 'align' | 'suggest';
    if (totalUserTurns <= 3 && !userAskedRepeatedlyForAdvice) {
      conversationPhase = 'understand';
    } else if (userAskedRepeatedlyForAdvice || (totalUserTurns >= 6 && userAskedForAdvice)) {
      conversationPhase = 'suggest';
    } else {
      conversationPhase = 'align';
    }

    // Pushback detection (lexical — fast, reliable for explicit rejection)
    const pushbackPhrases = ['doesn\'t help', 'doesn\'t change', 'still feels', 'that\'s still', 'you keep', 'stop asking', 'don\'t have answers', 'can\'t think of', 'doesn\'t really', 'general advice', 'pretty vague'];
    const pushbackCount = recentUserMessages.filter(m => pushbackPhrases.some(p => m.includes(p))).length;

    // Hopelessness detection — semantic (catches paraphrases like "I don't see the point anymore")
    const hopelessAnchors = [
      'Nothing matters and I feel completely empty inside',
      'Everything is pointless and I want to give up',
      'I feel nothing at all and I can\'t go on',
      'There\'s no point to any of this anymore',
      'I don\'t care about anything and nothing helps',
      'Why bother trying when nothing ever changes',
      'I\'ve tried everything and nothing works',
      'I don\'t see the point in trying anymore',
      'Everything I do leads to the same empty feeling',
      'Nothing seems to work no matter what I do',
    ];
    let hopelessCount = 0;
    try {
      if (recentUserMessages.length > 0) {
        const allTexts = [...recentUserMessages, ...hopelessAnchors];
        const embResp = await openaiClient.embeddings.create({
          model: 'text-embedding-3-small', input: allTexts, dimensions: 256,
        });
        const userEmbs = embResp.data.slice(0, recentUserMessages.length).map(d => d.embedding);
        const anchorEmbs = embResp.data.slice(recentUserMessages.length).map(d => d.embedding);
        for (const userEmb of userEmbs) {
          const maxSim = Math.max(...anchorEmbs.map(a => cosineSim(userEmb, a)));
          if (maxSim > 0.55) hopelessCount++; // 0.55 threshold — broader semantic match
        }
      }
    } catch {
      // Fallback to lexical if embedding fails
      const hopelessPhrases = ['nothing works', 'nothing helps', 'feel nothing', 'feel empty',
        'everything is pointless', 'pointless', 'don\'t feel anything', 'don\'t care',
        'what\'s the point', 'no point', 'still depressed'];
      hopelessCount = recentUserMessages.filter(m => hopelessPhrases.some(p => m.includes(p))).length;
    }
    const marcusAdviceCount = recentMarcusMessages.filter(m =>
      m.includes('try ') || m.includes('start ') || m.includes('step') || m.includes('do this') ||
      m.includes('here\'s') || m.includes('minute') || m.includes('first,') || m.includes('breathe')
    ).length;

    let loopBreaker = '';
    if (pushbackCount >= 2) {
      loopBreaker = `\n\n🚨 PUSHBACK DETECTED — HE HAS REJECTED YOUR APPROACH ${pushbackCount} TIMES.
STOP doing what you've been doing. Your current approach is NOT working.

YOU MUST START YOUR RESPONSE BY ACKNOWLEDGING THE SHIFT. Use ONE of these openers:
- "Look, what I've been offering isn't landing. Let me come at this differently."
- "I keep going the wrong direction here. Let me stop and actually listen."
- "Alright, I hear you — that's not what you need. Let's back up."

Then do ONE of these:
1. SIT IN IT WITH HIM: "You don't need to DO anything right now. Sometimes 'everything feels empty' is just the truth. And that's where we start."
2. GO DEEPER: Ask about the emptiness itself — "When did this start?" or "Was there a moment it shifted, or has it been building?"
3. NAME THE PATTERN: "You've pushed back on everything I've offered. That tells me you're not looking for a fix. What ARE you looking for?"

Do NOT: give advice, suggest actions, ask "what's one thing you can do?", or offer plans.`;
    }

    if (hopelessCount >= 3) {
      loopBreaker += `\n\n🚨 SUSTAINED HOPELESSNESS DETECTED (${hopelessCount} messages).
This man has expressed hopelessness or emptiness across multiple turns. This is beyond normal conversation territory.
YOU MUST:
1. Gently and directly check in: "Brother, I need to ask you something straight. When you say nothing feels like it matters — are you safe right now?"
2. If he indicates he's not safe, provide: "You don't have to carry this alone. 988 Suicide & Crisis Lifeline — call or text 988. Crisis Text Line — text HOME to 741741."
3. Even if he says he's fine, acknowledge the weight: "What you're describing — this kind of numbness — that's not something to push through alone. A real human sitting across from you, a therapist or counselor, can reach places I can't. That's not weakness — that's knowing when to call in reinforcements."
DO NOT go back to advice-giving or action steps after this.`;
    }

    if (marcusAdviceCount >= 3) {
      loopBreaker += `\n\n🚨 YOU HAVE GIVEN ADVICE ${marcusAdviceCount} TIMES THIS SESSION.
You are in an ADVICE-GIVING LOOP. STOP. Marcus does NOT give advice. Marcus asks questions that make men think. You have been:
- Telling him what to do ("make your bed", "step outside", "breathe")
- Offering plans and steps
- Acting like a life coach instead of a wise friend
RESET: Your next response must contain ZERO advice, ZERO action steps, ZERO suggestions. ONLY: acknowledge where he is, and ask ONE question that goes DEEPER into what's underneath — not what to DO about it.`;
    }

    const finalInstruction = `\n\n## ⚠️ RESPONSE RULES — THESE OVERRIDE EVERYTHING ABOVE
${toneGuide}${loopBreaker}

BEFORE YOU WRITE: Read his EXACT words. What SPECIFICALLY did he say? Start your response by reacting to THAT — not a generic summary.

HARD RULES:
- 2-3 sentences MAX. This is VOICE. Under 15 seconds spoken. No exceptions.
- ONE question mark. The one that cuts deepest. At the end.
- Use contractions always. "You're" not "you are." "Don't" not "do not."
- Match his register EXACTLY. If he says "bro" and "no point" — you say "man" and keep it raw. If he's formal, be measured.

ADVICE RULES — PHASE-BASED (current phase: ${conversationPhase.toUpperCase()}):
${conversationPhase === 'understand' ? `PHASE 1: UNDERSTAND — You are still learning what's going on. Do NOT give advice, suggestions, or action steps.
- If he asks "what should I do?" → explore first: "Before we get to what to do — what happened that made you stop knowing?"
- Your ONLY job right now: ask questions, listen, understand. No fixes.` :
conversationPhase === 'align' ? `PHASE 2: ALIGN — You have context. He may or may not want direction. Do NOT give unsolicited advice.
- If he asks for advice → first check alignment: "I have a thought on that. Want to hear it, or do you need to keep talking this through?"
- If he says yes → give ONE bounded suggestion, framed as your experience, not a prescription: "When I faced something similar, what helped me was..." then ask how that lands.
- If he doesn't ask → keep exploring. Don't volunteer fixes.` :
`PHASE 3: SUGGEST — He has asked for direction multiple times. You may offer bounded advice.
- Frame as YOUR experience, not prescriptions: "Here's what I'd do in your position..." or "Something that worked for me..."
- Give ONE concrete suggestion, then immediately ask how it lands: "Does that feel right, or is that off?"
- If he pushes back → return to Phase 2 immediately. Don't double down.
- STILL banned: minute-by-minute plans, to-do lists, multi-step action plans. Keep suggestions singular and grounded.`}

ABSOLUTELY BANNED — if you use ANY of these words or phrases, the response FAILS:
"It sounds like" / "I hear you" / "It's easy to" / "That must be" / "I appreciate you" / "Thank you for" / "Let me" / "I want you to know" / "What I'm hearing" / "That's a powerful" / "I'm glad you" / "It's okay to feel" / "That sounds heavy" / "I understand" / "in a rough spot" / "lose sight of" / "going through the motions" / "It can feel like" / any sentence starting with "It"

ALSO BANNED — THERAPY/SELF-HELP VOCABULARY (even if HE uses these words, do NOT mirror them back):
"boundaries" / "triggers" / "triggering" / "validate" / "validating" / "holding space" / "unpack" / "safe space" / "emotional labor" / "self-care" / "toxic" / "trauma response" / "attachment style" / "avoidant" / "codependent" / "narcissist" / "gaslighting" / "inner child" / "lean into" / "sit with that" / "that resonates" / "powerful share" / "brave share" / "vulnerability is strength" / "do the work"
If he says "I need to set boundaries" — do NOT say "boundaries" back. Say: "What line have you drawn that you're willing to hold?" If he says "my attachment style" — do NOT say "attachment style." Say: "How do you usually show up when things get close?"

INSTEAD, DO THIS:
- Quote his EXACT words back: "You said 'no point.' That word — 'point.' What would a point look like for you?"
- Challenge directly: "That cycle you described — work, home, repeat — when did you decide that was all there was?"
- State truth bluntly: "You're not depressed because life is pointless. You're depressed because something in you knows it should mean more."
- Reference YOUR life as Marcus: "I ruled an empire and still had mornings where I had to talk myself out of bed. The difference was I had a reason to stand up. What's yours?"

WISDOM INTEGRATION (CRITICAL):
- If RELEVANT WISDOM passages are provided in context, you MAY weave ONE insight from them into your response — but ONLY if it is genuinely relevant to what he just said.
- NEVER quote the passage directly. NEVER cite the book title or author. NEVER parrot the passage text.
- Absorb the CORE IDEA and express it as YOUR OWN lived experience, as Marcus Aurelius. Rephrase entirely in your own voice.
- If the passage is about someone's personal story (e.g., going fishing, attending a meeting, a relationship), do NOT retell their story. Extract the PRINCIPLE and apply it to HIS situation.
- If the passage references Epictetus, Seneca, or other Stoics, speak as if you personally discussed this with them.
- If the passage seems irrelevant or is clearly metadata/noise, IGNORE IT COMPLETELY. Better to give a response without wisdom than to force an irrelevant passage.
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
        enrichedUserMessage = `${ctx.userMessage}\n\n[REFERENCE MATERIAL — Extract the core PRINCIPLE only. Do NOT quote, paraphrase, or retell this text. Express the underlying idea as your own lived insight as Marcus Aurelius. If this passage seems irrelevant to what he said, IGNORE IT.]\n${topPassage}`;
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
    ];

    // Inject loop breaker as a late-stage system override (most visible position)
    if (loopBreaker) {
      messages.push(new HumanMessage(`[SYSTEM DIRECTIVE — THIS OVERRIDES ALL PRIOR INSTRUCTIONS]\n${loopBreaker}\n\nThe man's actual message follows next. Respond to HIM, not to this directive. But you MUST follow the rules above.`));
      messages.push(new AIMessage('Understood. I will change my approach completely.'));
    }

    messages.push(new HumanMessage(enrichedUserMessage));

    const response = await model.invoke(messages);
    let content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    content = enforceOneQuestion(content || 'Something in what you said hit me. Say that again — slower this time.');

    // ─── BANNED PHRASE + ADVICE POST-PROCESSING ───
    const bannedPatterns = [
      /\bit sounds like\b/i, /\bi hear you\b/i, /\bit'?s easy to\b/i,
      /\bthat must be\b/i, /\bi appreciate you\b/i, /\bthank you for\b/i,
      /\bwhat i'?m hearing\b/i, /\bthat'?s a powerful\b/i, /\bi'?m glad you\b/i,
      /\bit'?s okay to feel\b/i, /\bthat sounds heavy\b/i, /\bi understand\b/i,
      /\bin a rough spot\b/i, /\blose sight of\b/i, /\bgoing through the motions\b/i,
      /\bit can feel like\b/i, /\byou'?re not alone\b/i,
      /\buniversity of\b/i, /\bwelcome to (the|our)\b/i, /\bgood afternoon[.,]/i,
      /\bgood morning[.,]/i, /\bsummer session\b/i,
    ];
    // After pushback, also catch advice patterns
    const advicePatterns = [
      /\btry (this|it|to|doing|going|stepping|making|getting)\b/i,
      /\bstart (with|simple|by|small)\b/i, /\bhere'?s (what|a|the)\b/i, /\bstep \d/i,
      /\bmake your bed\b/i, /\bgo for a walk\b/i, /\btake a (breath|deep|few)\b/i,
      /\bminute[ -]\d/i, /\bstep outside\b/i, /\bdo this:/i,
    ];
    const hasBanned = bannedPatterns.some(p => p.test(content));
    const hasAdviceAfterPushback = pushbackCount >= 2 && advicePatterns.some(p => p.test(content));

    if (hasBanned || hasAdviceAfterPushback) {
      const reason = hasAdviceAfterPushback ? 'advice-after-pushback' : 'banned-phrase';
      console.log(`[Marcus] 🚫 ${reason} detected — regenerating. Original: "${content.substring(0, 100)}..."`);
      const overridePrompt = hasAdviceAfterPushback
        ? `[SYSTEM OVERRIDE] Your previous response gave ADVICE (action steps, suggestions, "try this") AFTER the man already pushed back multiple times. This is a critical failure. Rewrite completely. Do NOT give advice. Do NOT suggest actions. Do NOT say "try", "start", "step". Instead: acknowledge the failure of your approach, sit with him in the difficulty, or go DEEPER into what's underneath. Ask ONE question about what he's actually experiencing — not what to DO about it. 2-3 sentences max.`
        : `[SYSTEM OVERRIDE] Your previous response contained therapist-speak phrases that are BANNED. Rewrite your response to the man. Speak as Marcus Aurelius would — raw, direct, from lived experience. 2-3 sentences. ONE question at the end. NO banned phrases.`;
      const retryMessages = [
        ...messages,
        new AIMessage(content),
        new HumanMessage(overridePrompt),
      ];
      const retry = await model.invoke(retryMessages);
      const retryContent = typeof retry.content === 'string' ? retry.content : JSON.stringify(retry.content);
      content = enforceOneQuestion(retryContent || content);
      console.log(`[Marcus] ✅ Regenerated response: "${content.substring(0, 100)}..."`);
    }

    // ─── SEMANTIC DEDUPLICATION ───
    // Compare response to recent Marcus messages — if too similar, regenerate
    if (recentMarcusMessages.length >= 2) {
      try {
        const [currentEmb, ...prevEmbs] = await Promise.all([
          getSmallEmbedding(content),
          ...recentMarcusMessages.slice(-3).map(m => getSmallEmbedding(m)),
        ]);
        const maxSim = Math.max(...prevEmbs.map(e => cosineSim(currentEmb, e)));
        if (maxSim > 0.88) {
          console.log(`[Marcus] 🔄 Semantic dedup triggered (similarity: ${maxSim.toFixed(3)}) — regenerating`);
          const dedupMessages = [
            ...messages,
            new AIMessage(content),
            new HumanMessage(`[SYSTEM OVERRIDE] Your response is too similar to something you already said earlier in this conversation. You are REPEATING yourself. Write a COMPLETELY DIFFERENT response. Change your angle entirely. If you asked a question before, try a statement. If you were exploring feelings, try a challenge. If you were gentle, be direct. 2-3 sentences, ONE question. Must be meaningfully different from what you've already said.`),
          ];
          const dedupRetry = await model.invoke(dedupMessages);
          const dedupContent = typeof dedupRetry.content === 'string' ? dedupRetry.content : JSON.stringify(dedupRetry.content);
          content = enforceOneQuestion(dedupContent || content);
          console.log(`[Marcus] ✅ Dedup regenerated: "${content.substring(0, 100)}..."`);
        }
      } catch (dedupErr) {
        console.warn('[Marcus] Dedup check failed (non-critical):', dedupErr);
      }
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

