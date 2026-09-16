# Knowledge Pipeline V1 — Spec

_Status: agreed on the Sept 8 2026 call (Vikas, Sandeep, Cihan). This is the spec Vikas said he'd write. It describes the target design on top of the pipeline that exists in the repo today (`src/lib/rag/retriever.ts`, `embeddings` table, whisperer modules) — retrieval layered on the current engine, not a new architecture._

## Decision

**Retrieval, no fine-tuning.** Domain knowledge reaches Marcus through curated, tagged, retrieved content. Fine-tuning is explicitly deferred; revisit only if retrieval provably can't carry answer quality.

## Pipeline

1. **Curated sources → object storage (AWS).** Start with the smallest set: **3–4 curated sources per domain**. Sandeep owns picking them. Prove the agent actually uses the knowledge before adding books; add books only as answer quality demands.
2. **Chunk + embed.** Same shape as the existing ingestion scripts (`scripts/ingest-*.ts` → `embeddings` table).
3. **Vector DB with metadata.** Every chunk carries tags: **topic / tone / audience**. Metadata is what makes filtered retrieval possible — a chunk without tags doesn't ship.
4. **Classifier routes the turn.** Each incoming turn is classified so retrieval and prompts key off what the conversation is actually about. (This is the topic-tagging workstream — Vikas, in progress. It is the linchpin: filtered retrieval and per-domain prompts both key off its tags.)
5. **Filtered retrieval.** Retrieval is restricted to chunks whose tags match the turn's classification, instead of today's global similarity search.
6. **Per-domain prompt + safety rules.** Each domain gets its own prompt section and its own hard rules, landing as whisperer-style modules on the existing engine (the divorce module is the template: curated content, red lines, boundary check, silent on neutral messages).

## Question database

The question database stays a **separate store used as retrieval examples**, re-ranked by metadata — so Marcus asks the right question for the right read. It is **not merged into the corpus**. (Sandeep owns this; the 1,058-row database is still un-ingested.)

## Rollout

1. Topic tagging on messages + onboarding signals (Vikas — in progress, finish first).
2. Knowledge-pipeline plumbing against the smallest source set, divorce domain first (the wedge).
3. Upload page for Cihan: simple UI + ingestion workflow so content flows without Vikas or Sandeep in the loop. Unblocks Sandeep's per-domain sources.
4. Add domains and books only as answer quality demands.

## Owners (Sept 8)

- **Vikas:** topic tagging, this spec, upload page.
- **Sandeep:** 3–4 curated sources per domain, question DB as retrieval, fresh API key with budget tracking.
- **Cihan:** source material; Fish Audio application (his account).
- Team: no Jira — keep tooling simple.
