/**
 * IntelBase Questions v12 Ingestion — Adds whisperer, silence_type, phase, wisdom_voice, kami_review
 * Reads all 853 questions from the v12 xlsx with 18 metadata columns.
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/ingest-questions-v12.ts
 */
import { Pool } from 'pg';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
};
let pool = new Pool(poolConfig);

async function dbQuery(sql: string, params: unknown[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SSL') || msg.includes('Connection terminated') || msg.includes('ECONNRESET')) {
        console.log(`  ⚠ DB reconnecting (attempt ${attempt + 1}/3)...`);
        try { await pool.end(); } catch {}
        pool = new Pool(poolConfig);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('DB query failed after 3 retries');
}
const BATCH_SIZE = 10;
const XLSX_PATH = '/Users/sandeepbhuiya/Documents/marcus updates/mrkos_intelbase_questions_v12.xlsx';

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
  // v12 new columns
  whisperer: string;
  silence_type: string;
  phase: string;
  wisdom_voice: string;
  kami_review: string;
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
      whisperer: String(row['whisperer'] || '').trim().toLowerCase(),
      silence_type: String(row['silence_type'] || '').trim().toLowerCase(),
      phase: String(row['phase'] || '').trim().toLowerCase(),
      wisdom_voice: String(row['wisdom_voice'] || '').trim().toLowerCase(),
      kami_review: String(row['kami_review'] || '').trim().toLowerCase(),
    });
  }
  return questions;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-large', input: texts, dimensions: 3072 });
  return resp.data.map(d => d.embedding);
}

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
  console.log('=== IntelBase Questions v12 Ingestion ===\n');
  const questions = readQuestions();
  console.log(`Read ${questions.length} questions from v12 xlsx`);

  // Add v12 columns
  console.log('Ensuring v12 schema...');
  const alters = [
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_id VARCHAR(50) UNIQUE",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS source VARCHAR(50)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS deployment_gate JSONB DEFAULT NULL",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS whisperer VARCHAR(50)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS silence_type VARCHAR(50)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS phase VARCHAR(50)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS wisdom_voice VARCHAR(100)",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS kami_review VARCHAR(10) DEFAULT 'no'",
  ];
  for (const q of alters) await dbQuery(q, []).catch(() => {});

  // Full reingest: clear and re-insert all
  console.log('Clearing old questions for full v12 reingest...');
  await dbQuery('DELETE FROM questions', []);

  let inserted = 0;
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const texts = batch.map(q => q.text);
    const embeddings = await getEmbeddings(texts);
    for (let j = 0; j < batch.length; j++) {
      const q = batch[j];
      const vecStr = `[${embeddings[j].join(',')}]`;
      const gate = getDeploymentGate(q.question_id);
      await dbQuery(
        `INSERT INTO questions (question_id, question_text, source, archetype, shadow, function,
         depth_level, arena, risk_polarity, emotion_context, perma_domain, trust_level,
         effectiveness_score, deployment_gate, whisperer, silence_type, phase, wisdom_voice,
         kami_review, embedding, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::vector,$21)
         ON CONFLICT (question_id) DO UPDATE SET
           whisperer=EXCLUDED.whisperer, silence_type=EXCLUDED.silence_type,
           phase=EXCLUDED.phase, wisdom_voice=EXCLUDED.wisdom_voice, kami_review=EXCLUDED.kami_review`,
        [q.question_id, q.text, q.source, q.archetype, q.shadow, q.fn,
         q.depth_level, q.arena, q.risk_polarity, q.emotion_context, q.perma_domain, q.trust_level,
         q.effectiveness_score, gate ? JSON.stringify(gate) : null,
         q.whisperer, q.silence_type, q.phase, q.wisdom_voice, q.kami_review,
         vecStr, JSON.stringify({ series: q.question_id.split('-').slice(0, 2).join('-') })]);
    }
    inserted += batch.length;
    console.log(`  Processed ${Math.min(i + BATCH_SIZE, questions.length)}/${questions.length}`);
    if (i + BATCH_SIZE < questions.length) await new Promise(r => setTimeout(r, 1500));
  }

  // Verify
  const cnt = await dbQuery('SELECT COUNT(*) as cnt FROM questions', []);
  console.log(`\n✓ ${cnt.rows[0].cnt} questions in database`);
  const byWhisperer = await dbQuery(`SELECT whisperer, COUNT(*) as cnt FROM questions GROUP BY whisperer ORDER BY cnt DESC`, []);
  console.log('\nBy whisperer:');
  for (const r of byWhisperer.rows) console.log(`  ${r.whisperer || '(none)'}: ${r.cnt}`);
  const bySilence = await dbQuery(`SELECT silence_type, COUNT(*) as cnt FROM questions GROUP BY silence_type ORDER BY cnt DESC`, []);
  console.log('\nBy silence_type:');
  for (const r of bySilence.rows) console.log(`  ${r.silence_type || '(none)'}: ${r.cnt}`);
  const byPhase = await dbQuery(`SELECT phase, COUNT(*) as cnt FROM questions GROUP BY phase ORDER BY phase`, []);
  console.log('\nBy phase:');
  for (const r of byPhase.rows) console.log(`  ${r.phase || '(none)'}: ${r.cnt}`);
  console.log('\n✓ v12 ingestion complete.');
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); pool.end(); process.exit(1); });

