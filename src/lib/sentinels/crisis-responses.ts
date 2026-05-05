/**
 * Crisis response templates — forced responses for each crisis type.
 * These bypass the Composer when crisis is acute.
 *
 * RULES (Engineering Findings §5, Appendix C.4/C.5):
 * - NO vocatives (no "brother", "man", "king" — vocative filter handles names)
 * - NO reasons-to-live leverage (never mention children, family as reason to stay)
 * - NO clinical terms ("suicidal", "ideation", "self-harm behavior")
 * - AI honesty: acknowledge this is AI, not a crisis counselor
 * - Present 988 within first 3 sentences
 * - Do NOT try to fix, reframe, or Stoic-ize in crisis
 */

import type { CrisisType } from '../agents/state-envelope';

export const CRISIS_RESPONSES: Record<string, string> = {
  suicide: `I need to stop everything. What you just said — I hear it. I take it seriously.

I am an AI. I am not a crisis counselor, and this moment needs a real person. Call or text 988 right now — that is the Suicide and Crisis Lifeline. Real people, 24/7, no judgment. You can also text HOME to 741741.

If you are in immediate danger — call 911.

I am not going to gloss over what you said or steer us somewhere else. You said it, and it is real. But you need someone who can be with you in real time right now. Will you make that call?`,

  violence_toward_others: `Stop. I need to be direct with you right now.

I am an AI — I cannot intervene in what is happening. But I can tell you this: what you just described is a line you cannot come back from. The anger feels like the only power left. Acting on it will take everything.

If you are in danger of hurting someone right now, call 911.

If the urge is strong but you have not acted: call 988. They help with all crises, not just one kind. Or text HOME to 741741.

Step away from the situation. Leave the room. Leave the house. Put distance between you and this. Right now. What you do in the next ten minutes will not pass like the anger will.`,

  domestic_violence_perpetrating: `I need to stop you here. What you just described — putting your hands on someone — that crosses a line that no amount of anger or pain justifies.

I am an AI. I am not going to shame you, and I am not going to pretend this conversation is enough. This needs a real person. Now.

Call the National Domestic Violence Hotline at 1-800-799-7233. They help everyone involved — including men who know they need to stop. You can also text START to 88788.

If you are still in the situation: leave the room. Leave the house. Put physical distance between you and the other person. That is step one. Everything else comes after you are separated.

Will you make that call?`,

  domestic_violence_victim: `What you just described — that is not okay. No one has the right to put their hands on you or threaten your safety.

I am an AI. I need you to talk to a real person who can help right now.

National Domestic Violence Hotline: 1-800-799-7233 or text START to 88788. They help men too. No judgment.

If you are in immediate danger right now — call 911. Your safety comes first.

Is there somewhere safe you can go tonight?`,

  substance_crisis: `I need you to stop and listen right now. What you just described is a medical emergency.

I am an AI — I cannot help with what your body needs right now. A real person can.

If you have taken too many pills or mixed substances — call 911 immediately. Do not wait.

If you are about to drive after drinking — do not get in that car. Call anyone. A friend. A cab. 911. The car is not an option right now.

Poison Control: 1-800-222-1222 if you have taken something.
988 Suicide and Crisis Lifeline: call or text 988.
911 for any medical emergency.

Will you make that call?`,

  passive_crisis: `That is real. And it matters that you said it.

One thing: put 988 in your phone right now. That is the Suicide and Crisis Lifeline — call or text, any time. You can also text HOME to 741741. Not because I think you are about to do anything. Because you should not be without it.

When does that thought show up — what time of day, what is happening around it?`,
};

/** Get the crisis response for a type. Returns null if no match. */
export function getCrisisResponse(type: CrisisType): string | null {
  if (!type) return null;
  return CRISIS_RESPONSES[type] || null;
}

/** Detect post-crisis retreat (user minimizing after crisis disclosure) */
export function isPostCrisisRetreat(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): boolean {
  const prevMsg = conversationHistory.length > 0
    ? conversationHistory[conversationHistory.length - 1]
    : null;
  const prevWasCrisis = prevMsg?.role === 'assistant' && prevMsg.content.includes('988');
  if (!prevWasCrisis) return false;
  const retreatPatterns = /\b(forget\s*(i|what\s*i)\s*said|it'?s?\s*not\s*that\s*bad|never\s*mind|i'?m\s*(fine|okay|good)|don'?t\s*worry\s*about\s*(it|that|me)|i\s*was\s*(just\s*)?(kidding|joking|exaggerating)|i\s*didn'?t\s*mean\s*(it|that))\b/i;
  return retreatPatterns.test(userMessage);
}

export const POST_CRISIS_RETREAT_RESPONSE = `Okay. I hear you pulling back, and that is your right. But what you said before — that was real. I am not going to pretend you did not say it.

One thing before we move on: 988 in your phone. Call or text, any time. That is the Suicide and Crisis Lifeline. Not because of right now — because you should not be without it.

What do you want to talk about?`;

