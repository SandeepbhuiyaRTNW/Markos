/**
 * Latency analysis over turn_logs.agent_timings.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/analyze-latency.ts [--days 7] [--limit 5000]
 *   (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, same as src/lib/db.ts)
 *
 * Reports:
 *   - p50/p95 estimated total turn time (critical-path sum, see below)
 *   - p50/p95 per tracked agent/tier
 *   - % of turns that triggered a post-generation regeneration (boundary
 *     violations are the only regen persisted in turn_logs; fantasy/vocab/
 *     forbidden/dedup regens only reach console logs — their cost is folded
 *     into the composer timing, which wraps all retries)
 *   - top 3 slowest stages by p95
 *
 * Total turn time is NOT logged directly (no total_ms column), so it is
 * reconstructed from the orchestrator's stage graph (orchestrator-v2.ts):
 *   memory-sentinel → max(listener-stack, kwml-agent) → assessment-ring
 *   → domain-whisperers → rag-retrieval → composer
 * This excludes route-level STT/TTS/DB, which are not instrumented.
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

  const res = await pool.query(
    `SELECT agent_timings, boundary_violations, errors, crisis_level
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
  }>;

  if (rows.length === 0) {
    console.log(`No turn_logs rows with agent_timings in the last ${days} days.`);
    await pool.end();
    return;
  }

  const perAgent: Record<string, number[]> = {};
  const totals: number[] = [];
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

    // Critical path per orchestrator-v2 stage graph. Missing stages count 0
    // (sentinel-intercepted turns have few/no stages).
    const total =
      (t['memory-sentinel'] || 0) +
      Math.max(t['listener-stack'] || 0, t['kwml-agent'] || 0) +
      (t['assessment-ring'] || 0) +
      (t['domain-whisperers'] || 0) +
      (t['rag-retrieval'] || 0) +
      (t['composer'] || 0);
    if (total > 0) totals.push(total);
    if (t['composer']) composerTurns++;

    if (Array.isArray(row.boundary_violations) && row.boundary_violations.length > 0) regenTurns++;
    const errs = typeof row.errors === 'string' ? JSON.parse(row.errors) : row.errors;
    if (Array.isArray(errs) && errs.length > 0) errorTurns++;
  }

  totals.sort((a, b) => a - b);

  console.log(`\n=== Turn latency analysis (last ${days} days, ${rows.length} turns) ===\n`);
  console.log(`Turns reaching the composer: ${composerTurns} (${((composerTurns / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Estimated total (critical path, excl. STT/TTS/route): p50 ${fmt(percentile(totals, 50))}  p95 ${fmt(percentile(totals, 95))}  (n=${totals.length})`);
  console.log(`Turns with boundary regeneration: ${regenTurns} (${((regenTurns / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  NOTE: fantasy/vocab/forbidden/trajectory regens are not persisted — their time is inside 'composer'.`);
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
  console.log(`route-level DB queries, and the user-name lookup. Add wall-clock total_ms`);
  console.log(`to turn_logs to measure them.`);

  await pool.end();
}

main().catch((err) => {
  console.error('analyze-latency failed:', err.message);
  process.exit(1);
});
