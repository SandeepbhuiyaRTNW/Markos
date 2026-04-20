/**
 * Chunk Quality Audit — samples chunks from every source and flags problems.
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/audit-chunks.ts
 */
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// Quality patterns to flag
const GARBAGE_PATTERNS = [
  /^[\s\d\W]{0,30}$/,                           // Only whitespace/numbers/symbols
  /^[A-Z\s]{50,}$/,                              // ALL CAPS block (header noise)
  /\u0000/,                                      // Null bytes
  /[\ufffd]{3,}/,                                 // Replacement chars (encoding fail)
  /^(page|chapter|table of contents|copyright|isbn|all rights reserved)/i,
  /^\d+\s*$/,                                    // Just a page number
  /^[.\-_=]{10,}$/,                              // Separator lines
  /^(figure|fig\.|table) \d/i,                   // Figure/table captions only
];

const NOISE_PATTERNS = [
  /published by|publishing|printed in|first edition|library of congress/i,
  /all rights reserved|no part of this|reproduced|permission/i,
  /isbn[\s:\-]*\d/i,
  /www\.\S+\.(com|org|net|edu)/i,               // URLs in chunks
  /\d{3,4}\s+(copyright|©)/i,                    // Copyright notices
];

async function main() {
  // 1. Stats per source
  const stats = await pool.query(`
    SELECT source_title, source_type, COUNT(*) as chunks,
           ROUND(AVG(LENGTH(content))) as avg_len,
           MIN(LENGTH(content)) as min_len,
           MAX(LENGTH(content)) as max_len,
           COUNT(*) FILTER (WHERE LENGTH(content) < 50) as tiny_chunks,
           COUNT(*) FILTER (WHERE LENGTH(content) > 2000) as huge_chunks
    FROM embeddings
    WHERE source_type IN ('book','training_doc')
    GROUP BY source_title, source_type ORDER BY source_type, source_title
  `);

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    CHUNK QUALITY AUDIT                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  for (const r of stats.rows) {
    console.log(`[${r.source_type}] ${r.source_title}`);
    console.log(`  chunks=${r.chunks}  avg_len=${r.avg_len}  min=${r.min_len}  max=${r.max_len}  tiny(<50)=${r.tiny_chunks}  huge(>2000)=${r.huge_chunks}`);
  }

  // 2. Sample and check every chunk for quality
  console.log('\n=== DETAILED QUALITY SCAN ===\n');

  const allChunks = await pool.query(`
    SELECT id, content, source_title, source_type, chunk_index
    FROM embeddings WHERE source_type IN ('book','training_doc')
    ORDER BY source_title, chunk_index
  `);

  let totalGarbage = 0, totalNoise = 0, totalTiny = 0, totalHuge = 0;
  const garbageIds: number[] = [];
  const noiseIds: number[] = [];
  const tinyIds: number[] = [];

  const issuesBySource: Record<string, { garbage: number; noise: number; tiny: number; samples: string[] }> = {};

  for (const row of allChunks.rows) {
    const title = row.source_title;
    if (!issuesBySource[title]) issuesBySource[title] = { garbage: 0, noise: 0, tiny: 0, samples: [] };

    const content: string = row.content;

    // Check garbage
    const isGarbage = GARBAGE_PATTERNS.some(p => p.test(content));
    if (isGarbage) {
      totalGarbage++;
      garbageIds.push(row.id);
      issuesBySource[title].garbage++;
      if (issuesBySource[title].samples.length < 3) {
        issuesBySource[title].samples.push(`[GARBAGE chunk_${row.chunk_index}]: "${content.substring(0, 80)}..."`);
      }
    }

    // Check noise
    const noiseMatches = NOISE_PATTERNS.filter(p => p.test(content));
    if (noiseMatches.length >= 2) { // 2+ noise patterns = mostly noise
      totalNoise++;
      noiseIds.push(row.id);
      issuesBySource[title].noise++;
      if (issuesBySource[title].samples.length < 5) {
        issuesBySource[title].samples.push(`[NOISE chunk_${row.chunk_index}]: "${content.substring(0, 80)}..."`);
      }
    }

    // Check tiny
    if (content.length < 50) {
      totalTiny++;
      tinyIds.push(row.id);
      issuesBySource[title].tiny++;
      if (issuesBySource[title].samples.length < 5) {
        issuesBySource[title].samples.push(`[TINY chunk_${row.chunk_index} len=${content.length}]: "${content}"`);
      }
    }

    // Check huge
    if (content.length > 2000) totalHuge++;
  }

  // 3. Report per source
  for (const [title, issues] of Object.entries(issuesBySource)) {
    const hasIssues = issues.garbage > 0 || issues.noise > 0 || issues.tiny > 0;
    if (hasIssues) {
      console.log(`\n⚠  ${title}`);
      if (issues.garbage > 0) console.log(`   🗑  ${issues.garbage} garbage chunks`);
      if (issues.noise > 0)   console.log(`   📢  ${issues.noise} noise chunks`);
      if (issues.tiny > 0)    console.log(`   🔍  ${issues.tiny} tiny chunks`);
      for (const s of issues.samples) console.log(`   → ${s}`);
    } else {
      console.log(`\n✅ ${title} — clean`);
    }
  }

  // 4. Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`TOTAL: ${allChunks.rows.length} chunks across ${stats.rows.length} sources`);
  console.log(`  🗑  ${totalGarbage} garbage (will delete)`);
  console.log(`  📢  ${totalNoise} noise-heavy (will delete)`);
  console.log(`  🔍  ${totalTiny} tiny <50 chars (will delete)`);
  console.log(`  📏  ${totalHuge} huge >2000 chars (check manually)`);
  const deleteIds = [...new Set([...garbageIds, ...noiseIds, ...tinyIds])];
  console.log(`\n→ ${deleteIds.length} total chunks to delete`);

  // 5. Delete bad chunks
  if (deleteIds.length > 0 && process.argv.includes('--fix')) {
    console.log(`\nDeleting ${deleteIds.length} bad chunks...`);
    for (let i = 0; i < deleteIds.length; i += 100) {
      const batch = deleteIds.slice(i, i + 100);
      await pool.query(`DELETE FROM embeddings WHERE id = ANY($1)`, [batch]);
    }
    console.log('✅ Bad chunks deleted.');
    const remaining = await pool.query(`SELECT source_title, COUNT(*) as cnt FROM embeddings WHERE source_type IN ('book','training_doc') GROUP BY source_title ORDER BY source_title`);
    console.log('\nRemaining chunks:');
    for (const r of remaining.rows) console.log(`  ${r.source_title}: ${r.cnt}`);
  } else if (deleteIds.length > 0) {
    console.log(`\nRun with --fix to delete bad chunks: npx tsx scripts/audit-chunks.ts --fix`);
  }

  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); pool.end(); process.exit(1); });

