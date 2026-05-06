#!/usr/bin/env node
// @ts-check

// Downloads the TeXpert dataset (knowledge-verse-ai/TeXpert) from HuggingFace
// to services/llm-agent/app/js/benchmark/data/texpert.json.
//
// The HF JSON file (TeXpert_Dataset.json) only contains the 250 Simple
// examples. The canonical 440-example dataset (Simple 250 + Average 150 +
// Hard 40) lives in TeXpert_Dataset.xlsx as three separate sheets, so we
// download that and merge.
//
// Usage:
//   node services/llm-agent/app/js/benchmark/scripts/download-texpert.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const SOURCE_URL =
  'https://huggingface.co/datasets/knowledge-verse-ai/TeXpert/resolve/main/TeXpert_Dataset.xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../data')
const OUT_PATH = path.join(OUT_DIR, 'texpert.json')

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true })
  process.stderr.write(`Fetching ${SOURCE_URL}\n`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching dataset: ${res.statusText}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer' })

  const merged = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    for (const row of rows) {
      // Hard sheet's class header is uppercase 'CLASS'; normalise.
      const cls = row.Class ?? row.CLASS ?? sheetName
      merged.push({
        ID: row.ID,
        'Task Instructions': row['Task Instructions'],
        'Verified LaTeX Code': row['Verified LaTeX Code'],
        'Verified LaTeX Source LLM': row['Verified LaTeX Source LLM'],
        Class: cls,
      })
    }
  }

  await fs.promises.writeFile(OUT_PATH, JSON.stringify(merged, null, 2))
  const counts = merged.reduce(
    (m, r) => ((m[r.Class] = (m[r.Class] || 0) + 1), m),
    {}
  )
  process.stderr.write(
    `Wrote ${merged.length} examples to ${OUT_PATH} (${JSON.stringify(counts)})\n`
  )
}

main().catch(err => {
  process.stderr.write(`download-texpert failed: ${err.stack || err.message}\n`)
  process.exit(1)
})
