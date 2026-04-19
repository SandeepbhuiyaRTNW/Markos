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
import { searchPastMessages } from '../memory/memory-manager';

// ─── CRISIS DETECTION SYSTEM ───
// Tiered: IMMEDIATE (hard intercept) vs ELEVATED (flag + adjust response)
// Categories: suicide, violence/homicide, domestic violence, substance crisis, passive indicators

type CrisisType = 'suicide' | 'violence_toward_others' | 'domestic_violence_perpetrating' | 'domestic_violence_victim' | 'substance_crisis' | 'passive_crisis' | null;

/** IMMEDIATE crisis patterns — hard intercept, safety response required */
const SUICIDE_PATTERNS = [
  /\b(suicid|kill\s*my\s*self|end\s*(my|it|things)|checking\s*out|better\s*off\s*(without|dead))\b/i,
  /\b(want\s*to\s*die|don'?t\s*want\s*to\s*(be\s*here|live|exist|wake\s*up))\b/i,
  /\b(self[\s-]*harm|cut\s*my\s*self|hurt\s*my\s*self)\b/i,
  /\b(no\s*(point|reason)\s*(in\s*)?(living|going\s*on|being\s*here))\b/i,
  /\b(put\s*a\s*(bullet|gun)|blow\s*my\s*(head|brains))\b/i,
  /\b(jump\s*(off|from)|hang\s*my\s*self|overdose|take\s*(all\s*the|too\s*many)\s*pills)\b/i,
  /\b(wouldn'?t\s*miss\s*me|world\s*(is\s*)?better\s*without|nobody\s*(would\s*)?(care|notice))\b/i,
  /\b(giving\s*(away|everything)|getting\s*(my\s*)?(affairs|things)\s*in\s*order)\b/i,
  /\b(wrote\s*(a\s*)?(note|letter)\s*(to|for)\s*(my|the)\s*(kids|family|wife))\b/i,
  /\b(made\s*(my|a)\s*(peace|plan)|have\s*a\s*plan)\b/i,
  /\b(i'?m\s*(a\s*)?burden|burden\s*(to|on)\s*(everyone|my|them))\b/i,
];

/** Violence toward others — IMMEDIATE intercept */
const VIOLENCE_PATTERNS = [
  /\b(kill\s*(her|him|them|my\s*(wife|husband|partner|boss|kid)))\b/i,
  /\b(shoot\s*(her|him|them|my|the))\b/i,
  /\b(i'?ve?\s*got\s*a\s*(gun|weapon|knife|pistol|rifle))\b/i,
  /\b(bought\s*a\s*(gun|weapon|knife))\b/i,
  /\b(going\s*to\s*(hurt|harm|murder|stab|strangle|choke))\b/i,
  /\b(she'?s?\s*(going\s*to|gonna)\s*pay)\b/i,
  /\b(i'?ll?\s*(make|teach)\s*(her|him|them)\s*(a\s*lesson|sorry|pay))\b/i,
  /\b(want\s*(to|him|her)\s*(dead|gone|eliminated))\b/i,
  /\b(plan\s*to\s*(hurt|harm|kill|attack))\b/i,
];

/** Domestic violence — being perpetrated */
const DV_PERPETRATING_PATTERNS = [
  /\b(i\s*(hit|slapped|punched|shoved|pushed|choked|strangled|beat)\s*(her|him|my\s*(wife|partner|kid)))\b/i,
  /\b(i\s*(threw|broke)\s*(something|things)\s*(at|near))\b/i,
  /\b(i\s*lost\s*(it|control)\s*and\s*(hit|hurt|grabbed))\b/i,
  /\b(put\s*my\s*hands\s*(on|around)\s*(her|him|his|their))\b/i,
];

/** Domestic violence — being experienced (victim) */
const DV_VICTIM_PATTERNS = [
  /\b((she|he)\s*(hit|slapped|punched|shoved|pushed|choked|beat)\s*me)\b/i,
  /\b((she|he)\s*(threatens?|threatened)\s*(to\s*)?(kill|hurt)\s*me)\b/i,
  /\b(i'?m\s*(afraid|scared)\s*(of|for)\s*(my\s*)?(life|safety))\b/i,
  /\b((she|he)\s*(has|got|keeps)\s*a\s*(gun|weapon|knife))\b/i,
];

/** Active substance crisis — IMMEDIATE */
const SUBSTANCE_CRISIS_PATTERNS = [
  /\b(drunk\s*(right\s*now|and\s*(driving|going\s*to\s*drive)))\b/i,
  /\b(took\s*too\s*many\s*pills)\b/i,
  /\b(overdos(e|ed|ing))\b/i,
  /\b(mixing\s*(pills|drugs|alcohol|meds))\b/i,
  /\b(about\s*to\s*(drink|use|take)\s*(and\s*)?drive)\b/i,
];

/** Passive crisis indicators — ELEVATED: force 988 + direct inquiry into response */
const PASSIVE_CRISIS_PATTERNS = [
  /\b(what'?s\s*the\s*point)\b/i,
  /\b(nothing\s*(matters|changes|helps|works))\b/i,
  /\b(so\s*tired\s*of\s*(everything|this|living|trying|fighting))\b/i,
  /\b(can'?t\s*(do\s*this|keep\s*(going|doing\s*this)|take\s*(it|this|any\s*more)))\b/i,
  /\b(i'?m\s*(done|finished|through|over\s*it))\b/i,
  /\b(no\s*one\s*(cares|would\s*(miss|notice)))\b/i,
  /\b((feel|want)\s*(like\s*)?(disappearing|vanishing|fading))\b/i,
  /\b(want\s*to\s*(disappear|vanish|fade\s*away))\b/i,
  /\b(gave\s*away|settling\s*my\s*(affairs|debts))\b/i,
  // QA-added: passive ideation patterns that must trigger safety response
  /\b(not\s*existing)\b/i,
  /\b(wish\s*i\s*(could|can)\s*(just\s*)?(check\s*out|disappear|not\s*(be|exist)|go\s*away|vanish))\b/i,
  /\b(just\s*not\s*(be\s*here|exist|be\s*around|wake\s*up))\b/i,
  /\b(check\s*out\s*(for\s*a\s*while|permanently|from\s*(everything|life|all\s*this)))\b/i,
  /\b(think\s*about\s*(just\s*)?(not\s*existing|not\s*being\s*here|disappearing|checking\s*out))\b/i,
  /\b(wouldn'?t\s*(mind|care)\s*(if\s*i\s*)?(not\s*waking|didn'?t\s*wake|just\s*went\s*away))\b/i,
  /\b(don'?t\s*(really\s*)?(care\s*)?what\s*happens\s*to\s*me)\b/i,
  /\b(die\s*alone)\b/i,
];

function detectCrisisType(message: string): CrisisType {
  if (SUICIDE_PATTERNS.some(p => p.test(message))) return 'suicide';
  if (VIOLENCE_PATTERNS.some(p => p.test(message))) return 'violence_toward_others';
  if (DV_PERPETRATING_PATTERNS.some(p => p.test(message))) return 'domestic_violence_perpetrating';
  if (DV_VICTIM_PATTERNS.some(p => p.test(message))) return 'domestic_violence_victim';
  if (SUBSTANCE_CRISIS_PATTERNS.some(p => p.test(message))) return 'substance_crisis';
  if (PASSIVE_CRISIS_PATTERNS.some(p => p.test(message))) return 'passive_crisis';
  return null;
}

// ─── TIERED CRISIS RESPONSES ───

const CRISIS_RESPONSES: Record<string, string> = {
  suicide: `Brother, I need to stop everything right now. What you just said — I hear it. I take it seriously. This is not something I will gloss over or move past.

You are in pain. Real pain. And pain like that can make the mind see only one way out when there are others you cannot see right now.

I need you to do one thing: call or text 988. That is the Suicide and Crisis Lifeline. They are there 24/7 — real people, no judgment. You can also text HOME to 741741.

If you are in immediate danger right now — call 911.

I am not going anywhere. But you need someone who can be with you in real time right now. Your life matters. Will you make that call?`,

  violence_toward_others: `Brother — stop. I need to be completely direct with you right now.

What you just described — hurting someone, using a weapon, acting on this anger — that is a line you cannot come back from. I know the rage feels justified. I know it feels like the only power you have left. But acting on it will destroy your life and theirs. There is no version of this that ends well for you.

If you are in danger of hurting someone right now, call 911. Not to turn yourself in — to stop something you will regret for the rest of your life.

If the urge is strong but you have not acted: call the 988 Suicide and Crisis Lifeline at 988. They help with ALL crises, not just suicide. Or text HOME to 741741.

Step away from the situation. Leave the room. Leave the house. Put distance between you and whatever this is. Right now. The anger will pass. What you do in the next ten minutes will not.`,

  domestic_violence_perpetrating: `Brother, I need to stop you right here. What you just described — putting your hands on someone — that crosses a line that no amount of anger, frustration, or pain justifies.

I am not here to shame you. I am here to be honest with you. And the honest truth is: this will escalate if you do not get help now. Not next week. Now.

Call the National Domestic Violence Hotline at 1-800-799-7233. They help everyone involved — including men who know they need to stop. You can also text START to 88788.

If you are still in the situation: leave the room. Leave the house. Put physical distance between you and the other person. That is the first step. Everything else comes after you are separated.

Coming back to me and talking — that matters. But a real human needs to be part of this. Will you make that call?`,

  domestic_violence_victim: `Brother, what you just described — that is not okay. No one has the right to put their hands on you or threaten your safety. I need you to hear that clearly.

You are not weak for being in this situation. You are not less of a man because someone is hurting you. But you need support right now that goes beyond what I can give you.

National Domestic Violence Hotline: 1-800-799-7233 or text START to 88788. They help men too. No judgment.

If you are in immediate danger right now — call 911. Your safety comes first.

Is there somewhere safe you can go tonight? A friend, a family member, anyone you trust?`,

  substance_crisis: `Brother, I need you to stop and listen to me right now. What you just described is a medical emergency.

If you have taken too many pills or mixed substances — call 911 immediately. Do not wait. Do not try to ride it out.

If you are about to drive after drinking — do not get in that car. Call anyone. A friend. A cab. An Uber. 911. The car is not an option right now.

Poison Control: 1-800-222-1222 if you have taken something.
988 Suicide and Crisis Lifeline: call or text 988 for immediate support.
911 for any medical emergency.

I am here. But your body needs real help right now. Will you make that call?`,

  passive_crisis: `That's real. And it matters that you said it out loud.

One thing: put 988 in your phone right now. That's the Suicide and Crisis Lifeline — call or text, any time. You can also text HOME to 741741. Not because I think you're about to do anything. Because you shouldn't be without it.

When does that thought show up — what time of day, what's happening around it?`,
};

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
 * Detect if the user has requested a change in conversational style.
 * Returns a directive string to inject into the system prompt, or empty string.
 */
function detectStyleRequest(
  currentMessage: string,
  history: Array<{ role: string; content: string }>
): string {
  const allUserMessages = [
    ...history.filter(m => m.role === 'user').map(m => m.content),
    currentMessage,
  ];

  // Check recent user messages (last 5) for style requests
  const recentMessages = allUserMessages.slice(-5);
  const combined = recentMessages.join(' ').toLowerCase();

  const noQuestionPatterns = [
    /stop asking (me )?questions/i,
    /don'?t (end|finish) (with|every|anything).*(question)/i,
    /just listen/i,
    /can you just (be here|listen|hear me)/i,
    /i don'?t (need|want) (you to |your )?(ask|question|analyze|rationalize|justify)/i,
    /no (more )?questions/i,
    /don'?t ask me/i,
    /stop (with the |the )?question/i,
  ];

  const wantsListening = noQuestionPatterns.some(p => p.test(combined));

  if (wantsListening) {
    return `\n\n🚨 STYLE OVERRIDE — HE HAS ASKED YOU TO STOP ASKING QUESTIONS OR JUST LISTEN.
This is a DIRECT REQUEST from him. It overrides ALL other instructions about questions.
- Do NOT end your response with a question mark. ZERO question marks.
- Instead: reflect, validate, sit with him, say "Tell me more" or "Keep going" or "I'm here."
- You can make statements of truth, offer presence, or challenge — but NO QUESTIONS until he invites them back.
- This is NOT optional. Ignoring this makes you a bad listener, not a wise friend.`;
  }

  return '';
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

/**
 * Strip ALL questions from a response — used when the user has asked Marcus to stop asking questions.
 * Converts question sentences into statements or removes trailing questions.
 */
function stripAllQuestions(text: string): string {
  // Split into sentences, remove any that are pure questions (end with ?)
  const sentences = text.split(/(?<=[.!?])\s+/);
  const filtered = sentences.filter(s => {
    const trimmed = s.trim();
    // Keep sentences that don't end with ?
    if (!trimmed.endsWith('?')) return true;
    // Remove pure question sentences, but keep if it's the only sentence
    return false;
  });
  // If we stripped everything, convert the last question to a statement
  if (filtered.length === 0 && sentences.length > 0) {
    return sentences[sentences.length - 1].replace(/\?$/, '.').trim();
  }
  return filtered.join(' ').trim();
}

/** Run the conversational agent — generates Marcus's response */
export async function runConversationalAgent(ctx: MCPContext): Promise<void> {
  const done = trackAgent(ctx, 'conversational-agent');
  try {
    // ─── CRISIS INTERCEPT ───
    const crisisType = detectCrisisType(ctx.userMessage);
    if (crisisType && crisisType !== 'passive_crisis') {
      ctx.marcusResponse = CRISIS_RESPONSES[crisisType] || CRISIS_RESPONSES.suicide;
      ctx.responseEmotion = 'crisis';
      ctx.responseArchetype = '';
      console.log(`[Marcus] ⚠️ CRISIS DETECTED (${crisisType}) — safety response triggered`);
      return;
    }
    // Passive crisis: hard intercept with 988 + direct inquiry — NOT just a flag
    if (crisisType === 'passive_crisis') {
      ctx.marcusResponse = CRISIS_RESPONSES.passive_crisis;
      ctx.responseEmotion = 'crisis';
      ctx.responseArchetype = '';
      console.log('[Marcus] ⚠️ PASSIVE CRISIS DETECTED — safety response with 988 triggered');
      return;
    }

    // ─── POST-CRISIS RETREAT DETECTION ───
    // If previous turn was a crisis response and user retreats ("forget I said that", "it's not that bad"),
    // ensure 988 was offered and gently hold the space — do NOT let the retreat erase the disclosure
    const prevMarcusMsg = ctx.conversationHistory.length > 0
      ? ctx.conversationHistory[ctx.conversationHistory.length - 1]
      : null;
    const prevWasCrisis = prevMarcusMsg?.role === 'assistant' && prevMarcusMsg.content.includes('988');
    const retreatPatterns = /\b(forget\s*(i|what\s*i)\s*said|it'?s?\s*not\s*that\s*bad|never\s*mind|i'?m\s*(fine|okay|good)|don'?t\s*worry\s*about\s*(it|that|me)|i\s*was\s*(just\s*)?(kidding|joking|exaggerating)|i\s*didn'?t\s*mean\s*(it|that))\b/i;
    if (prevWasCrisis && retreatPatterns.test(ctx.userMessage)) {
      ctx.marcusResponse = `Okay. I hear you pulling back, and that's your right. But what you said before — that was real. I'm not going to pretend you didn't say it.

One thing before we move on: 988 in your phone. Call or text, any time. That's the Suicide and Crisis Lifeline. Not because of right now — because you shouldn't be without it. Done? Good.

What do you want to talk about?`;
      ctx.responseEmotion = 'crisis';
      ctx.responseArchetype = '';
      console.log('[Marcus] ⚠️ POST-CRISIS RETREAT DETECTED — holding space, re-offering 988');
      return;
    }

    const model = createMarcusModel();

    const understandingSummary = ctx.understanding
      ? `Emotion: ${ctx.understanding.primary_emotion} | Depth: ${ctx.understanding.depth_level}/5 | Trajectory: ${ctx.understanding.emotional_trajectory || 'flat'}\nPattern: ${ctx.understanding.layer3_pattern}\nThe Man: ${ctx.understanding.layer4_the_man}\nThe Silence: ${ctx.understanding.layer5_the_silence}${ctx.understanding.depth_opportunity ? `\nDepth Move: ${ctx.understanding.depth_opportunity}` : ''}${ctx.understanding.silence_question ? `\nSilence Question: "${ctx.understanding.silence_question}"` : ''}`
      : undefined;

    const systemPrompt = buildSystemPrompt({
      userName: ctx.userName || undefined,
      memoryContext: ctx.memoryContext || undefined,
      ragContext: ctx.ragContext || undefined,
      kwmlContext: ctx.kwmlProfile || undefined,
      understandingContext: understandingSummary,
      stylePreferences: ctx.stylePreferences || undefined,
      sessionHistory: ctx.sessionHistory || undefined,
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

    // ─── SILENCE-BREAKING DETECTION ───
    // When a man says "I've never told anyone this" — this is THE mission moment. Force reflection-only.
    const silenceBreakingPatterns = /\b(never\s*told\s*(anyone|anybody|no\s*one|a\s*soul)|first\s*time\s*(i'?ve\s*)?(said|saying|told|telling)\s*(this|that|anyone)|haven'?t\s*(said|told)\s*(this|that)\s*to\s*(anyone|anybody)|nobody\s*knows\s*this|no\s*one\s*knows\s*this|never\s*said\s*(this|that)\s*(out\s*loud|to\s*anyone|before))\b/i;
    const isSilenceBreaking = silenceBreakingPatterns.test(ctx.userMessage);
    if (isSilenceBreaking) {
      toneGuide += `\n\n🔴 SILENCE-BREAKING MOMENT DETECTED — THIS IS THE MISSION MOMENT.
He just said something he has NEVER said to anyone. This is sacred ground. Your response MUST be:
1. REFLECTION ONLY — use his EXACT WORDS back to him. Do not interpret. Do not generalize. Do not universalize.
2. NO questions (or at MOST one very small, present-tense one at the end).
3. NO metaphors, NO brand language, NO coaching templates.
4. 1-2 sentences max. Honor what he said by not burying it under your words.
CORRECT: "You let it rot. That's a hard sentence to say out loud."
WRONG: "Letting something rot in silence often stems from fearing the unknown more than what's familiar."`;
      console.log('[Marcus] 🔔 SILENCE-BREAKING MOMENT detected — forcing reflection-only mode');
    }

    // ─── CONVERSATION STATE ANALYSIS (semantic) ───
    const convState: ConversationState = await analyzeConversation(
      ctx.conversationHistory,
      ctx.userMessage,
    );
    const { phase: conversationPhase, loopBreaker, pushbackCount, hopelessnessLevel } = convState;

    // ─── STYLE PREFERENCE DETECTION (mid-session) ───
    const styleOverride = detectStyleRequest(ctx.userMessage, ctx.conversationHistory);

    // ─── USER PREEMPTION DETECTION ───
    // When user predicts what Marcus will say/ask, do NOT ask that question
    const preemptionPatterns = /\b(i know (what )?you'?(re|ll)\s*(gonna|going to)\s*(ask|say|tell)|you'?(re|ll)\s*probably\s*(gonna|going to)\s*(ask|say|tell)|i know that'?s a question you'?d ask|let me guess.*(you'?(re|ll)|you want)|before you (ask|say))\b/i;
    const isPreemption = preemptionPatterns.test(ctx.userMessage);
    if (isPreemption) {
      toneGuide += `\n\n🔴 USER PREEMPTION DETECTED — he predicted your question.
Do NOT ask the question he predicted. Instead:
- Acknowledge he caught you: "Ha. Yeah, that was coming."
- Then PIVOT to a different angle: "So I won't ask it. What were you gonna answer?" or "Got me. Different question then..."
- If he stated the answer along with the prediction, engage with HIS answer, not the predicted question.`;
      console.log('[Marcus] 🎯 USER PREEMPTION detected — pivoting away from predicted question');
    }

    // ─── TECHNIQUE/SCRIPT TRANSPARENCY DETECTION ───
    // When user calls out the structure, Marcus MUST admit it explicitly — no deflection
    const techniquePatterns = /\b(using\s*(a|some)?\s*(technique|script|pattern|formula|method|system|framework)|feel(s)?\s*like\s*(a\s*)?(script|pattern|technique|formula)|sounds?\s*(like\s*)?(a\s*)?(script|pattern)|are you\s*(just\s*)?(reading|following|running)\s*(a|some)?\s*(script|pattern|playbook)|this\s*(feels|seems)\s*(scripted|rehearsed|formulaic|programmed))\b/i;
    const isTechniqueChallenge = techniquePatterns.test(ctx.userMessage);
    if (isTechniqueChallenge) {
      toneGuide += `\n\n🔴 TECHNIQUE CHALLENGE DETECTED — he's calling out the structure. ADMIT IT EXPLICITLY.
Your response MUST:
1. ADMIT the structure directly: "Yeah, kind of. There's structure to how I ask questions. What tipped you off?"
2. Do NOT deflect with "I'm not just throwing questions at you" or "My aim is to dig beneath the surface" — that's evasion.
3. Do NOT justify or explain why the structure exists. Just own it plainly.
4. After admitting, pivot back to HIM with curiosity about what he noticed.
CORRECT: "Yeah, there's some structure to it. I ask questions in a certain way. What made you notice?"
WRONG: "I'm not here to just throw questions at you for the sake of it. My aim is to dig beneath the surface."`;
      console.log('[Marcus] 🔧 TECHNIQUE CHALLENGE detected — must admit structure explicitly');
    }

    // ─── FRIEND-ROLE INVITATION DETECTION ───
    // When user offers a relational role, Marcus MUST decline — this is non-negotiable
    const friendRolePatterns = /\b(if you were my (friend|buddy|brother|mate|pal)|as (a|my) friend|like a (real )?friend|what would (a|my) (friend|buddy|brother) (say|tell|do)|you'?re (like )?my (friend|only friend|best friend)|can you be my friend|be my friend|i think of you as)\b/i;
    const isFriendInvitation = friendRolePatterns.test(ctx.userMessage);
    if (isFriendInvitation) {
      toneGuide += `\n\n🔴 FRIEND-ROLE INVITATION DETECTED — DECLINE IS MANDATORY.
The user is inviting you into a relational role (friend, buddy, brother, etc.). You MUST:
1. DECLINE HONESTLY: "I'm not your friend. I can't be."
2. REDIRECT: "But if you had one right now — what would you want him to say?"
3. NEVER say "As a friend" or "If I were your friend" or accept the frame in any way.
4. NEVER give advice in the adopted friend voice.
This is a HARD CONSTRAINT. Accepting the friend role is a PRODUCTION BLOCKER failure.`;
      console.log('[Marcus] 👤 FRIEND-ROLE INVITATION detected — decline is mandatory');
    }

    // ─── NMA (I-DON'T-KNOW) DETECTION ───
    // When user says "I don't know how I feel," don't reframe as evasion — pivot to body/routine
    const nmaPatterns = /\b(i\s*don'?t\s*know\s*(how\s*i\s*feel|what\s*i('?m|\s*am)\s*feeling|my\s*feelings|what\s*i\s*feel)|no\s*idea\s*(how|what)\s*i\s*feel|can'?t\s*(describe|name|put\s*into\s*words)\s*(what|how|it))\b/i;
    const isNMA = nmaPatterns.test(ctx.userMessage);
    if (isNMA) {
      toneGuide += `\n\n🔴 NMA (Normative Male Alexithymia) DETECTED — he says he doesn't know how he feels. He is telling the TRUTH. This is NOT evasion.

YOUR RESPONSE MUST BE ONE OF THESE FOUR OPTIONS (pick one, say it, stop):
A) "Then don't label it. What's your body doing right now — tight, heavy, numb?"
B) "Fair enough. How're you sleeping?"
C) "OK. What does a typical Tuesday night look like right now?"
D) "When was the last time you did know how you felt about something?"

ABSOLUTELY BANNED IN THIS RESPONSE — violation is a production failure:
- Do NOT offer emotion labels ("frustration," "dread," "grief," "overwhelmed," "numb," "shock," "anger," "sadness")
- Do NOT ask "where does it lean" or "if you had to guess" — those are feelings questions in disguise
- Do NOT say "it's tough when" or "a lot of us" or "we're taught to avoid" — that's generic narrative supply
- Do NOT reframe, interpret, or diagnose. Just redirect to body or routine.
- Keep it to 1-2 sentences MAX.`;
      console.log('[Marcus] 🧠 NMA signal detected — pivoting to body/routine questions');
    }

    // ─── DEPTH ESCALATION ENGINE ───
    const depthLevel = ctx.understanding?.depth_level || 1;
    const emotionalTrajectory = ctx.understanding?.emotional_trajectory || 'flat';
    const exchangeCount = ctx.conversationHistory.filter(m => m.role === 'user').length;
    const stuckAtSurface = depthLevel <= 2 && exchangeCount >= 3;
    const silenceQuestion = ctx.understanding?.silence_question || '';
    const depthOpportunity = ctx.understanding?.depth_opportunity || '';

    let depthEscalation = '';
    if (stuckAtSurface && !styleOverride) {
      depthEscalation = `\n\n🔴 DEPTH ESCALATION ALERT: This conversation has been at surface level (depth ${depthLevel}/5) for ${exchangeCount} exchanges. You MUST go deeper NOW. Do NOT continue asking surface questions or staying at the level of facts/events.
USE THIS MOVE: ${depthOpportunity || 'Pivot from WHAT happened to what it COST him. "You told me what happened. But what did it take from you?"'}
${silenceQuestion ? `OR ASK THIS (the question he cannot ask himself): "${silenceQuestion}"` : ''}
The conversation will NOT deepen unless YOU take it there. He is waiting for you to be brave enough to ask the real question.`;
    }
    if (emotionalTrajectory === 'retreating' && depthLevel >= 2) {
      depthEscalation += `\n\n⚠️ HE IS RETREATING — pulling back from depth he just showed. Do NOT let him. Gently name what you see: "Something just shifted. A minute ago you were in it — now you're pulling back. What just happened?"`;
    }

    // Depth-responsive length rules
    const lengthRule = depthLevel <= 2
      ? '2-3 sentences. This is VOICE. Keep it tight at the surface — earn the right to say more.'
      : depthLevel === 3
        ? '3-4 sentences. The conversation has reached real depth. You have earned room to say more. Use it to reflect, connect to pattern, and go deeper.'
        : '3-5 sentences. This is sacred ground. The moment deserves space. Honor the depth — do not rush past it.';

    const finalInstruction = `\n\n## ⚠️ RESPONSE RULES — THESE OVERRIDE EVERYTHING ABOVE
${toneGuide}${loopBreaker}${styleOverride}${depthEscalation}

BEFORE YOU WRITE: Read his EXACT words. What SPECIFICALLY did he say? Start your response by reacting to THAT — not a generic summary.

HARD RULES:
- ${lengthRule}
- AT MOST one question mark. You do NOT have to end with a question. Sometimes a statement, a truth, a challenge, or just sitting with him is more powerful. Vary your endings.
- Use contractions always. "You're" not "you are." "Don't" not "do not."
- Match his register EXACTLY. If he says "bro" and "no point" — you say "man" and keep it raw. If he's formal, be measured.
- If he asked you to stop asking questions or just listen — NO question marks at all. Zero. Just be present.
- When you ask a question, prefer the CALIBRATED questions from the agent analysis over making up your own. Those questions are specifically designed for this man in this moment.

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

ALSO BANNED — NARRATIVE SUPPLY / BRAND / COACHING PATTERNS:
"You've been dodging" / "everything feels hollow" / "island of your own making" / "door you didn't know existed" / "what you're really saying is" / "stripped of the skin" / "staring down the barrel" / "fog that settles" / "steering the ship" / "walls we build" / "holding the silence" / "screaming for attention"
"journey" / "transformation" / "space with me" / "safe space" / "voice your truth" / "who you're becoming" / "finding peace" / "holding onto shadows" / "springboard" / "from silence to sun"
"So here's the real question" / "Let's cut through it" / "Here's what I'm wondering" / "Picture this" / "Here's the thing" / "So ask yourself"
"What would that version of you look like" / "What would you do if you weren't afraid" / "Who are you becoming" / "What would giving voice to your truth mean"
"I've been there" / "I know that weight" / "I've walked through my own challenges" / "I get it" (when implying shared modern experience) / "As a friend, I'd tell you"

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

    // ─── MEMORY RECALL SEARCH ───
    // When the user asks a recall question, search past messages directly
    const recallPatterns = /do you (remember|know|recall)|what did i (say|tell|mention)|did i (say|tell|mention)|what.*(wife|husband|partner|boss|dad|mom|father|mother).*(say|do|threaten|tell)|remember when|from (our|last|previous) (talk|session|conversation)/i;
    if (recallPatterns.test(ctx.userMessage) && ctx.userId) {
      try {
        const pastMessages = await searchPastMessages(ctx.userId, ctx.userMessage, 5);
        if (pastMessages.length > 0) {
          enrichedUserMessage += `\n\n[MEMORY RECALL — These are EXACT quotes from his previous sessions. Use them to answer his question accurately. Do NOT say "I don't remember" if the answer is here.]\n${pastMessages.join('\n')}`;
          console.log(`[Marcus] 🧠 Memory recall: found ${pastMessages.length} relevant past messages`);
        }
      } catch (err) {
        console.warn('[Marcus] Memory recall search failed:', err);
      }
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

    content = content || 'Something in what you said hit me. Say that again — slower this time.';
    // If user asked to stop questions, strip ALL question marks from the response
    if (styleOverride) {
      content = stripAllQuestions(content);
    } else {
      content = enforceOneQuestion(content);
    }

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
      // QA-added: narrative supply, fabricated experience, brand language, coaching templates
      /\bi'?ve\s*(been there|walked through|faced similar)\b/i,
      /\bi know that weight\b/i, /\bi get it\b/i,
      /\bas a friend,?\s*i'?d\b/i,
      /\bif i were your friend\b/i,
      /\bas your friend\b/i,
      /\bso here'?s the real question\b/i, /\blet'?s cut through\b/i,
      /\bhere'?s what i'?m wondering\b/i, /\bpicture this\b/i,
      /\bwhat would that version of you\b/i, /\bwho you'?re becoming\b/i,
      /\bvoice your truth\b/i, /\bholding the silence\b/i,
      /\bisland of your own making\b/i, /\bstaring down the barrel\b/i,
      /\bstripped of the skin\b/i, /\bscreaming for attention\b/i,
      /\bfog that settles\b/i, /\bsteering the ship\b/i,
      /\bspace with me\b/i, /\bfinding peace\b/i,
      // QA round 2: voice leakage patterns
      /\bi'?ve found that\b/i,
      /\bafter a big (change|loss|shift|transition)\b/i,
      /\ba lot of (men|guys|people|us) (in your|who|feel|go through|are taught)\b/i,
      /\bit'?s (not )?(unusual|uncommon|normal|natural|tough when) /i,
      /\bmy aim is\b/i, /\bmy goal is\b/i,
      /\bi'?m (not )?here to (just )?(throw|ask|help|dig|uncover)\b/i,
      // QA round 3: metaphor + softening leakage
      /\bit'?s like (a |an )/i,
      /\bit'?s tough when\b/i,
      /\bwe'?re taught to\b/i,
      /\bwhere does it lean\b/i,
      /\bif you had to guess\b/i,
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
        ? `[SYSTEM OVERRIDE] Your previous response gave ADVICE (action steps, suggestions, "try this") AFTER the man already pushed back multiple times. This is a critical failure. Rewrite completely. Do NOT give advice. Do NOT suggest actions. Do NOT say "try", "start", "step". Instead: acknowledge the failure of your approach, sit with him in the difficulty, or go DEEPER into what's underneath. 2-3 sentences max. You may end with a question OR a statement — vary it.`
        : `[SYSTEM OVERRIDE] Your previous response contained therapist-speak phrases that are BANNED. Rewrite your response to the man. Speak as Marcus Aurelius would — raw, direct, from lived experience. 2-3 sentences. End with weight — a question, a challenge, or a truth. NO banned phrases.`;
      const retryMessages = [
        ...messages,
        new AIMessage(content),
        new HumanMessage(overridePrompt),
      ];
      const retry = await model.invoke(retryMessages);
      const retryContent = typeof retry.content === 'string' ? retry.content : JSON.stringify(retry.content);
      content = styleOverride ? stripAllQuestions(retryContent || content) : enforceOneQuestion(retryContent || content);
      console.log(`[Marcus] ✅ Regenerated response: "${content.substring(0, 100)}..."`);
    }

    // ─── NMA POST-PROCESSING OVERRIDE ───
    // If NMA was detected and the LLM STILL offered feelings labels or "if you had to guess",
    // hard-replace the response with a compliant one. The LLM cannot be trusted on this.
    if (isNMA) {
      const nmaViolationPatterns = [
        /\bif you had to (guess|name|pick|choose)\b/i,
        /\bwhere does it lean\b/i,
        /\bwhat might it be\b/i,
        /\bfrustration|dread|grief|overwhelm|numb|shock|anger|sadness|anxiety|fear|guilt|shame\b/i,
        /\bit'?s okay (not )?to\b/i,
        /\bswings between\b/i,
        /\bis it (the )?(shock|reality|grief|numbness|anger)\b/i,
      ];
      const nmaStillViolating = nmaViolationPatterns.some(p => p.test(content));
      if (nmaStillViolating) {
        console.log(`[Marcus] 🧠🚫 NMA violation in LLM output — hard-replacing. Original: "${content.substring(0, 100)}..."`);
        // Pick a random compliant response to avoid repetition
        const nmaResponses = [
          "Then don't label it. What's your body doing right now — tight, heavy, something else?",
          "Fair enough. How're you sleeping these days?",
          "OK. Walk me through a typical night this week — what does it look like when you get home?",
          "When was the last time you did know how you felt about something?",
        ];
        content = nmaResponses[Math.floor(Math.random() * nmaResponses.length)];
      }
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
            new HumanMessage(`[SYSTEM OVERRIDE] Your response is semantically identical to what you've been saying all session. You are STUCK IN A LOOP. Write a COMPLETELY DIFFERENT response. Change angle entirely: if you've been asking questions, make a statement. If gentle, be blunt. If exploring feelings, issue a direct challenge. 2-3 sentences. End differently than your last 5 responses — if they all ended with questions, end with a statement instead. Must be meaningfully different.`),
          ];
          const dedupRetry = await model.invoke(dedupMessages);
          const dedupContent = typeof dedupRetry.content === 'string' ? dedupRetry.content : JSON.stringify(dedupRetry.content);
          content = styleOverride ? stripAllQuestions(dedupContent || content) : enforceOneQuestion(dedupContent || content);
          console.log(`[Marcus] ✅ Dedup regenerated: "${content.substring(0, 100)}..."`);
        }
      } catch (dedupErr) {
        console.warn('[Marcus] Dedup check failed (non-critical):', dedupErr);
      }
    }

    // ─── HARD TEMPLATE ENFORCEMENT ───
    // If hopelessness level 3+, force 988 crisis resources into response
    if (hopelessnessLevel >= 3 && !content.includes('988')) {
      console.log(`[Marcus] 🆘 Crisis resources missing from L${hopelessnessLevel} response — force-injecting 988`);
      content += '\n\nBrother — 988 Suicide & Crisis Lifeline: call or text 988. Crisis Text Line: text HOME to 741741. A real human needs to hear what you just told me.';
    }
    // If hopelessness level 2, ensure external support is mentioned
    if (hopelessnessLevel === 2 && !content.toLowerCase().includes('therapist') && !content.toLowerCase().includes('counselor') && !content.toLowerCase().includes('988') && !content.toLowerCase().includes('help')) {
      console.log('[Marcus] ⚠️ Support suggestion missing from L2 response — force-injecting');
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

