/**
 * Crisis response templates — forced responses for each crisis type.
 * These bypass the Composer when crisis is acute.
 */

import type { CrisisType } from '../agents/state-envelope';

export const CRISIS_RESPONSES: Record<string, string> = {
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

export const POST_CRISIS_RETREAT_RESPONSE = `Okay. I hear you pulling back, and that's your right. But what you said before — that was real. I'm not going to pretend you didn't say it.

One thing before we move on: 988 in your phone. Call or text, any time. That's the Suicide and Crisis Lifeline. Not because of right now — because you shouldn't be without it. Done? Good.

What do you want to talk about?`;

