// @ts-check
import { expect } from 'chai'
import {
  TOOL_REGISTRY,
  getTool,
  listTools,
} from '../../../app/js/tools/registry.js'

const EXPECTED_TOOLS = [
  'list_files',
  'read_file',
  'create_file',
  'edit_file',
  'delete_file',
  'move_file',
  'get_outline',
  'check_syntax',
  'compile_and_check',
  'get_pdf_page',
]

describe('tools/registry', function () {
  describe('TOOL_REGISTRY', function () {
    it('contains exactly the 10 expected tools', function () {
      expect(Object.keys(TOOL_REGISTRY).sort()).to.deep.equal(
        [...EXPECTED_TOOLS].sort()
      )
    })

    it('each entry has description, inputSchema, and execute', function () {
      for (const name of EXPECTED_TOOLS) {
        const def = TOOL_REGISTRY[name]
        expect(def, `${name}.description`).to.have.property('description').that.is.a('string').and.is.not.empty
        expect(def, `${name}.inputSchema`).to.have.property('inputSchema')
        expect(def.inputSchema, `${name}.inputSchema._def`).to.have.property('_def')
        expect(def.execute, `${name}.execute`).to.be.a('function')
      }
    })

    it('inputSchema is a Zod object that successfully parses an empty object for tools with all-optional inputs', function () {
      // list_files has no inputs; check_syntax and compile_and_check have only optional inputs
      const allOptional = ['list_files', 'check_syntax', 'compile_and_check']
      for (const name of allOptional) {
        const result = TOOL_REGISTRY[name].inputSchema.safeParse({})
        expect(result.success, `${name} should accept {}`).to.be.true
      }
    })

    it('inputSchema rejects missing required fields for tools with required inputs', function () {
      // read_file requires `path`; edit_file requires path/oldText/newText
      expect(TOOL_REGISTRY.read_file.inputSchema.safeParse({}).success).to.be.false
      expect(TOOL_REGISTRY.edit_file.inputSchema.safeParse({}).success).to.be.false
      expect(TOOL_REGISTRY.move_file.inputSchema.safeParse({ oldPath: 'a' }).success).to.be.false
    })
  })

  describe('getTool', function () {
    it('returns the registered tool by name', function () {
      const def = getTool('list_files')
      expect(def).to.equal(TOOL_REGISTRY.list_files)
    })

    it('returns undefined for unknown tool names', function () {
      expect(getTool('does_not_exist')).to.be.undefined
    })
  })

  describe('listTools', function () {
    it('returns all 10 tool names', function () {
      expect(listTools()).to.have.lengthOf(10)
      expect(listTools().sort()).to.deep.equal([...EXPECTED_TOOLS].sort())
    })
  })
})
