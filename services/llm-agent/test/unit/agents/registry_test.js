// @ts-check
import { expect } from 'chai'
import {
  AGENT_REGISTRY,
  getAgent,
  listAgents,
  defaultAgent,
} from '../../../app/js/agents/registry.js'
import { TOOL_REGISTRY } from '../../../app/js/tools/registry.js'

describe('agents/registry', function () {
  describe('AGENT_REGISTRY', function () {
    it('contains default and readonly agents', function () {
      expect(Object.keys(AGENT_REGISTRY).sort()).to.deep.equal([
        'default',
        'readonly',
      ])
    })

    it('every agent has the required AgentInfo fields', function () {
      for (const [name, agent] of Object.entries(AGENT_REGISTRY)) {
        expect(agent.name, `${name}.name`).to.equal(name)
        expect(agent.description, `${name}.description`).to.be.a('string').and.not.empty
        expect(agent.systemPrompt, `${name}.systemPrompt`).to.be.a('string').and.not.empty
        expect(agent.allowedTools, `${name}.allowedTools`).to.be.an('array').and.not.empty
      }
    })

    it('every allowedTool exists in TOOL_REGISTRY', function () {
      for (const [name, agent] of Object.entries(AGENT_REGISTRY)) {
        for (const toolName of agent.allowedTools) {
          expect(TOOL_REGISTRY, `${name} references unknown tool ${toolName}`)
            .to.have.property(toolName)
        }
      }
    })

    it('default agent has access to all 11 tools', function () {
      expect(AGENT_REGISTRY.default.allowedTools).to.have.lengthOf(11)
    })

    it('readonly agent excludes all mutation tools', function () {
      const mutationTools = ['create_file', 'edit_file', 'delete_file', 'move_file']
      for (const t of mutationTools) {
        expect(AGENT_REGISTRY.readonly.allowedTools).to.not.include(t)
      }
    })

    it('readonly agent retains read/inspection and skills tools', function () {
      const readonlyTools = [
        'list_files',
        'read_file',
        'get_outline',
        'check_syntax',
        'compile_and_check',
        'get_pdf_page',
        'list_skills',
        'read_skill',
      ]
      expect(AGENT_REGISTRY.readonly.allowedTools.sort()).to.deep.equal(
        [...readonlyTools].sort()
      )
    })

    it('agent system prompts come from on-disk files (loaded once at import)', function () {
      // sanity check that the prompt loader actually read something file-shaped
      expect(AGENT_REGISTRY.default.systemPrompt).to.match(/LaTeX/)
      expect(AGENT_REGISTRY.readonly.systemPrompt).to.match(/read-only/i)
    })
  })

  describe('getAgent', function () {
    it('returns the registered agent by name', function () {
      expect(getAgent('default')).to.equal(AGENT_REGISTRY.default)
      expect(getAgent('readonly')).to.equal(AGENT_REGISTRY.readonly)
    })

    it('returns undefined for unknown agent names', function () {
      expect(getAgent('nope')).to.be.undefined
    })
  })

  describe('listAgents', function () {
    it('returns all registered agents', function () {
      const list = listAgents()
      expect(list).to.have.lengthOf(2)
      expect(list.map(a => a.name).sort()).to.deep.equal(['default', 'readonly'])
    })
  })

  describe('defaultAgent', function () {
    it('returns the default agent', function () {
      expect(defaultAgent()).to.equal(AGENT_REGISTRY.default)
    })
  })
})
