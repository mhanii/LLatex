# Benchmark Harness

Offline harness for measuring LLM performance on LaTeX-generation tasks. Located at `services/llm-agent/app/js/benchmark/`.

Drives a chosen pipeline (currently `direct-llm`) over a chosen dataset (currently TeXpert) and emits per-task JSONL plus an aggregate summary.

This is the OP1c baseline harness from the grant proposal. It is deliberately decoupled from the live agent service: a benchmark run does not touch MongoDB, Redis, document-updater, or the web auth stack — it talks to CLSI directly.

## Scoring

Each task gets two scores:

| Score | Source | Meaning |
|---|---|---|
| `compile.compileSuccess` | CLSI compile of the model output | Did the LaTeX compile to a non-empty PDF? |
| `judge.score` | LLM-as-judge | `-1` if compile failed (no LLM call). `0–10` integer rubric otherwise. |

The judge sees the task description, the verified reference solution, and the model's output, and is told not to penalise stylistic differences. Scoring is rubric-based (0-3 fail / 4-6 partial / 7-9 largely correct / 10 complete).

## Quick Start

### 1. Configure the API Key

Put your Portkey key in `develop/.env` (gitignored — copy from `develop/.env.example`):

```
PORTKEY_API_KEY=Sbf**********************5bG
LLM_MODEL=@deepseek/deepseek-v4-flash
LLM_JUDGE_MODEL=@deepseek/deepseek-v4-pro   # optional; falls back to LLM_MODEL
```

### 2. Download the Dataset (one-time)

```bash
docker compose -f develop/docker-compose.yml -f develop/docker-compose.dev.yml exec \
  llm-agent node /overleaf/services/llm-agent/app/js/benchmark/scripts/download-texpert.mjs
```

### 3. Smoke Test (5 Simple tasks)

```bash
docker compose -f develop/docker-compose.yml -f develop/docker-compose.dev.yml exec \
  llm-agent node /overleaf/services/llm-agent/app/js/benchmark/cli.mjs run \
    --pipeline direct-llm --dataset texpert \
    --difficulty Simple --limit 5 \
    --output app/js/benchmark/runs/smoke.jsonl
```

### 4. Full Baseline (~30–60 min for 440 tasks at concurrency=1)

```bash
docker compose ... exec llm-agent \
  node /overleaf/services/llm-agent/app/js/benchmark/cli.mjs run \
    --pipeline direct-llm --dataset texpert \
    --output app/js/benchmark/runs/baseline.jsonl
```

Use `--no-judge` to skip LLM-as-judge (faster, but no quality score on passing rows).

## Output Shape

Each row in the JSONL:

```json
{
  "taskId": "02BE9B93",
  "difficulty": "Simple",
  "config": { "pipeline": "direct-llm", "model": "gpt-4o", "datasetVersion": "TeXpert@main" },
  "prompt": "Create a document with...",
  "reference": "\\documentclass{article}...",
  "output": {
    "entrypoint": "main.tex",
    "files": [{ "path": "main.tex", "content": "..." }]
  },
  "compile": { "compileSuccess": true, "errorCount": 0, "errors": [], "compileMs": 312, "pdfSizeBytes": 12544 },
  "judge": { "score": 9, "reason": "Mostly correct, minor stylistic differences.", "model": "@gemini/gemini-3.1-pro-preview", "inputTokens": 280, "outputTokens": 22, "latencyMs": 410 },
  "tokens": { "input": 142, "output": 287 },
  "latencyMs": 1843,
  "steps": [...],
  "error": null
}
```

A sibling `<output>.summary.json` aggregates compile pass-rate, mean errors, mean tokens, mean latency, and (when judge is enabled) `judgeMeanScore` (over all rows including `-1` for compile fails) and `judgeMeanScoreOnPass` (mean over compile-passes only) per difficulty bucket.

## Adding a New Pipeline

1. Create `pipelines/MyPipeline.js` extending `Pipeline`.
2. Implement `run(input)` returning `{ files, entrypoint, steps, totals }`. Multiple files are fine — the evaluator forwards them all to CLSI as `resources`.
3. Register in `pipelines/index.js`'s `REGISTRY`.

## Adding a New Dataset

1. Create `datasets/MyDataset.js` extending `Dataset`.
2. Implement `load()` and `iter(filter)`. Yield normalised tasks `{ id, prompt, reference, difficulty, raw }`.
3. Register in `datasets/index.js`'s `REGISTRY`.

If the dataset lives on HuggingFace, add a `scripts/download-<name>.mjs` that fetches the raw file(s) into `data/`. The `data/` and `runs/` directories are gitignored.

## Adding a New Provider

The provider abstraction lives at `services/llm-agent/app/js/providers/`. The live agent service uses `vercelPortkey.js` which returns Vercel AI SDK model instances routed through Portkey. Most model swaps are Portkey config changes rather than new provider files. If you need a non-Portkey provider, add a new adapter file that returns a Vercel `LanguageModel` and wire it into `createModel()`.

## Environment

| Var | Required | Notes |
|---|---|---|
| `PORTKEY_API_KEY` | yes | Portkey gateway API key |
| `PORTKEY_VIRTUAL_KEY` | one of | Routes to a Portkey-configured underlying provider |
| `PORTKEY_CONFIG` | one of | Alternative: full Portkey config id |
| `PORTKEY_BASE_URL` | no | Self-hosted Portkey gateway URL |
| `LLM_MODEL` | no | Default generation model if `--model` is omitted |
| `LLM_JUDGE_MODEL` | no | Default judge model if `--judge-model` is omitted (falls back to `LLM_MODEL`) |
| `CLSI_HOST` | no | Default `clsi` (Docker internal) or `127.0.0.1` (host) |
| `CLSI_PORT` | no | Default `3013` |

## Out of Scope (Deliberate)

- ReAct / Self-Refine / Reflexion / HITL pipelines (OP2/OP3)
- MongoDB result storage / web UI for browsing runs
- Multi-provider runs in a single invocation
- Multi-judge ensembles (today: single judge model)
