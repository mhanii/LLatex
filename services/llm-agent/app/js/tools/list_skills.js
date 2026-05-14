// @ts-check

import { readdirSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, '../skills')

/**
 * @typedef {{ file: string, description: string }} TemplateEntry
 * @returns {Promise<Array<{name: string, description: string, templates: TemplateEntry[]}>>}
 */
export async function listSkills(_input, _ctx) {
  if (!existsSync(SKILLS_DIR)) return []
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(
    d => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, 'skill.md'))
  )
  return dirs.map(d => {
    const skillDir = join(SKILLS_DIR, d.name)

    const description =
      readFileSync(join(skillDir, 'skill.md'), 'utf8')
        .split('\n')
        .slice(1)
        .find(l => l.trim())
        ?.trim() ?? ''

    const manifestPath = join(skillDir, 'manifest.json')
    /** @type {TemplateEntry[]} */
    let templates = []
    if (existsSync(manifestPath)) {
      templates = JSON.parse(readFileSync(manifestPath, 'utf8')).templates ?? []
    } else {
      const templatesDir = join(skillDir, 'templates')
      if (existsSync(templatesDir)) {
        templates = readdirSync(templatesDir)
          .filter(f => f.endsWith('.tex'))
          .sort()
          .map(file => ({ file, description: '' }))
      }
    }

    return { name: d.name, description, templates }
  })
}
