/**
 * Turn timing instrumentation — one grep-able line per stage per turn, matching the
 * [turn-persist] format. Reuses values already measured by the pipeline
 * (env.agent_timings, returned to the route as `agentTimings`) plus thin Date.now()
 * spans in the route handlers, so it adds no meaningful latency of its own.
 *
 * Aggregate in CloudWatch Logs Insights, e.g.:
 *   filter @message like /\[turn-timing\]/
 *   | parse @message "stage=* ms=* path=* turn=*" as stage, ms, path, turn
 *   | stats avg(ms), pct(ms, 95), max(ms), count() by stage, path, turn
 *   | sort by avg(ms) desc
 */

export type TurnPath = 'voice' | 'text' | 'unknown';

export interface TurnTimingCtx {
  path: TurnPath;
  turn: 'first' | 'subsequent';
  conversationId: string;
}

/** Emit one timing line. Format mirrors [turn-persist] (space-separated key=value). */
export function emitTurnTiming(stage: string, ms: number, ctx: TurnTimingCtx): void {
  console.log(
    `[turn-timing] stage=${stage} ms=${ms} path=${ctx.path} turn=${ctx.turn} conversation_id=${ctx.conversationId}`,
  );
}

/**
 * Emit one line per already-measured agent stage (env.agent_timings, returned to the
 * route as `agentTimings`). NOTE: several of these stages run CONCURRENTLY inside the
 * orchestrator (e.g. listener-stack / kwml-agent / arena-classifier; domain-whisperers
 * / rag-retrieval), so their durations OVERLAP and must not be summed — use the
 * route-level `agent` line for wall-clock. Values are pre-measured; emitting is free.
 */
export function emitAgentTimings(agentTimings: Record<string, number>, ctx: TurnTimingCtx): void {
  for (const [stage, ms] of Object.entries(agentTimings)) emitTurnTiming(`agent:${stage}`, ms, ctx);
}

/** Time an awaited stage and emit its wall-clock duration (used by the route handlers). */
export async function timeStage<T>(stage: string, ctx: TurnTimingCtx, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emitTurnTiming(stage, Date.now() - start, ctx);
  }
}

/**
 * Tap an audio ReadableStream on its way to the client: emit `tts_first_byte` when the
 * first chunk arrives (time-to-first-audio) and `tts_complete` when synthesis finishes,
 * measured from `startMs`. On a mid-stream break it emits `tts_error`, logs loudly with
 * the session id, and ERRORS the outbound stream so the client sees a broken body and
 * can recover — never a silently-truncated reply. Adds no latency: it just forwards
 * bytes through as they pass.
 */
export function instrumentAudioStream(
  source: ReadableStream<Uint8Array>,
  ctx: TurnTimingCtx,
  startMs: number,
): ReadableStream<Uint8Array> {
  let firstByteSeen = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstByteSeen && value && value.byteLength) {
            firstByteSeen = true;
            emitTurnTiming('tts_first_byte', Date.now() - startMs, ctx);
          }
          controller.enqueue(value);
        }
        emitTurnTiming('tts_complete', Date.now() - startMs, ctx);
        controller.close();
      } catch (err) {
        emitTurnTiming('tts_error', Date.now() - startMs, ctx);
        console.error(`[tts-stream] ElevenLabs stream broke mid-flight — conversation_id=${ctx.conversationId}:`, err);
        controller.error(err instanceof Error ? err : new Error(String(err)));
      } finally {
        try { reader?.releaseLock(); } catch { /* ignore */ }
        reader = null;
      }
    },
    cancel(reason) {
      // Client disconnected / stopped playback — stop reading upstream so ElevenLabs
      // can close the connection (and stop billing) rather than draining to /dev/null.
      void reader?.cancel(reason);
    },
  });
}
