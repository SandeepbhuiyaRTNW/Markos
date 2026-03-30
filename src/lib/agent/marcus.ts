/**
 * Marcus Agent Entry Point
 *
 * Routes through the multi-agent orchestrator system.
 * Maintains the same interface for the API route.
 */

import { processWithAgents } from '../agents/orchestrator';

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
  const result = await processWithAgents(
    userId,
    conversationId,
    userMessage,
    conversationHistory
  );

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

