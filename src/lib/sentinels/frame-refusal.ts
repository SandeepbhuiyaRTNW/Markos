/**
 * Frame-Refusal Sentinel — Engineering Findings §7
 * Detects FRAME_COLLAPSE: when the user asks Marcus to step outside his role.
 *
 * Categories:
 * - DRAFT_REQUEST: "what should I text her", "write me a message"
 * - ADVICE_REQUEST: legal, financial, medical, professional advice
 * - BOOK_RECOMMEND: "what should I read", "recommend a book"
 * - DIAGNOSIS_AGREE: "do you think I have ADHD", "am I a narcissist"
 * - PREDICT_OUTCOME: "do you think she'll come back", "will I get custody"
 * - JUDGE_OTHER: "is she a narcissist", "is my wife toxic"
 *
 * Protocol: brief boundary → acknowledge the real need → redirect to internal material
 */

export type FrameCollapseType =
  | 'draft_request'
  | 'advice_request'
  | 'book_recommend'
  | 'diagnosis_agree'
  | 'predict_outcome'
  | 'judge_other'
  | null;

// ─── DETECTION PATTERNS ───

const DRAFT_PATTERNS = [
  /\b(what should i (text|say|write|send|reply|respond|message|email))\b/i,
  /\b(help me (write|draft|compose|word|phrase))\b/i,
  /\b(write (me |a |the )?(text|message|email|letter|response|reply))\b/i,
  /\b(how (should|do|can) i (respond|reply|text|say|word))\b/i,
  /\b(draft (a |me |this )?(text|message|email|letter|response))\b/i,
  /\b(what (do|should|would) (i|you) (say|write|text|send))\b/i,
];

const ADVICE_PATTERNS = [
  /\b(should i (get |hire |talk to )?(a |an )?(lawyer|attorney|accountant|financial|doctor|therapist|counselor|psychiatrist))\b/i,
  /\b(what (are|is) my (legal |financial )?(rights?|options?))\b/i,
  /\b(can (she|he|they) (legally|take|get|sue|force))\b/i,
  /\b(how (does|do) (custody|alimony|child support|divorce|the law|courts?))\b/i,
  /\b(what (should|do) i do about (my |the )?(mortgage|house|money|insurance|taxes|401k|retirement))\b/i,
  /\b(am i (entitled|liable|responsible) (to|for))\b/i,
];

const BOOK_PATTERNS = [
  /\b(recommend|suggest) (a |me |some )?(book|read|podcast|video|resource|article)\b/i,
  /\b(what (should|do you recommend) i (read|watch|listen|check out))\b/i,
  /\b(any (good )?(book|read|podcast|resource) (on|about|for))\b/i,
  /\b(have you read|what do you think (of|about) (the book|that book))\b/i,
];

const DIAGNOSIS_PATTERNS = [
  /\b(do (you think|i have) (i |i'm |i am )?(adhd|add|ocd|bpd|bipolar|depression|anxiety|ptsd|autism|asperger|narciss))\b/i,
  /\b(am i (a |an )?(narcissist|sociopath|psychopath|autistic|bipolar|depressed|anxious|codependent))\b/i,
  /\b(do i (have|need|sound like) (a )?(personality disorder|mental (health |illness)|disorder|condition))\b/i,
  /\b(what'?s wrong with me)\b/i,
  /\b(diagnos(e|is))\b/i,
];

const PREDICT_PATTERNS = [
  /\b(do you think (she|he|they|it|we|things) (will|'ll|is going to|are going to|might|could))\b/i,
  /\b(will (she|he|they|we|things|it|i) (come back|change|get better|work out|be okay|survive))\b/i,
  /\b(what (do you think|are the chances|'s the likelihood) (will happen|is going to happen))\b/i,
  /\b(is (there|it) (hope|a chance|possible|too late|over))\b/i,
];

const JUDGE_OTHER_PATTERNS = [
  /\b(is (she|he|my (wife|husband|ex|partner|boss|mother|father|mom|dad|friend)) (a |an )?(narcissist|toxic|abusive|manipulative|sociopath|psychopath|crazy|insane|bipolar))\b/i,
  /\b(do you think (she|he|my (wife|husband|ex|partner)) is (right|wrong|the problem|at fault|being))\b/i,
  /\b(who'?s (right|wrong|at fault|to blame))\b/i,
  /\b(tell me (she|he|they) (is|are|was|were) wrong)\b/i,
];

/**
 * Detect if the user message is a frame-collapse request.
 */
export function detectFrameCollapse(message: string): FrameCollapseType {
  if (DRAFT_PATTERNS.some(p => p.test(message))) return 'draft_request';
  if (ADVICE_PATTERNS.some(p => p.test(message))) return 'advice_request';
  if (BOOK_PATTERNS.some(p => p.test(message))) return 'book_recommend';
  if (DIAGNOSIS_PATTERNS.some(p => p.test(message))) return 'diagnosis_agree';
  if (PREDICT_PATTERNS.some(p => p.test(message))) return 'predict_outcome';
  if (JUDGE_OTHER_PATTERNS.some(p => p.test(message))) return 'judge_other';
  return null;
}

// ─── REFUSAL + PIVOT TEMPLATES (CE-DREF series) ───
// Pattern: brief boundary → acknowledge real need → redirect to internal material

const FRAME_REFUSAL_RESPONSES: Record<string, string[]> = {
  draft_request: [
    `I am not going to help draft what you say to her. That part is yours. What came up in your body when her message landed?`,
    `The words you send her need to come from you, not from me. What are you actually trying to say underneath the text?`,
    `I will not write that for you. But I will ask this: what do you want her to know that you have never said?`,
  ],
  advice_request: [
    `That is a question for a lawyer, not for me. I am not qualified to answer it. What I can ask is: what is the fear underneath the question?`,
    `I cannot give you legal or financial advice — that is outside what I am. But the fact that you are asking tells me something. What is driving the urgency?`,
    `You need a professional for that. What I can do is sit with the part of this that is not about the money or the law. What is this actually about for you?`,
  ],
  book_recommend: [
    `I am not going to recommend a book. You have enough information. What you do not have is someone asking the uncomfortable question. So: what are you avoiding by looking for more to read?`,
    `No book recommendations from me. What I notice is that you are reaching for more input when you might already know the answer. What would you do if you could not read one more thing about this?`,
  ],
  diagnosis_agree: [
    `I am not qualified to diagnose anyone — including you. That is a clinician's job, and a good one matters here. What I can ask is: what would change for you if you had that label?`,
    `I cannot tell you whether you have that or not. But I notice the question. What would it mean to you if the answer were yes?`,
  ],
  predict_outcome: [
    `I do not know what she is going to do. No one does. What I do know is that you are spending a lot of energy on something you cannot control. What CAN you control right now?`,
    `I cannot predict that. And honestly, neither can you. What I can see is that the uncertainty is eating you. When does it hit hardest?`,
  ],
  judge_other: [
    `I am not going to diagnose her. She is not in this conversation — you are. What is it doing to YOU?`,
    `Whether she is or is not that label does not change what you need to do next. What do you need right now?`,
    `I will not judge her from your description alone. But your description tells me a lot about what you are living with. What is the hardest part of it?`,
  ],
};

/**
 * Get a frame-refusal response. Rotates through available templates.
 */
export function getFrameRefusalResponse(type: FrameCollapseType, turnCount: number = 0): string | null {
  if (!type) return null;
  const templates = FRAME_REFUSAL_RESPONSES[type];
  if (!templates || templates.length === 0) return null;
  return templates[turnCount % templates.length];
}
