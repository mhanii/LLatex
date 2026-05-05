import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
} from 'react-resizable-panels'
import classNames from 'classnames'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import PdfPreview from '@/features/pdf-preview/components/pdf-preview'
import { RailLayout } from '../rail/rail'
import { Toolbar } from '../toolbar/toolbar'
import { HorizontalToggler } from '@/features/ide-react/components/resize/horizontal-toggler'
import { useTranslation } from 'react-i18next'
import { usePdfPane } from '@/features/ide-react/hooks/use-pdf-pane'
import { useLayoutContext } from '@/shared/context/layout-context'
import { ElementType, useRef, useState } from 'react'
import EditorPanel from '../editor/editor-panel'
import { useRailContext } from '../../context/rail-context'
import HistoryContainer from '@/features/ide-react/components/history-container'
import { DefaultSynctexControl } from '@/features/pdf-preview/components/detach-synctex-control'
import importOverleafModules from '../../../../../macros/import-overleaf-module.macro'
import useCollapsiblePanel from '@/features/ide-react/hooks/use-collapsible-panel'
import ChatbotPanel from '@/features/ide-react/components/chatbot/chatbot-panel'

const mainEditorLayoutPanels: Array<{
  import: { default: ElementType }
  path: string
}> = importOverleafModules('mainEditorLayoutPanels')

const mainEditorLayoutModalsModules: Array<{
  import: { default: ElementType }
  path: string
}> = importOverleafModules('mainEditorLayoutModals')

export default function MainLayout() {
  const [resizing, setResizing] = useState(false)
  const { resizing: railResizing } = useRailContext()
  const {
    togglePdfPane,
    handlePdfPaneExpand,
    handlePdfPaneCollapse,
    setPdfIsOpen: setIsPdfOpen,
    pdfIsOpen: isPdfOpen,
    pdfPanelRef,
  } = usePdfPane()
  const { view, pdfLayout, editorPanelOpen, chatIsOpen } = useLayoutContext()
  const editorPanelRef = useRef<ImperativePanelHandle>(null)

  useCollapsiblePanel(editorPanelOpen, editorPanelRef)

  const editorIsOpen =
    editorPanelOpen &&
    (view === 'editor' || view === 'file' || pdfLayout === 'sideBySide')

  const { t } = useTranslation()

  return (
    <div className="ide-redesign-main">
      <Toolbar />
      <div className="ide-redesign-body">
        <PanelGroup
          autoSaveId="ide-redesign-outer-layout"
          direction="horizontal"
          className={classNames('ide-redesign-inner', {
            'ide-panel-group-resizing': resizing || railResizing,
          })}
        >
          <RailLayout />
          <Panel
            id="ide-redesign-chatbot-panel"
            order={2}
            minSize={12}
            defaultSize={20}
            maxSize={40}
            className={classNames({
              hidden: !chatIsOpen || view === 'history',
            })}
            tagName="section"
            aria-label={t('chat')}
          >
            <ChatbotPanel />
          </Panel>
          <HorizontalResizeHandle
            resizable
            onDragging={setResizing}
            hitAreaMargins={{ coarse: 0, fine: 0 }}
            className={classNames({
              hidden: !chatIsOpen || view === 'history',
            })}
          />
          <Panel id="ide-redesign-editor-and-pdf-panel" order={3}>
            <HistoryContainer />
            <PanelGroup
              autoSaveId="ide-redesign-editor-and-pdf-panel-group"
              direction="horizontal"
              className={classNames({
                hidden: view === 'history',
              })}
            >
              <Panel
                collapsible
                id="ide-redesign-editor-panel"
                order={1}
                className={classNames({
                  hidden: !editorIsOpen || view === 'history',
                })}
                ref={editorPanelRef}
                minSize={5}
                defaultSize={50}
                tagName="section"
                aria-label={t('editor')}
              >
                <div className="ide-redesign-editor-container">
                  <EditorPanel />
                </div>
              </Panel>
              <HorizontalResizeHandle
                resizable={pdfLayout === 'sideBySide'}
                onDragging={setResizing}
                onDoubleClick={togglePdfPane}
                hitAreaMargins={{ coarse: 0, fine: 0 }}
                className={classNames({
                  hidden: !editorIsOpen,
                })}
              >
                <HorizontalToggler
                  id="ide-redesign-pdf-panel"
                  togglerType="east"
                  isOpen={isPdfOpen}
                  setIsOpen={setIsPdfOpen}
                  tooltipWhenOpen={t('tooltip_hide_pdf')}
                  tooltipWhenClosed={t('tooltip_show_pdf')}
                />
                {pdfLayout === 'sideBySide' && (
                  <div className="synctex-controls">
                    <DefaultSynctexControl />
                  </div>
                )}
              </HorizontalResizeHandle>
              <Panel
                collapsible
                className={classNames('ide-redesign-pdf-container', {
                  hidden: view === 'history',
                })}
                id="ide-redesign-pdf-panel"
                order={2}
                defaultSize={50}
                minSize={5}
                ref={pdfPanelRef}
                onExpand={handlePdfPaneExpand}
                onCollapse={handlePdfPaneCollapse}
                tagName="section"
                aria-label={t('pdf_preview')}
              >
                <PdfPreview />
                {pdfLayout === 'flat' && view === 'pdf' && (
                  <div className="synctex-controls" hidden>
                    <DefaultSynctexControl />
                  </div>
                )}
              </Panel>
            </PanelGroup>
          </Panel>
          {mainEditorLayoutPanels.map(
            ({ import: { default: Component }, path }, i) => {
              return <Component key={path} order={i + 4} />
            }
          )}
        </PanelGroup>
      </div>
      {mainEditorLayoutModalsModules.map(
        ({ import: { default: Component }, path }) => (
          <Component key={path} />
        )
      )}
    </div>
  )
}
