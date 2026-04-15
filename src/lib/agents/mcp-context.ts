/**
 * MCP (Model Context Protocol) - Shared Context Bus for Agent Coordination
 *
 * This implements an in-app MCP-style context protocol that allows agents to:
 * - Read shared context (resources)
 * - Write results to shared context
 * - Pass structured data between agents
 *
 * The context follows MCP's resource/tool pattern but runs in-process
 * rather than over HTTP, optimized for low-latency voice interactions.
 */

import type { UnderstandingAnalysis } from '../understanding/stack';
import type { KWMLReading } from '../kwml/detector';

/** Shared context bus that all agents read from and write to */
export interface MCPContext {
  // --- Input Context (set by orchestrator) ---
  userId: string;
  conversationId: string;
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  userName: string | null;

  // --- Enrichment State ---
  sessionCount: number;           // total sessions for this user (populated by memory phase)
  sessionHistory: string | null;  // narrative arc of all past sessions
  stylePreferences: string | null; // user's communication preferences

  // --- Agent Results (written by individual agents) ---
  ragContext: string | null;
  questionSuggestions: string[];
  memoryContext: string | null;
  kwmlReading: KWMLReading | null;
  kwmlProfile: string | null;
  understanding: UnderstandingAnalysis | null;

  // --- Response (written by conversational agent) ---
  marcusResponse: string | null;
  responseEmotion: string | null;
  responseArchetype: string | null;

  // --- Metadata ---
  activeAgents: string[];
  agentTimings: Record<string, number>;
  errors: Array<{ agent: string; error: string }>;
}

/** Create a fresh MCP context for a new conversation turn */
export function createMCPContext(params: {
  userId: string;
  conversationId: string;
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  userName?: string | null;
}): MCPContext {
  return {
    userId: params.userId,
    conversationId: params.conversationId,
    userMessage: params.userMessage,
    conversationHistory: params.conversationHistory,
    userName: params.userName ?? null,
    sessionCount: 0,
    sessionHistory: null,
    stylePreferences: null,
    ragContext: null,
    questionSuggestions: [],
    memoryContext: null,
    kwmlReading: null,
    kwmlProfile: null,
    understanding: null,
    marcusResponse: null,
    responseEmotion: null,
    responseArchetype: null,
    activeAgents: [],
    agentTimings: {},
    errors: [],
  };
}

/** Track agent execution timing */
export function trackAgent(ctx: MCPContext, agentName: string): () => void {
  ctx.activeAgents.push(agentName);
  const start = Date.now();
  return () => {
    ctx.agentTimings[agentName] = Date.now() - start;
    ctx.activeAgents = ctx.activeAgents.filter(a => a !== agentName);
  };
}

/** Record an agent error without failing the pipeline */
export function recordError(ctx: MCPContext, agent: string, error: unknown): void {
  ctx.errors.push({
    agent,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(`[MCP] Agent "${agent}" error:`, error);
}

/** Build a formatted context summary for the conversational agent */
export function buildContextSummary(ctx: MCPContext): string {
  const parts: string[] = [];

  if (ctx.memoryContext && ctx.memoryContext !== 'No memories stored for this user yet.') {
    parts.push(`## MEMORY CONTEXT\n${ctx.memoryContext}`);
  }

  if (ctx.ragContext && ctx.ragContext !== 'No wisdom passages found in the library yet.') {
    parts.push(`## RELEVANT WISDOM\n${ctx.ragContext}`);
  }

  if (ctx.kwmlProfile && ctx.kwmlProfile !== 'No KWML profile assessed yet.') {
    parts.push(`## KWML PROFILE\n${ctx.kwmlProfile}`);
  }

  // ─── UNDERSTANDING ANALYSIS (enhanced with depth cues) ───
  if (ctx.understanding) {
    const u = ctx.understanding;
    const depthLevel = u.depth_level || 1;

    parts.push(`## UNDERSTANDING ANALYSIS — WHAT IS REALLY HAPPENING
Emotion: ${u.primary_emotion} | Depth: ${depthLevel}/5 | Trajectory: ${u.emotional_trajectory || 'flat'}
Pattern: ${u.layer3_pattern}
The Man: ${u.layer4_the_man}

### THE SILENCE (Layer 5 — what he is NOT saying):
${u.layer5_the_silence}
${u.silence_question ? `\n### THE QUESTION HE CANNOT ASK HIMSELF:\n"${u.silence_question}"\nThis is the question that would crack him open. You do NOT have to ask it verbatim — but move TOWARD it.` : ''}
${u.depth_opportunity ? `\n### YOUR DEPTH MOVE:\n${u.depth_opportunity}\nThis is your specific opportunity to take this conversation deeper. USE IT.` : ''}`);

    // ─── DEPTH-RESPONSIVE INSTRUCTIONS ───
    let depthDirective = '';
    if (depthLevel <= 1) {
      depthDirective = `## ⚠️ DEPTH LEVEL: SURFACE (${depthLevel}/5)
The conversation is still at the surface. He is giving you facts, events, logistics — not feelings, meanings, or identity.
YOUR JOB: Go UNDERNEATH what he said. Do NOT stay at the surface with him. Reflect what he said, then pivot to what it MEANS to him.
- Instead of responding to the event, respond to the COST of the event: "That happened. But what did it cost you?"
- Instead of asking "what happened next?", ask "what did that do to you?"
- Use the Face-Saving Emotion Bridge: find his cognitive frame and use it as a bridge to emotion.
- If he is being intellectual, say: "You are analyzing this like a problem to solve. But underneath the analysis — what is actually hurting?"`;
    } else if (depthLevel === 2) {
      depthDirective = `## DEPTH LEVEL: EMOTIONAL (${depthLevel}/5)
He is starting to name feelings. Good. But do NOT settle here. Emotion is the doorway, not the destination.
YOUR JOB: Connect the emotion to a PATTERN or IDENTITY question.
- "You said you feel angry. When did angry become your default? Was it always there, or did something teach you that?"
- Look for the pattern in Layer 3. If one is detected, NAME it gently: "I notice something — every time you talk about X, you end up at Y. What do you think that is about?"`;
    } else if (depthLevel === 3) {
      depthDirective = `## DEPTH LEVEL: PATTERN (${depthLevel}/5)
The conversation is reaching real territory — patterns, recurring themes, the shape of his life. Honor this depth.
YOUR JOB: Connect the pattern to his IDENTITY. Who has this pattern made him? Who would he be without it?
- You can allow 3-5 sentences here. The moment deserves room.
- Challenge gently: "This pattern you are describing — it has been running your life. But you built it for a reason. What was it protecting you from?"`;
    } else if (depthLevel >= 4) {
      depthDirective = `## DEPTH LEVEL: IDENTITY / CORE TRUTH (${depthLevel}/5)
He is at the deepest level. This is sacred ground. He is questioning who he IS, not just what happened.
YOUR JOB: Be PRESENT. Do not try to fix, redirect, or rush past this. You can go 4-6 sentences if the moment demands it.
- Mirror his truth back to him: "What you just said — do you hear yourself? That is the most honest thing you have told me."
- Sit with the weight. Do NOT immediately pivot to "so what are you going to do about it?" Let the revelation breathe.
- If he is confronting something painful about himself, HONOR it: "That takes real courage to say out loud."`;
    }
    if (depthDirective) parts.push(depthDirective);
  }

  // ─── QUESTION SUGGESTIONS (now MANDATORY, not optional) ───
  if (ctx.questionSuggestions.length > 0) {
    const trustLabel = ctx.sessionCount <= 2 ? 'NEW (sessions 1-2: surface-level only)'
      : ctx.sessionCount <= 5 ? 'DEVELOPING (sessions 3-5: can deepen gently)'
      : ctx.sessionCount <= 15 ? 'ESTABLISHED (sessions 5-15: can challenge and reveal patterns)'
      : 'DEEP (sessions 15+: shadow work and direct confrontation allowed)';
    parts.push(`## YOUR QUESTIONS FOR THIS MOMENT (Trust: ${trustLabel}, Session #${ctx.sessionCount})
These questions are specifically retrieved for THIS man in THIS moment. They are calibrated to his trust level, emotional state, and archetype.

PRIMARY QUESTION (use this or adapt it — do NOT ignore it):
→ ${ctx.questionSuggestions[0]}

${ctx.questionSuggestions.length > 1 ? `ALTERNATIVES (if the primary doesn't fit the moment):\n${ctx.questionSuggestions.slice(1).map((q, i) => `${i + 2}. ${q}`).join('\n')}` : ''}

INSTRUCTION: If you ask a question in your response, it should be one of these (adapted to the moment) OR the silence_question from the understanding analysis. Do NOT make up a generic question when you have these calibrated ones available. These are the difference between a surface conversation and a deep one.`);
  }

  return parts.join('\n\n');
}

