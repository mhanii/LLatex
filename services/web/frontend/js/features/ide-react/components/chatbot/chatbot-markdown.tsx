import { FC, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

const LINK_REL = 'noreferrer noopener'
const LINK_TARGET = '_blank'

export const ChatbotMarkdown: FC<{ text: string }> = ({ text }) => {
  const components = useMemo(
    () => ({
      a: (props: any) => (
        <a {...props} rel={LINK_REL} target={LINK_TARGET} className="chatbot-link" />
      ),
      code: ({node, inline, className, children, ...props}: any) => {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
    }),
    []
  )

  return (
    <div className="ide-chatbot-message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}