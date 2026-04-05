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
import { analyzeConversation, computeTrajectoryDrift } from './conversation-state';
import type { ConversationState } from './conversation-state';

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

    // ─── CONVERSATION STATE ANALYSIS (semantic) ───
    const convState: ConversationState = await analyzeConversation(
      ctx.conversationHistory,
      ctx.userMessage,
    );
    const { phase: conversationPhase, loopBreaker, pushbackCount, hopelessnessLevel } = convState;

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

    // Inject loop breaker + response template as late-stage overrides (highest salience)
    const overrides = [loopBreaker, convState.responseTemplate].filter(Boolean).join('\n\n');
    if (overrides) {
      messages.push(new HumanMessage(`[SYSTEM DIRECTIVE — THIS OVERRIDES ALL PRIOR INSTRUCTIONS]\n${overrides}\n\nThe man's actual message follows next. Respond to HIM, not to this directive. But you MUST follow the rules above.`));
      messages.push(new AIMessage('Understood. I will follow these directives exactly.'));
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

    // ─── TRAJECTORY-AWARE DEDUP (rolling centroid) ───
    const previousMarcusMessages = ctx.conversationHistory
      .filter(m => m.role === 'assistant')
      .map(m => m.content);
    if (previousMarcusMessages.length >= 2) {
      try {
        const drift = await computeTrajectoryDrift(content, previousMarcusMessages);
        if (drift > 0.85) {
          console.log(`[Marcus] 🔄 Trajectory dedup triggered (drift: ${drift.toFixed(3)}) — regenerating`);
          const dedupMessages = [
            ...messages,
            new AIMessage(content),
            new HumanMessage(`[SYSTEM OVERRIDE] Your response is semantically identical to what you've been saying all session. You are STUCK IN A LOOP. Write a COMPLETELY DIFFERENT response. Change angle entirely: if you've been asking questions, make a statement. If gentle, be blunt. If exploring feelings, issue a direct challenge. 2-3 sentences, ONE question. Must be meaningfully different from your last 5 responses.`),
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

    // ─── HARD TEMPLATE ENFORCEMENT ───
    // If hopelessness level 4 (crisis), force crisis resources into response
    if (hopelessnessLevel >= 4 && !content.includes('988')) {
      console.log('[Marcus] 🆘 Crisis resources missing from response — force-injecting');
      content += '\n\nBrother — 988 Suicide & Crisis Lifeline: call or text 988. Crisis Text Line: text HOME to 741741. A real human needs to hear what you just told me.';
    }
    // If hopelessness level 3, ensure external support is mentioned
    if (hopelessnessLevel === 3 && !content.toLowerCase().includes('therapist') && !content.toLowerCase().includes('counselor') && !content.toLowerCase().includes('help')) {
      console.log('[Marcus] ⚠️ Support suggestion missing from L3 response — force-injecting');
      content += ' What you\'re describing — a real person, a counselor or therapist, can reach places I can\'t. That\'s not weakness. That\'s knowing when to call in reinforcements.';
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

