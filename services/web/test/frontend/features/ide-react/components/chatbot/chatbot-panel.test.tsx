import { expect } from 'chai'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import sinon from 'sinon'

import ChatbotPanel from '@/features/ide-react/components/chatbot/chatbot-panel'
import { emitChatbotPrefill } from '@/features/ide-react/components/chatbot/chatbot-prefill-events'
import { renderWithEditorContext } from '../../../../helpers/render-with-context'

describe('<ChatbotPanel />', function () {
  const user = {
    id: 'fake_user',
    email: 'fake@example.com',
    signUpDate: '2025-10-10T10:10:10Z',
  }

  let clipboardStub: sinon.SinonStub

  beforeEach(function () {
    clipboardStub = sinon.stub().resolves()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardStub,
      },
    })
  })

  afterEach(function () {
    delete (window.navigator as Navigator & { clipboard?: unknown }).clipboard
  })

  it('allows editing a user message and truncates the later conversation', async function () {
    renderWithEditorContext(<ChatbotPanel />, { user })

    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'first turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'second turn' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getAllByText('first turn')).to.have.length(2)
    expect(screen.getAllByText('second turn')).to.have.length(2)

    expect(screen.queryByRole('button', { name: 'Edit message' })).to.not.exist
    expect(screen.queryByRole('button', { name: 'Copy' })).to.not.exist

    const firstUserMessage = screen.getAllByText('first turn')[0].closest('article')
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

    expect(screen.getAllByText('first turn edited')).to.have.length(2)
    expect(screen.getAllByRole('button', { name: 'Edit message' })).to.have.length(
      1
    )
  })

  it('renders a non-editable reference box for rewrite selections', async function () {
    renderWithEditorContext(<ChatbotPanel />, { user })

    await act(async () => {
      emitChatbotPrefill('', {
        referenceText: 'Selected section from the PDF',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('"Selected section from the PDF"')).to.exist
    })

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).to.equal(
      ''
    )
    expect(screen.queryByText('""')).to.not.exist
  })

  it('shows the source line range when it is available', async function () {
    renderWithEditorContext(<ChatbotPanel />, { user })

    await act(async () => {
      emitChatbotPrefill('', {
        referenceText: 'Selected section from the PDF',
        referenceLines: { start: 20, end: 21 },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Lineas 20-21')).to.exist
    })
  })

  it('clears the active reference when the x button is clicked', async function () {
    renderWithEditorContext(<ChatbotPanel />, { user })

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
      expect(screen.queryByText('Lineas 20-21')).to.not.exist
      expect(screen.queryByText('"Selected section from the PDF"')).to.not.exist
    })
  })
})
