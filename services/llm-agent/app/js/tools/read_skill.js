// @ts-check

import { readFileSync, existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, '../skills')

/**
 * @param {{ name: string, template?: string }} input
 * @returns {Promise<string>}
 */
export async function readSkill({ name, template }, _ctx) {
  const safeName = name.replace(/[^a-z0-9_-]/gi, '')
  const skillDir = join(SKILLS_DIR, safeName)
  if (!existsSync(skillDir)) {
    return `Skill "${name}" not found. Call list_skills to see available skills.`
  }

  const parts = []

  const guidePath = join(skillDir, 'skill.md')
  if (existsSync(guidePath)) {
    parts.push(`# Guide\n\n${readFileSync(guidePath, 'utf8')}`)
  }

  const templatesDir = join(skillDir, 'templates')

  if (template) {
    // Sanitize: allow letters, digits, underscores, hyphens, dots (for .tex extension).
    // After this, slashes can't survive, so multi-segment traversal is impossible —
    // but `.` and `..` still resolve to directories under join(), which would
    // crash readFileSync with EISDIR. Reject them (and the empty result) outright.
    const safeTemplate = template.replace(/[^a-z0-9_.-]/gi, '')
    if (!safeTemplate || safeTemplate === '.' || safeTemplate === '..') {
      return `Invalid template name "${template}". Call read_skill without a template argument to see the available templates for \`${name}\`.`
    }
    const templatePath = join(templatesDir, safeTemplate)

    if (existsSync(templatePath)) {
      parts.push(
        `# Template: ${safeTemplate}\n\n\`\`\`latex\n${readFileSync(templatePath, 'utf8')}\n\`\`\``
      )
    } else {
      // Search every other skill for a template with the same filename
      let foundInSkill = null
      let foundContent = null
      for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === safeName) continue
        const candidate = join(SKILLS_DIR, entry.name, 'templates', safeTemplate)
        if (existsSync(candidate)) {
          foundInSkill = entry.name
          foundContent = readFileSync(candidate, 'utf8')
          break
        }
      }

      if (foundInSkill && foundContent) {
        parts.push(
          `> **Note:** \`${safeTemplate}\` is not part of the \`${safeName}\` skill — ` +
            `it was found in \`${foundInSkill}\`. You can use it freely; the LaTeX is ` +
            `self-contained. However, the guide above describes \`${safeName}\` conventions ` +
            `and packages. This template may rely on different packages — if you run into ` +
            `missing-package errors, call \`read_skill\` with name \`${foundInSkill}\` (no ` +
            `template) to check its \`\\usepackage\` requirements.\n\n` +
            `# Template: ${safeTemplate} (from ${foundInSkill})\n\n` +
            `\`\`\`latex\n${foundContent}\n\`\`\``
        )
      } else {
        return (
          `Template "${template}" was not found in \`${name}\` or any other skill. ` +
          `Call read_skill without a template argument to see the available templates for \`${name}\`.`
        )
      }
    }
  } else {
    // Return the template index so the agent can pick which one(s) to read
    const manifestPath = join(skillDir, 'manifest.json')
    if (existsSync(manifestPath)) {
      const { templates } = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const lines = templates.map(
        (/** @type {{ file: string, description: string }} */ t) =>
          `- **${t.file}** — ${t.description}`
      )
      parts.push(
        `# Available Templates\n\n${lines.join('\n')}\n\n` +
          `Call \`read_skill\` again with \`template\` set to a filename to get the full LaTeX code.`
      )
    } else if (existsSync(templatesDir)) {
      const files = readdirSync(templatesDir)
        .filter(f => f.endsWith('.tex'))
        .sort()
      const lines = files.map(f => `- **${f}**`)
      parts.push(
        `# Available Templates\n\n${lines.join('\n')}\n\n` +
          `Call \`read_skill\` again with \`template\` set to a filename to get the full LaTeX code.`
      )
    }
  }

  return parts.join('\n\n---\n\n')
}
