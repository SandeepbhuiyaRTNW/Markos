/**
 * IntelBase Questions v8 Ingestion — Structured Import
 * Reads all 737 questions from the xlsx with full metadata columns,
 * embeds each question, and stores in the questions table.
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/ingest-questions-v2.ts
 */
import { Pool } from 'pg';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { join } from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
const BATCH_SIZE = 20;
const XLSX_PATH = join(__dirname, '..', 'Additional docs', 'Docs', 'mrkos_intelbase_questions_v8 (1).xlsx');

interface QuestionRow {
  question_id: string;
  text: string;
  source: string;
  archetype: string;
  shadow: string;
  fn: string;
  depth_level: number;
  arena: string;
  risk_polarity: string;
  emotion_context: string;
  perma_domain: string;
  trust_level: string;
  effectiveness_score: number;
}

function readQuestions(): QuestionRow[] {
  const workbook = XLSX.readFile(XLSX_PATH);
  const ws = workbook.Sheets['Questions Database'];
  if (!ws) throw new Error('Questions Database sheet not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const questions: QuestionRow[] = [];
  for (const row of rows) {
    const qid = String(row['question_id'] || '').trim();
    const text = String(row['text'] || '').trim();
    if (!qid || !text) continue;
    questions.push({
      question_id: qid,
      text,
      source: String(row['source'] || '').trim(),
      archetype: String(row['archetype'] || '').trim().toLowerCase(),
      shadow: String(row['shadow'] || '').trim().toLowerCase(),
      fn: String(row['function'] || '').trim(),
      depth_level: parseInt(String(row['depth_level'] || '1'), 10) || 1,
      arena: String(row['arena'] || '').trim(),
      risk_polarity: String(row['risk_polarity'] || '').trim(),
      emotion_context: String(row['emotion_context'] || '').trim(),
      perma_domain: String(row['perma_domain'] || '').trim(),
      trust_level: String(row['trust_level'] || '').trim(),
      effectiveness_score: parseFloat(String(row['effectiveness_score'] || '0.5')) || 0.5,
    });
  }
  return questions;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    dimensions: 3072,
  });
  return resp.data.map((d) => d.embedding);
}

// Deployment gate metadata for gated series
function getDeploymentGate(qid: string): Record<string, unknown> | null {
  if (qid.startsWith('CE-SGRF')) return { deployment_gate: 'explicit_suicide_loss_only', risk_elevated: true };
  if (qid.startsWith('CE-DBODY')) return { risk_elevated: true, context_required: 'body_substance_context' };
  if (qid.startsWith('CE-DFATH')) return { context_required: 'fatherhood_confirmed' };
  if (qid.startsWith('CE-BURD')) {
    const base: Record<string, unknown> = { deployment_gate: 'burden_self_perception_confirmed' };
    if (qid === 'CE-BURD-004' || qid === 'CE-BURD-005') base.trust_required = 'deep';
    return base;
  }
  if (qid.startsWith('CE-TRAJ') && (qid === 'CE-TRAJ-008' || qid === 'CE-TRAJ-010')) {
    return { trust_required: 'deep', min_sessions: 10 };
  }
  return null;
}

async function main() {
  console.log('=== IntelBase Questions v8 Structured Ingestion ===\n');

  // Step 1: Read questions
  const questions = readQuestions();
  console.log('Read ' + questions.length + ' questions from xlsx');

  // Step 2: Alter table to add missing columns
  console.log('Ensuring table schema...');
  const alterQueries = [
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_id VARCHAR(50) UNIQUE",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS source VARCHAR(50)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS deployment_gate JSONB DEFAULT NULL",
  ];
  for (const q of alterQueries) {
    await pool.query(q).catch(() => {});
  }

  // Step 3: Clear old questions that lack question_id (from prior ingestion)
  const oldCount = await pool.query("SELECT COUNT(*) as cnt FROM questions WHERE question_id IS NULL");
  if (parseInt(oldCount.rows[0].cnt) > 0) {
    console.log('Clearing ' + oldCount.rows[0].cnt + ' old questions without question_id...');
    await pool.query("DELETE FROM questions WHERE question_id IS NULL");
  }

  // Step 4: Embed and upsert in batches (resumable — skips already-inserted rows)
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);

    // Check which already exist
    const ids = batch.map((q) => q.question_id);
    const existing = await pool.query(
      "SELECT question_id FROM questions WHERE question_id = ANY($1::text[])",
      [ids]
    );
    const existingSet = new Set(existing.rows.map((r: { question_id: string }) => r.question_id));
    const toInsert = batch.filter((q) => !existingSet.has(q.question_id));
    if (toInsert.length === 0) {
      skipped += batch.length;
      console.log('  Skipped ' + (i + batch.length) + '/' + questions.length + ' (already exist)');
      continue;
    }

    const texts = toInsert.map((q) => q.text);
    const embeddings = await getEmbeddings(texts);

    for (let j = 0; j < toInsert.length; j++) {
      const q = toInsert[j];
      const vecStr = '[' + embeddings[j].join(',') + ']';
      const gate = getDeploymentGate(q.question_id);
      await pool.query(
        `INSERT INTO questions (question_id, question_text, source, archetype, shadow, function, depth_level, arena, risk_polarity, emotion_context, perma_domain, trust_level, effectiveness_score, deployment_gate, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::vector, $16)
         ON CONFLICT (question_id) DO NOTHING`,
        [
          q.question_id, q.text, q.source, q.archetype, q.shadow, q.fn,
          q.depth_level, q.arena, q.risk_polarity, q.emotion_context,
          q.perma_domain, q.trust_level, q.effectiveness_score,
          gate ? JSON.stringify(gate) : null,
          vecStr,
          JSON.stringify({ series: q.question_id.split('-').slice(0, 2).join('-') }),
        ]
      );
    }
    inserted += toInsert.length;
    skipped += batch.length - toInsert.length;
    console.log('  Processed ' + (i + batch.length) + '/' + questions.length + ' (inserted: ' + inserted + ', skipped: ' + skipped + ')');
    if (i + BATCH_SIZE < questions.length) await new Promise((r) => setTimeout(r, 600));
  }



  // Step 5: Verify
  const verify = await pool.query('SELECT COUNT(*) as cnt FROM questions');
  console.log('\nVerification: ' + verify.rows[0].cnt + ' questions in database');

  const byTrust = await pool.query(
    "SELECT trust_level, COUNT(*) as cnt FROM questions GROUP BY trust_level ORDER BY trust_level"
  );
  console.log('\nBy trust level:');
  for (const row of byTrust.rows) console.log('  ' + row.trust_level + ': ' + row.cnt);

  const byDepth = await pool.query(
    "SELECT depth_level, COUNT(*) as cnt FROM questions GROUP BY depth_level ORDER BY depth_level"
  );
  console.log('\nBy depth level:');
  for (const row of byDepth.rows) console.log('  Level ' + row.depth_level + ': ' + row.cnt);

  const gated = await pool.query(
    "SELECT COUNT(*) as cnt FROM questions WHERE deployment_gate IS NOT NULL"
  );
  console.log('\nGated questions (safety): ' + gated.rows[0].cnt);

  console.log('\nDone.');
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});