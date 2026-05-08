// @ts-check

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

/**
 * @typedef {Object} ToolDefinition
 * @property {string} description
 * @property {z.ZodTypeAny} inputSchema
 * @property {(input: any, ctx: import('../types.js').RunContext) => Promise<unknown>} execute
 */

/**
 * Canonical catalog of all tools. Single source of truth — no caller defines
 * descriptions or schemas anywhere else. Agents reference tools by name.
 *
 * @type {Record<string, ToolDefinition>}
 */
export const TOOL_REGISTRY = {
  list_files: {
    description: 'List all files in the project.',
    inputSchema: z.object({}),
    execute: listFiles,
  },

  read_file: {
    description:
      'Read lines from a LaTeX file. fromLine/toLine are 1-indexed and inclusive.',
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
    description: 'Create a new file in the project.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to project root'),
      content: z.string().optional().describe('Initial file content'),
    }),
    execute: createFile,
  },

  edit_file: {
    description:
      'Replace exact text in a file as a tracked change. Re-read the file first to get exact text. Prefer small, targeted replacements over rewriting whole sections.',
    inputSchema: z.object({
      path: z.string().describe('File path'),
      oldText: z.string().describe('Exact text to replace (must match verbatim)'),
      newText: z.string().describe('Replacement text'),
    }),
    execute: editFile,
  },

  delete_file: {
    description: 'Delete a file from the project.',
    inputSchema: z.object({
      path: z.string().describe('File path to delete'),
    }),
    execute: deleteFile,
  },

  move_file: {
    description: 'Rename or move a file within the project.',
    inputSchema: z.object({
      oldPath: z.string().describe('Current file path'),
      newPath: z.string().describe('New file path'),
    }),
    execute: moveFile,
  },

  get_outline: {
    description:
      'Get the structural outline (sections, subsections, environments) of a LaTeX file.',
    inputSchema: z.object({
      path: z.string().describe('File path'),
    }),
    execute: getOutline,
  },

  check_syntax: {
    description:
      'Run structural analysis on project documents without compiling. Detects undefined refs, duplicate labels, missing includes, and unbalanced environments.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Scope check to a single file, or omit for the whole project'),
    }),
    execute: checkSyntax,
  },

  compile_and_check: {
    description:
      'Compile the project and return the structured LaTeX log entries the editor shows the user (errors, warnings, typesetting). Each entry has level/file/line/message/ruleId. Call after edits to verify the document still compiles.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Root document to compile. Omit to use the project default.'),
    }),
    execute: compileAndCheck,
  },

  get_pdf_page: {
    description:
      'Return a page of the most recently compiled PDF as a base64-encoded PNG. Call compile_and_check first to ensure an up-to-date PDF exists.',
    inputSchema: z.object({
      page: z.number().int().positive().describe('1-indexed page number'),
    }),
    execute: getPdfPage,
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
