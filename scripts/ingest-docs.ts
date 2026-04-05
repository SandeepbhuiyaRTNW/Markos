/**
 * Local Docs Ingestion Pipeline
 * Reads .docx and .xlsx files from Additional docs/Docs,
 * extracts text, chunks, embeds with OpenAI, stores in pgvector.
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/ingest-docs.ts
 */
import { Pool } from 'pg';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { join } from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 20;
const DOCS_DIR = join(__dirname, '..', 'Additional docs', 'Docs');

interface DocEntry {
  filename: string;
  title: string;
  domain: string;
}

const DOCS: DocEntry[] = [
  {
    filename: 'mrkos_art_of_understanding_men_v8.docx',
    title: 'The Art of Understanding Men - mrkos Internal',
    domain: 'understanding_men',
  },
  {
    filename: 'mrkos_source_library_v1.docx',
    title: 'mrkos Source Library',
    domain: 'source_library',
  },
  {
    filename: 'mrkos_intelbase_questions_v8 (1).xlsx',
    title: 'mrkos IntelBase Questions',
    domain: 'question_bank',
  },
];

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    const cleaned = chunk.replace(/  +/g, ' ');
    if (cleaned.length > 50) chunks.push(cleaned);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    dimensions: 3072,
  });
  return resp.data.map((d) => d.embedding);
}

async function extractDocxText(filepath: string): Promise<string> {
  const buffer = readFileSync(filepath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractXlsxText(filepath: string): string {
  const workbook = XLSX.readFile(filepath);
  const allText: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    for (const row of rows) {
      const vals = Object.values(row)
        .map((v) => String(v))
        .filter((v) => v.trim().length > 0);
      if (vals.length > 0) allText.push(vals.join(' | '));
    }
  }
  return allText.join('\n');
}

async function ingestDoc(doc: DocEntry): Promise<number> {
  const filepath = join(DOCS_DIR, doc.filename);
  console.log('\n[' + doc.title + ']');
  const existing = await pool.query(
    "SELECT COUNT(*) FROM embeddings WHERE source_title = $1 AND source_type = 'doc'",
    [doc.title]
  );
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('  Already ingested (' + existing.rows[0].count + ' chunks), skipping');
    return parseInt(existing.rows[0].count);
  }
  console.log('  Extracting text from ' + doc.filename + '...');
  let text: string;
  if (doc.filename.endsWith('.docx')) text = await extractDocxText(filepath);
  else if (doc.filename.endsWith('.xlsx')) text = extractXlsxText(filepath);
  else {
    console.log('  Unsupported file type');
    return 0;
  }
  if (text.length < 100) {
    console.log('  Too little text');
    return 0;
  }
  console.log('  Extracted ' + text.length + ' characters');
  const chunks = chunkText(text);
  console.log('  Split into ' + chunks.length + ' chunks');
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await getEmbeddings(batch);
    for (let j = 0; j < batch.length; j++) {
      const vecStr = '[' + embeddings[j].join(',') + ']';
      await pool.query(
        "INSERT INTO embeddings (content, embedding, source_type, source_id, source_title, chunk_index, metadata) VALUES ($1, $2::vector, 'doc', $3, $4, $5, $6)",
        [
          batch[j],
          vecStr,
          doc.filename,
          doc.title,
          i + j,
          JSON.stringify({ domain: doc.domain }),
        ]
      );
    }
    const done = Math.min(i + BATCH_SIZE, chunks.length);
    console.log('  Embedded ' + done + '/' + chunks.length + ' chunks');
    if (i + BATCH_SIZE < chunks.length)
      await new Promise((r) => setTimeout(r, 500));
  }
  console.log('  Done: ' + chunks.length + ' chunks embedded');
  return chunks.length;
}

async function main() {
  console.log('=== mrkos.ai Local Docs Ingestion Pipeline ===');
  console.log('Processing ' + DOCS.length + ' documents from ' + DOCS_DIR);
  let totalChunks = 0;
  let successCount = 0;
  for (const doc of DOCS) {
    try {
      const n = await ingestDoc(doc);
      totalChunks += n;
      if (n > 0) successCount++;
    } catch (err) {
      console.error('  Error: ' + doc.title + ':', err);
    }
  }
  console.log(
    '\n=== Summary: ' +
      successCount +
      '/' +
      DOCS.length +
      ' docs, ' +
      totalChunks +
      ' total chunks ==='
  );
  const verify = await pool.query(
    "SELECT source_title, COUNT(*) as chunks FROM embeddings WHERE source_type = 'doc' GROUP BY source_title"
  );
  for (const row of verify.rows) {
    console.log('  ' + row.source_title + ': ' + row.chunks + ' chunks');
  }
  console.log('\nDone.');
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});

