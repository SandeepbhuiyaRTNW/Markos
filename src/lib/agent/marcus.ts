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
  turnId?: string;
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

  // A turn_logs row is written ONLY on the composer path (logTurn is composer-
  // only). Sentinel-forced responses — acute crisis, post-crisis-retreat,
  // AI-honesty, frame-refusal — return before the composer runs and write no
  // row. We must NOT hand the route a turnId for them, or recordRouteTotal's
  // UPDATE matches zero rows and fires a false "insert ordering regressed"
  // warning (routine on frame-refusal). The composer timing bucket is set in
  // its `finally`, so it is present on EVERY composer path (success or error)
  // and absent on every sentinel bypass — a reliable "a row was written" marker.
  // Genuine regressions (composer ran but logTurn failed to insert) still
  // surface the warning, because turnId is returned and the row is missing.
  const envelope = (result as {
    envelope?: { turn_id?: string; agent_timings?: Record<string, number> };
  }).envelope;
  const composerRan = envelope?.agent_timings?.['composer'] !== undefined;

  return {
    response: result.response,
    emotion: result.emotion,
    kwmlArchetype: result.kwmlArchetype,
    agentTimings: result.agentTimings,
    errors: result.errors,
    // turn_id of the row the V2 Composer logs. Returned only when the composer
    // actually ran (and logged); undefined on V1 fallback and sentinel bypass.
    turnId: composerRan ? envelope?.turn_id : undefined,
  };
}

