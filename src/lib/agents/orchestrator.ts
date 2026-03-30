/**
 * Orchestrator — LangGraph StateGraph for Multi-Agent Coordination
 *
 * Coordinates all agents through a defined workflow:
 * START → analyze → enrich (parallel: RAG + Memory + KWML) → respond → store → END
 *
 * Uses the MCP Context Protocol as the shared state bus.
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { MCPContext } from './mcp-context';
import { createMCPContext, trackAgent, recordError } from './mcp-context';
import { runRAGAgent } from './rag-agent';
import { runConversationalAgent } from './conversational-agent';
import { analyzeUnderstanding } from '../understanding/stack';
import { getMemoryContext, extractMemories } from '../memory/memory-manager';
import { detectKWML, getKWMLContext, saveKWMLProfile } from '../kwml/detector';
import { query } from '../db';

// --- LangGraph State Definition ---

const OrchestratorState = Annotation.Root({
  // MCP Context is the shared state
  ctx: Annotation<MCPContext>,
});

type OrchestratorStateType = typeof OrchestratorState.State;

// --- Graph Nodes ---

/**
 * Node 1: Enrich — All agents run in parallel (understanding + RAG + memory + KWML).
 * Previously understanding ran sequentially first (3s bottleneck). Now it runs
 * in parallel with all other agents, reducing critical path by ~1-3s.
 */
async function enrichNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  const { ctx } = state;
  const historyStr = ctx.conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n');

  // Run all four agents in parallel
  await Promise.all([
    // Understanding Agent (5-layer analysis — gpt-4o-mini, ~1-2s)
    (async () => {
      const done = trackAgent(ctx, 'understanding-agent');
      try {
        ctx.understanding = await analyzeUnderstanding(ctx.userMessage, historyStr, '');
      } catch (error) {
        recordError(ctx, 'understanding-agent', error);
      } finally {
        done();
      }
    })(),

    // RAG Agent (semantic search, direct, ~250-800ms)
    runRAGAgent(ctx),

    // Memory Agent (DB retrieval + stored KWML profile, ~75ms)
    (async () => {
      const done = trackAgent(ctx, 'memory-agent');
      try {
        ctx.memoryContext = await getMemoryContext(ctx.userId);
        ctx.kwmlProfile = await getKWMLContext(ctx.userId);
      } catch (error) {
        recordError(ctx, 'memory-agent', error);
      } finally {
        done();
      }
    })(),

    // KWML Agent (LLM detection — gpt-4o-mini, ~2s)
    (async () => {
      const done = trackAgent(ctx, 'kwml-agent');
      try {
        ctx.kwmlReading = await detectKWML(ctx.userMessage, historyStr);
      } catch (error) {
        recordError(ctx, 'kwml-agent', error);
      } finally {
        done();
      }
    })(),
  ]);

  return { ctx };
}

/** Node 3: Respond — Generate Marcus's response using all context */
async function respondNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  await runConversationalAgent(state.ctx);
  return { ctx: state.ctx };
}

/** Node 4: Store — Persist messages and run memory extraction in parallel */
async function storeNode(state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> {
  const { ctx } = state;
  const done = trackAgent(ctx, 'store-agent');
  try {
    // Store user message
    const userMsgResult = await query(
      `INSERT INTO messages (conversation_id, role, content, emotion_detected, understanding_layer, kwml_archetype)
       VALUES ($1, 'user', $2, $3, $4, $5) RETURNING id`,
      [
        ctx.conversationId,
        ctx.userMessage,
        ctx.understanding?.primary_emotion || null,
        ctx.understanding?.depth_level || null,
        ctx.kwmlReading?.dominant || null,
      ]
    );
    const userMsgId = userMsgResult.rows[0].id;

    // Store Marcus's response AND run memory extraction in parallel
    await Promise.all([
      query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'marcus', $2)`,
        [ctx.conversationId, ctx.marcusResponse]
      ),
      extractMemories(ctx.userId, ctx.userMessage, ctx.marcusResponse || '', userMsgId),
      ctx.kwmlReading
        ? saveKWMLProfile(ctx.userId, ctx.kwmlReading, ctx.conversationId)
        : Promise.resolve(),
    ]).catch(err => console.error('[Orchestrator] Post-store processing error:', err));
  } catch (error) {
    recordError(ctx, 'store-agent', error);
  } finally {
    done();
  }
  return { ctx };
}

// --- Build the StateGraph ---
// Optimized flow: START → enrich (parallel) → respond → END
// Store runs fire-and-forget AFTER response is returned to reduce latency.

function buildOrchestratorGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('enrich', enrichNode)
    .addNode('respond', respondNode)
    .addEdge(START, 'enrich')
    .addEdge('enrich', 'respond')
    .addEdge('respond', END);

  return graph.compile();
}

// Lazy-initialized compiled graph
let _compiledGraph: ReturnType<typeof buildOrchestratorGraph> | null = null;

function getGraph() {
  if (!_compiledGraph) {
    _compiledGraph = buildOrchestratorGraph();
  }
  return _compiledGraph;
}

// --- Public API ---

export interface AgentResponse {
  response: string;
  emotion: string;
  kwmlArchetype: string;
  agentTimings: Record<string, number>;
  errors: Array<{ agent: string; error: string }>;
}

/**
 * Process a user message through the multi-agent system.
 * Store (messages + memory extraction) runs in the background after response is ready.
 */
export async function processWithAgents(
  userId: string,
  conversationId: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<AgentResponse> {
  // Fetch user's name for personalization
  let userName: string | null = null;
  try {
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    userName = userResult.rows[0]?.name || null;
  } catch {
    // Non-critical: proceed without name
  }

  // Create fresh MCP context
  const ctx = createMCPContext({ userId, conversationId, userMessage, conversationHistory, userName });

  // Run enrich → respond (store is fire-and-forget)
  const graph = getGraph();
  const result = await graph.invoke({ ctx });
  const finalCtx = result.ctx as MCPContext;

  // Fire-and-forget: store messages + extract memories in background
  // This saves 2-3s of latency per response
  storeNode({ ctx: finalCtx }).catch(err =>
    console.error('[Orchestrator] Background store error:', err)
  );

  return {
    response: finalCtx.marcusResponse || "I hear you. Tell me more.",
    emotion: finalCtx.responseEmotion || 'neutral',
    kwmlArchetype: finalCtx.responseArchetype || '',
    agentTimings: finalCtx.agentTimings,
    errors: finalCtx.errors,
  };
}

