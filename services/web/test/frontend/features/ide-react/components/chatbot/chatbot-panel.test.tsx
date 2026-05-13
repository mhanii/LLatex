import { expect } from 'chai'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import sinon from 'sinon'

import ChatbotPanel from '@/features/ide-react/components/chatbot/chatbot-panel'
import { emitChatbotPrefill } from '@/features/ide-react/components/chatbot/chatbot-prefill-events'
import { SocketIOMock } from '@/ide/connection/SocketIoShim'
import { renderWithEditorContext } from '../../../../helpers/render-with-context'

describe('<ChatbotPanel />', function () {
  const user = {
    id: 'fake_user',
    email: 'fake@example.com',
    signUpDate: '2025-10-10T10:10:10Z',
  }

  let clipboardStub: sinon.SinonStub
  let fetchStub: sinon.SinonStub
  let sendCount: number
  const NoopProvider: React.FC<React.PropsWithChildren> = ({ children }) => (
    <>{children}</>
  )

  function jsonResponse(body: unknown, init: ResponseInit = {}) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        ...init,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    )
  }

  function stubAgentApi() {
    fetchStub = sinon.stub(globalThis, 'fetch').callsFake((input, options) => {
      const url = input.toString()
      const method = options?.method ?? 'GET'

      if (url.endsWith('/agent/conversations') && method === 'GET') {
        return jsonResponse([
          {
            id: 'conv-1',
            title: 'Draft help',
            createdAt: 1,
            updatedAt: 1,
            lastMessageAt: null,
            lastRunId: null,
          },
          {
            id: 'conv-2',
            title: 'Discuss chapter 2',
            createdAt: 2,
            updatedAt: 2,
            lastMessageAt: 2,
            lastRunId: null,
          },
        ])
      }

      if (
        url.endsWith('/agent/conversations/conv-1/messages') &&
        method === 'GET'
      ) {
        return jsonResponse([])
      }

      if (url.endsWith('/agent/conversations') && method === 'POST') {
        return jsonResponse(
          {
            id: 'conv-3',
            title: 'New chat',
            createdAt: 2,
            updatedAt: 2,
            lastMessageAt: null,
            lastRunId: null,
          },
          { status: 201 }
        )
      }

      if (url.endsWith('/agent/conversations/conv-1') && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/agent/conversations/conv-2') && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/agent/message') && method === 'POST') {
        sendCount += 1
        return jsonResponse(
          {
            runId: `run-${sendCount}`,
            messageId: `server-message-${sendCount}`,
            conversationId: 'conv-1',
          },
          { status: 202 }
        )
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
  }

  function renderChatbot(
    contextProps: Parameters<typeof renderWithEditorContext>[1] = {}
  ) {
    return renderWithEditorContext(<ChatbotPanel />, {
      ...contextProps,
      user,
      providers: {
        LocalCompileProvider: NoopProvider,
        DetachCompileProvider: NoopProvider,
        ...(contextProps.providers ?? {}),
      },
    })
  }

  beforeEach(function () {
    sendCount = 0
    stubAgentApi()
    clipboardStub = sinon.stub().resolves()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardStub,
      },
    })
  })

  afterEach(function () {
    fetchStub.restore()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  })

  it('sends messages to the agent endpoint and allows editing a prior user message', async function () {
    renderChatbot()

    await screen.findByRole('combobox', { name: 'Agent conversation' })
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).to.not.exist
    })
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'first turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    // Pending message appears immediately
    await waitFor(() => {
      expect(screen.getByText('first turn')).to.exist
    })

    // Wait for the API response to replace the pending message
    await waitFor(() => {
      expect(screen.queryByText('Failed to send.')).to.not.exist
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'second turn' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(screen.getByText('second turn')).to.exist
    })

    expect(screen.queryByRole('button', { name: 'Edit message' })).to.not.exist
    expect(screen.queryByRole('button', { name: 'Copy' })).to.not.exist

    const firstUserMessage = screen.getByText('first turn').closest('article')
    if (!firstUserMessage) {
      throw new Error('Expected to find the first user message article')
    }

    fireEvent.mouseEnter(firstUserMessage)

    expect(screen.getAllByRole('button', { name: 'Edit message' })).to.have.length(
      1
    )
    expect(screen.getAllByRole('button', { name: 'Copy message' })).to.have.length(
      1
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))

    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).to.equal(
        'first turn'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'first turn edited' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update message' }))

    await waitFor(() => {
      expect(screen.queryByText('second turn')).to.not.exist
    })

    expect(screen.getByText('first turn edited')).to.exist
    expect(fetchStub.calledWithMatch(sinon.match('/agent/message'))).to.equal(true)
  })

  it('renders agent replies and tool progress from socket events', async function () {
    const socket = new SocketIOMock()
    renderChatbot({ socket: socket as any })

    await screen.findByRole('combobox', { name: 'Agent conversation' })
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).to.not.exist
    })

    act(() => {
      socket.emitToClient('agent:tool-call', {
        conversationId: 'conv-1',
        runId: 'run-1',
        toolName: 'compile_and_check',
        status: 'running',
        timestamp: 1,
      })
      socket.emitToClient('agent:message', {
        conversationId: 'conv-1',
        message: {
          id: 'agent-message-1',
          user_id: user.id,
          content: 'Compiled and fixed it.',
          timestamp: 2,
          role: 'assistant',
        },
      })
    })

    expect(screen.getByText('Agent is compiling...')).to.exist
    expect(screen.getByText('Compiled and fixed it.')).to.exist
  })

  it('renders a non-editable reference box for rewrite selections', async function () {
    renderChatbot()

    await act(async () => {
      emitChatbotPrefill('', {
        referenceText: 'Selected section from the PDF',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Selected section from the PDF')).to.exist
    })

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).to.equal(
      ''
    )
    expect(screen.queryByText('""')).to.not.exist
  })

  it('shows the source line range when it is available', async function () {
    renderChatbot()

    await act(async () => {
      emitChatbotPrefill('', {
        referenceText: 'Selected section from the PDF',
        referenceLines: { start: 20, end: 21 },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Lines 20-21')).to.exist
    })
  })

  it('clears the active reference when the x button is clicked', async function () {
    renderChatbot()

    await act(async () => {
      emitChatbotPrefill('', {
        referenceText: 'Selected section from the PDF',
        referenceLines: { start: 20, end: 21 },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop referencing this text' })).to
        .exist
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Stop referencing this text' })
    )

    await waitFor(() => {
      expect(screen.queryByText('Lines 20-21')).to.not.exist
      expect(screen.queryByText('Selected section from the PDF')).to.not.exist
    })
  })

  it('allows deleting a conversation from the dropdown menu', async function () {
    const confirmStub = sinon.stub(window, 'confirm').returns(true)

    renderChatbot()

    await screen.findByRole('button', { name: 'Agent conversation' })
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).to.not.exist
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agent conversation' }))

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete chat Discuss chapter 2' })
    )

    await waitFor(() => {
      expect(confirmStub.called).to.equal(true)
      expect(
        fetchStub.calledWithMatch(
          sinon.match('/agent/conversations/conv-2'),
          sinon.match.has('method', 'DELETE')
        )
      ).to.equal(true)
    })

    confirmStub.restore()
  })
})
