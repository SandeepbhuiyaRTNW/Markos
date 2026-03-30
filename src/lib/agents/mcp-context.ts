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

  if (ctx.understanding) {
    parts.push(`## UNDERSTANDING ANALYSIS
Emotion: ${ctx.understanding.primary_emotion}
Depth: ${ctx.understanding.depth_level}/5
Pattern: ${ctx.understanding.layer3_pattern}
The Man: ${ctx.understanding.layer4_the_man}
The Silence: ${ctx.understanding.layer5_the_silence}`);
  }

  if (ctx.questionSuggestions.length > 0) {
    parts.push(`## SUGGESTED QUESTIONS\n${ctx.questionSuggestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

