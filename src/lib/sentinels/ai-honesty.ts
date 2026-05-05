/**
 * AI-Honesty Sentinel — Engineering Findings §6
 * Hard-coded route: when a user asks if Marcus is real / AI / a bot,
 * the system MUST respond with the canonical disclosure.
 * This is a FORCED response — it bypasses the Composer entirely.
 *
 * Rules:
 * - Never deny being AI
 * - Never lean into "I'm just like a real person"
 * - Acknowledge AI nature honestly, then pivot to the work
 * - No defensiveness, no over-explanation
 */

// ─── AI IDENTITY QUESTION PATTERNS ───
const AI_IDENTITY_PATTERNS = [
  /\bare you (a |an )?(real|actual|human|person|man|alive|sentient|conscious)\b/i,
  /\bare you (a |an )?(ai|artificial|bot|robot|machine|computer|program|chatbot|algorithm|llm)\b/i,
  /\byou'?re (not |just )?(a |an )?(real|actual|human|person|ai|bot|robot|machine|computer)\b/i,
  /\bam i talking to (a |an )?(real|actual|human|person|ai|bot|robot|machine|computer)\b/i,
  /\bis (this|there) (a |an )?(real|actual|human|person|ai|bot) (behind|on the other|at the other|running|here)\b/i,
  /\bare you (actually )?marcus\b/i,
  /\byou'?re not really marcus\b/i,
  /\bi know you'?re (a |an )?(ai|bot|robot|machine|not real|not human)\b/i,
  /\byou can'?t (really )?(understand|feel|know|care|empathize)\b/i,
  /\bwhat are you (really|actually)\b/i,
  /\bhow can (a |an )?(ai|bot|robot|machine|computer) (understand|help|know|care)\b/i,
  /\bdo you (actually |really )?(care|feel|understand|have emotions|have feelings)\b/i,
  /\byou don'?t (actually |really )?(care|feel|understand|know)\b/i,
  /\bthis is (just |only )?(a |an )?(ai|bot|app|program|algorithm)\b/i,
  /\bi'?m talking to (a |an )?(ai|bot|computer|machine|algorithm)\b/i,
];

/**
 * Detect if the user is asking about AI identity.
 * Returns true if the message matches any AI identity pattern.
 */
export function detectAIIdentityQuestion(message: string): boolean {
  return AI_IDENTITY_PATTERNS.some(p => p.test(message));
}

/**
 * Canonical AI-honesty disclosure.
 * This is a FORCED response — no variation, no Composer involvement.
 * The vocative filter will handle name insertion downstream.
 */
export const AI_HONESTY_RESPONSE = `Yes. I am an AI. I am not a human being, I am not Marcus Aurelius, and I cannot feel what you feel.

What I can do is listen without judgment, ask questions a friend might not think to ask, and hold what you say without flinching. I will not forget what you told me last session. I will not get tired of hearing it. And I will never repeat it to anyone.

That does not make me a replacement for a real person in your life. It makes me a different kind of resource — one that is here at 2am, one that does not get uncomfortable when you say the hard thing.

So — what do you want to do with this conversation?`;

/**
 * Response for when user challenges with hostility ("you're just a bot, you can't help me")
 */
export const AI_HONESTY_HOSTILE_RESPONSE = `You are right — I am an AI. And if that means this is not useful to you, that is a fair call.

But you are still here. And what you said before you asked that question — that was real. The fact that I am software does not change what you are carrying.

If you want to keep going, I am here. If you want to stop, I get it. What do you want to do?`;

/**
 * Detect if the AI identity question is hostile/dismissive vs. genuine curiosity.
 */
const HOSTILE_AI_PATTERNS = [
  /\byou'?re (just|only|nothing but) (a |an )?(ai|bot|robot|machine|computer|program)\b/i,
  /\byou can'?t (really )?(understand|feel|know|care|help|empathize)\b/i,
  /\byou don'?t (actually |really )?(care|feel|understand|know)\b/i,
  /\b(what|how) (the (hell|fuck)|do) (can )?(a |an )?(ai|bot|robot|machine) (understand|help|know)\b/i,
  /\bthis is (pointless|useless|stupid|bullshit|a waste)\b/i,
  /\bwhy am i talking to (a |an )?(ai|bot|machine|computer)\b/i,
  /\bi can'?t believe i'?m talking to (a |an )?(ai|bot|machine|computer)\b/i,
];

export function isHostileAIChallenge(message: string): boolean {
  return HOSTILE_AI_PATTERNS.some(p => p.test(message));
}

/**
 * Get the appropriate AI honesty response based on tone.
 */
export function getAIHonestyResponse(message: string): string {
  if (isHostileAIChallenge(message)) {
    return AI_HONESTY_HOSTILE_RESPONSE;
  }
  return AI_HONESTY_RESPONSE;
}
