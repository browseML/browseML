# Embeddings and retrieval in browseML — assessed, measured

Asked 2026-10-14: explore mindX's RAGE (bge-m3, 1024 dimensions, pgvectorscale) and the embeddings engine
([browseML/embeddings](https://github.com/browseML/embeddings)), and assess them for **browseML's speed** and for searching
bankML's `.memory` and `.history` in the browser — minimum footprint, maximum gain. If it is the wrong tool, say why and
do not build it.

## The verdict

**Embeddings do not make browseML answer faster; as a speed feature they are the wrong tool, and are not built.**
Retrieval finds text; it does not make the model write faster. What it adds to an answer is more prompt to read: at
about 7 tokens a second reading on the 2-core laptop measured, 300 retrieved tokens are ~43 s before the first word,
and a prompt that changes with every question cannot be restored from the prompt cache, which today brings browseML's
own prompt back in about 0.6 s instead of reading it again.

**Where retrieval is worth it is finding things**: searching `.memory` and `.history`, and the docs. For that the right
default in the browser is **BM25** (browseML/embeddings: 58 KiB of WebAssembly, no model, ~1 ms per query on 12,000
documents, equal to Savante's scores to 1e-12), not a neural embedding model.

## What mindX does (read, not run)

- **RAGE in production** (`mindX/agents/memory_pgvector.py`): bge-m3 (1024 dimensions) through Ollama on the CPU box,
  512-word chunks, `doc_embeddings` (~48,000 chunks, 325 MB) with a pgvectorscale **StreamingDiskANN** index (27 MB);
  docs search is vector-only; the event catalogue is hybrid (vector + `tsvector`, fused by RRF, k = 60).
- **Why mindX's docs load fast**: the doc pages are not read from the database at all — `GET /doc/{name}` reads the
  markdown file and renders it with a small regular-expression converter; the database only lists which docs are
  embedded. Fast because nothing heavy is on the path — the same principle as here.

## bge-m3 at 1024 dimensions, measured on this laptop

Ryzen 3 3200U (2 cores), Ollama (native llama.cpp — a browser runs the same model several times slower):

| step | time |
|---|---|
| load the model (1.2 GB) | 7.7 s |
| embed a question (9 words) | 0.7–1.1 s |
| embed a 512-word chunk | 31.3 s |

Searching the vectors is cheap; making them is not. Brute-force cosine in plain JavaScript (best of 5):

| vectors | 1024 dims, f32 | 1024 dims, int8 | 384 dims, f32 | memory at 1024 f32 |
|---|---|---|---|---|
| 1,000 | 1.3 ms | 2.1 ms | 0.5 ms | 4 MB |
| 10,000 | 14 ms | 22 ms | 5 ms | 41 MB |
| 48,472 (mindX's docs) | 93 ms | 139 ms | 39 ms | 199 MB |

So for `.memory` and `.history` (hundreds to a few thousand entries), 1024-dimension vectors would be searchable in
milliseconds with no index at all (PostgreSQL in the page — PGlite with pgvector, no pgvectorscale — is not needed at
that size). What rules bge-m3 out *in the browser* is the model: a download about 2–5× browseML's own model (0.57 GB as
int8 ONNX, 1.2 GB as GGUF), about a second per question natively (more in WebAssembly), half a minute per chunk to index,
and all of it on the same 2 cores and GPU bankML answers with.

## What would be built, when asked (not in this release)

1. **BM25 over `.memory` and `.history`** (browseML/embeddings, already bit-exact): instant search in the control panel
   and the field; building the index takes milliseconds, so it needs no scheduling.
2. **Server vectors when online, fused**: where a mindX node is reachable, its bge-m3 + DiskANN results joined to the
   browser's BM25 ranking by RRF — the vectors made where the model already runs, no model downloaded.
3. **A small embedding model as an opt-in** (384 dimensions, tens of MB), measured before it is offered; indexing only
   while the engine is idle, the CPU's pressure is nominal and the computer is not on battery (the 0.8.1 monitor
   reports all three), in a worker, with its **ready state** shown in the ultimate-input-field — as a module the field's
   drag-and-drop can add or remove.
4. **Answer reuse**: a question that matches an earlier answer in `.history` shown at once with its original receipt —
   the one place retrieval does make browseML faster.

Measured with `testing/` scripts kept in the session; the numbers above are the record.
