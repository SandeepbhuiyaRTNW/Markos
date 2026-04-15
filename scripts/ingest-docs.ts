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
const TARGET_CHUNK_SIZE = 1200;
const MAX_CHUNK_SIZE = 1800;
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

/**
 * Paragraph-aware chunking for docs (same logic as books chunker).
 */
function chunkText(text: string): string[] {
  const cleaned = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();

  const paragraphs = cleaned.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length > 0 && currentChunk.length + para.length + 2 > TARGET_CHUNK_SIZE) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    if (para.length > MAX_CHUNK_SIZE) {
      if (currentChunk.length > 0) { chunks.push(currentChunk.trim()); currentChunk = ''; }
      const sentences = para.match(/[^.!?]+[.!?]+[\s"]*/g) || [para];
      let sentenceChunk = '';
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > TARGET_CHUNK_SIZE && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = '';
        }
        sentenceChunk += sentence;
      }
      if (sentenceChunk.trim().length > 20) currentChunk = sentenceChunk;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.trim().length > 20) chunks.push(currentChunk.trim());
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

/**
 * Extract XLSX as structured rows — each row becomes a natural-language entry.
 * Column headers become labels. So instead of "CE-DEEP-003 | What would it mean..."
 * we get "Question ID: CE-DEEP-003. Category: Core Emotions. Question: What would it mean..."
 */
function extractXlsxText(filepath: string): string {
  const workbook = XLSX.readFile(filepath);
  const allText: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    const headers = Object.keys(rows[0] || {});
    for (const row of rows) {
      const parts: string[] = [];
      for (const h of headers) {
        const val = String(row[h] || '').trim();
        if (val.length > 0) {
          parts.push(`${h}: ${val}`);
        }
      }
      if (parts.length > 0) allText.push(parts.join('. '));
    }
  }
  // For question banks, each row is its own "paragraph" — the chunker will group them naturally
  return allText.join('\n\n');
}

async function ingestDoc(doc: DocEntry): Promise<number> {
  const filepath = join(DOCS_DIR, doc.filename);
  console.log('\n[' + doc.title + ']');
  const existing = await pool.query(
    "SELECT COUNT(*) FROM embeddings WHERE source_title = $1 AND source_type = 'doc'",
    [doc.title]
  );
  const reingest = process.argv.includes('--reingest');
  if (parseInt(existing.rows[0].count) > 0 && !reingest) {
    console.log('  Already ingested (' + existing.rows[0].count + ' chunks), skipping');
    return parseInt(existing.rows[0].count);
  }
  if (reingest && parseInt(existing.rows[0].count) > 0) {
    console.log('  🔄 Deleting ' + existing.rows[0].count + ' old chunks...');
    await pool.query("DELETE FROM embeddings WHERE source_title = $1 AND source_type = 'doc'", [doc.title]);
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

