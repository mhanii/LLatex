// @ts-check

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { listFiles } from './list_files.js'
import { readFile } from './read_file.js'
import { createFile } from './create_file.js'
import { editFile } from './edit_file.js'
import { deleteFile } from './delete_file.js'
import { moveFile } from './move_file.js'
import { getOutline } from './get_outline.js'
import { checkSyntax } from './check_syntax.js'
import { compileAndCheck } from './compile_and_check.js'
import { getPdfPage } from './get_pdf_page.js'
import { listSkills } from './list_skills.js'
import { readSkill } from './read_skill.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {string} name
 * @returns {string}
 */
function loadPrompt(name) {
  return readFileSync(join(__dirname, 'prompts', `${name}.txt`), 'utf8').trim()
}

/**
 * @typedef {Object} ToolDefinition
 * @property {string} description
 * @property {z.ZodTypeAny} inputSchema
 * @property {(input: any, ctx: import('../types.js').RunContext) => Promise<unknown>} execute
 */

/**
 * Canonical catalog of all tools. Single source of truth — descriptions live
 * in tools/prompts/<name>.txt, schemas + execute functions are wired here.
 *
 * @type {Record<string, ToolDefinition>}
 */
export const TOOL_REGISTRY = {
  list_files: {
    description: loadPrompt('list_files'),
    inputSchema: z.object({}),
    execute: listFiles,
  },

  read_file: {
    description: loadPrompt('read_file'),
    inputSchema: z.object({
      path: z.string().describe('File path relative to project root'),
      fromLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('First line to read (1-indexed)'),
      toLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Last line to read (1-indexed, inclusive)'),
    }),
    execute: readFile,
  },

  create_file: {
    description: loadPrompt('create_file'),
    inputSchema: z.object({
      path: z.string().describe('File path relative to project root'),
      content: z.string().optional().describe('Initial file content'),
    }),
    execute: createFile,
  },

  edit_file: {
    description: loadPrompt('edit_file'),
    inputSchema: z.object({
      path: z.string().describe('File path'),
      oldText: z.string().describe('Exact text to replace (must match verbatim)'),
      newText: z.string().describe('Replacement text'),
    }),
    execute: editFile,
  },

  delete_file: {
    description: loadPrompt('delete_file'),
    inputSchema: z.object({
      path: z.string().describe('File path to delete'),
    }),
    execute: deleteFile,
  },

  move_file: {
    description: loadPrompt('move_file'),
    inputSchema: z.object({
      oldPath: z.string().describe('Current file path'),
      newPath: z.string().describe('New file path'),
    }),
    execute: moveFile,
  },

  get_outline: {
    description: loadPrompt('get_outline'),
    inputSchema: z.object({
      path: z.string().describe('File path'),
    }),
    execute: getOutline,
  },

  check_syntax: {
    description: loadPrompt('check_syntax'),
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Scope check to a single file, or omit for the whole project'),
    }),
    execute: checkSyntax,
  },

  compile_and_check: {
    description: loadPrompt('compile_and_check'),
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Root document to compile. Omit to use the project default.'),
    }),
    execute: compileAndCheck,
  },

  get_pdf_page: {
    description: loadPrompt('get_pdf_page'),
    inputSchema: z.object({
      page: z.number().int().positive().describe('1-indexed page number'),
    }),
    execute: getPdfPage,
  },

  list_skills: {
    description: loadPrompt('list_skills'),
    inputSchema: z.object({}),
    execute: listSkills,
  },

  read_skill: {
    description: loadPrompt('read_skill'),
    inputSchema: z.object({
      name: z.string().describe('Skill name as returned by list_skills'),
      template: z
        .string()
        .optional()
        .describe(
          'Template filename (e.g. "tcp_state_machine.tex"). Omit to get the guide and template index with descriptions.'
        ),
    }),
    execute: readSkill,
  },
}

/**
 * Look up a tool definition by name.
 * @param {string} name
 * @returns {ToolDefinition | undefined}
 */
export function getTool(name) {
  return TOOL_REGISTRY[name]
}

/**
 * @returns {string[]}
 */
export function listTools() {
  return Object.keys(TOOL_REGISTRY)
}
