/**
 * Latency analysis over turn_logs.agent_timings.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/analyze-latency.ts [--days 7] [--limit 5000]
 *   (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, same as src/lib/db.ts)
 *
 * Reports:
 *   - p50/p95 measured total turn time (turn_logs.total_ms) when present,
 *     else a reconstructed critical-path sum (see below)
 *   - p50/p95 per tracked agent/tier
 *   - % of turns that triggered a post-generation regeneration, broken down by
 *     which check fired (turn_logs.regen_triggers); older rows without that
 *     column fall back to boundary_violations
 *   - top 3 slowest stages by p95
 *
 * total_ms (added by migrate-turn-logs-latency.sql) is the measured wall-clock
 * of the agent pipeline. For rows predating it, total is reconstructed from the
 * orchestrator stage graph (post-parallelization: arena runs with the Tier-1
 * LLMs, and rag-retrieval runs concurrently with the whisperers):
 *   memory-sentinel → max(listener-stack, kwml-agent, arena-classifier)
 *   → assessment-ring → max(domain-whisperers, rag-retrieval) → composer
 * Both exclude route-level STT/TTS/DB, which are not instrumented.
 */
import { Pool } from 'pg';

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    };

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

async function main() {
  const days = arg('days', 7);
  const limit = arg('limit', 5000);
  const pool = new Pool(poolConfig);

  // total_ms / regen_triggers may not exist yet (pre-migration); select defensively.
  const hasLatencyCols = await pool
    .query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'turn_logs' AND column_name = 'total_ms'`)
    .then(r => r.rows.length > 0)
    .catch(() => false);

  const res = await pool.query(
    `SELECT agent_timings, boundary_violations, errors, crisis_level
            ${hasLatencyCols ? ', total_ms, regen_triggers' : ''}
     FROM turn_logs
     WHERE timestamp > NOW() - ($1 || ' days')::interval
       AND agent_timings IS NOT NULL
     ORDER BY timestamp DESC
     LIMIT $2`,
    [String(days), limit],
  );

  const rows = res.rows as Array<{
    agent_timings: Record<string, number> | string;
    boundary_violations: string[] | null;
    errors: unknown[] | string | null;
    crisis_level: string | null;
    total_ms?: number | null;
    regen_triggers?: string[] | null;
  }>;

  if (rows.length === 0) {
    console.log(`No turn_logs rows with agent_timings in the last ${days} days.`);
    await pool.end();
    return;
  }

  const perAgent: Record<string, number[]> = {};
  const measuredTotals: number[] = [];
  const reconTotals: number[] = [];
  const regenTriggerCounts: Record<string, number> = {};
  let regenTurns = 0;
  let errorTurns = 0;
  let composerTurns = 0; // turns that reached the composer (not sentinel-intercepted)

  for (const row of rows) {
    const t: Record<string, number> =
      typeof row.agent_timings === 'string' ? JSON.parse(row.agent_timings) : row.agent_timings || {};

    for (const [agent, ms] of Object.entries(t)) {
      if (typeof ms !== 'number' || !isFinite(ms)) continue;
      (perAgent[agent] ||= []).push(ms);
    }

    // Reconstructed critical path per the (post-parallelization) stage graph.
    // Missing stages count 0 (sentinel-intercepted turns have few/no stages).
    const recon =
      (t['memory-sentinel'] || 0) +
      Math.max(t['listener-stack'] || 0, t['kwml-agent'] || 0, t['arena-classifier'] || 0) +
      (t['assessment-ring'] || 0) +
      Math.max(t['domain-whisperers'] || 0, t['rag-retrieval'] || 0) +
      (t['composer'] || 0);
    if (recon > 0) reconTotals.push(recon);
    if (typeof row.total_ms === 'number' && row.total_ms > 0) measuredTotals.push(row.total_ms);
    if (t['composer']) composerTurns++;

    // Regeneration accounting: prefer the persisted trigger list; fall back to
    // boundary_violations for rows predating the regen_triggers column.
    const triggers = Array.isArray(row.regen_triggers) ? row.regen_triggers : [];
    if (triggers.length > 0) {
      regenTurns++;
      for (const tr of triggers) regenTriggerCounts[tr] = (regenTriggerCounts[tr] || 0) + 1;
    } else if (row.regen_triggers === undefined && Array.isArray(row.boundary_violations) && row.boundary_violations.length > 0) {
      regenTurns++;
      regenTriggerCounts['boundary (legacy)'] = (regenTriggerCounts['boundary (legacy)'] || 0) + 1;
    }

    const errs = typeof row.errors === 'string' ? JSON.parse(row.errors) : row.errors;
    if (Array.isArray(errs) && errs.length > 0) errorTurns++;
  }

  measuredTotals.sort((a, b) => a - b);
  reconTotals.sort((a, b) => a - b);

  console.log(`\n=== Turn latency analysis (last ${days} days, ${rows.length} turns) ===\n`);
  console.log(`Turns reaching the composer: ${composerTurns} (${((composerTurns / rows.length) * 100).toFixed(1)}%)`);
  if (measuredTotals.length > 0) {
    console.log(`Measured total (total_ms, excl. STT/TTS/route): p50 ${fmt(percentile(measuredTotals, 50))}  p95 ${fmt(percentile(measuredTotals, 95))}  (n=${measuredTotals.length})`);
  } else {
    console.log(`Measured total: none yet (run migrate-turn-logs-latency.sql, then collect turns).`);
  }
  console.log(`Reconstructed total (critical path):            p50 ${fmt(percentile(reconTotals, 50))}  p95 ${fmt(percentile(reconTotals, 95))}  (n=${reconTotals.length})`);
  console.log(`Turns with a regeneration: ${regenTurns} (${((regenTurns / rows.length) * 100).toFixed(1)}%)`);
  for (const [trigger, count] of Object.entries(regenTriggerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${trigger.padEnd(20)} ${count} (${((count / rows.length) * 100).toFixed(1)}% of turns)`);
  }
  console.log(`Turns with agent errors: ${errorTurns} (${((errorTurns / rows.length) * 100).toFixed(1)}%)`);

  console.log(`\nPer-agent timings:`);
  console.log(`  ${'agent'.padEnd(22)} ${'n'.padStart(6)} ${'p50'.padStart(9)} ${'p95'.padStart(9)} ${'max'.padStart(9)}`);
  const stats = Object.entries(perAgent).map(([agent, arr]) => {
    arr.sort((a, b) => a - b);
    return { agent, n: arr.length, p50: percentile(arr, 50), p95: percentile(arr, 95), max: arr[arr.length - 1] };
  });
  stats.sort((a, b) => b.p95 - a.p95);
  for (const s of stats) {
    console.log(`  ${s.agent.padEnd(22)} ${String(s.n).padStart(6)} ${fmt(s.p50).padStart(9)} ${fmt(s.p95).padStart(9)} ${fmt(s.max).padStart(9)}`);
  }

  console.log(`\nTop 3 slowest stages by p95:`);
  stats.slice(0, 3).forEach((s, i) => console.log(`  ${i + 1}. ${s.agent} — p95 ${fmt(s.p95)} (p50 ${fmt(s.p50)})`));

  console.log(`\nNot instrumented (invisible to turn_logs): Whisper STT, ElevenLabs TTS,`);
  console.log(`and route-level DB queries. total_ms covers the agent pipeline only;`);
  console.log(`instrument the route to capture STT/TTS end-to-end.`);

  await pool.end();
}

main().catch((err) => {
  console.error('analyze-latency failed:', err.message);
  process.exit(1);
});
