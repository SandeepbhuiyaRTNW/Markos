/**
 * Marcus Agent Entry Point
 *
 * Routes through the V2 multi-agent orchestrator system (6-tier architecture).
 * Maintains the same interface for the API route.
 * Fallback: if V2 fails, falls back to V1 orchestrator.
 */

import { processWithAgents } from '../agents/orchestrator-v2';
import { processWithAgents as processWithAgentsV1 } from '../agents/orchestrator';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function processMessage(
  userId: string,
  conversationId: string,
  userMessage: string,
  conversationHistory: ConversationMessage[]
): Promise<{
  response: string;
  emotion: string;
  kwmlArchetype: string;
  agentTimings: Record<string, number>;
  errors: Array<{ agent: string; error: string }>;
}> {
  let result;
  try {
    result = await processWithAgents(
      userId,
      conversationId,
      userMessage,
      conversationHistory
    );
    console.log('[Marcus V2] Turn complete.');
  } catch (v2Error) {
    console.error('[Marcus V2] Orchestrator failed, falling back to V1:', v2Error);
    result = await processWithAgentsV1(
      userId,
      conversationId,
      userMessage,
      conversationHistory
    );
  }

  // Log agent timings for monitoring
  if (Object.keys(result.agentTimings).length > 0) {
    console.log('[Marcus] Agent timings:', result.agentTimings);
  }
  if (result.errors.length > 0) {
    console.warn('[Marcus] Agent errors:', result.errors);
  }

  return {
    response: result.response,
    emotion: result.emotion,
    kwmlArchetype: result.kwmlArchetype,
    agentTimings: result.agentTimings,
    errors: result.errors,
  };
}

