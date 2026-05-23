import React from 'react'

interface ChatbotDebugPanelProps {
  onSimulateToolCall: (
    toolName: string,
    input?: Record<string, unknown>,
    status?: 'running' | 'completed' | 'error',
    durationMs?: number
  ) => void
  onSimulateConversation?: () => Promise<void>
}

export const ChatbotDebugPanel: React.FC<ChatbotDebugPanelProps> = ({ 
  onSimulateToolCall,
  onSimulateConversation 
}) => {
  const [isSimulating, setIsSimulating] = React.useState(false)

  const handleSimulateConversation = async () => {
    if (onSimulateConversation && !isSimulating) {
      setIsSimulating(true)
      try {
        await onSimulateConversation()
      } finally {
        setIsSimulating(false)
      }
    }
  }

  return (
    <div className="ide-chatbot-debug-panel" style={{
      position: 'sticky',
      bottom: '10px',
      marginTop: '8px',
      padding: '12px 8px',
      borderTop: '1px solid var(--border-divider-themed)',
      background: 'var(--bg-secondary-themed)',
      borderRadius: '8px',
      margin: '0 var(--spacing-04) var(--spacing-02)',
      minHeight: '160px',
      maxHeight: '160px',
      overflowY: 'auto',
    }}>
      <div style={{
        fontSize: '10px',
        opacity: 0.6,
        fontWeight: 'bold',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Debug Console (Tools)
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        justifyContent: 'flex-start'
      }}>
        <button 
          className="btn btn-sm" 
          style={{ 
            fontSize: '11px', 
            padding: '4px 8px',
            background: '#28a745',
            color: 'white',
            opacity: isSimulating ? 0.6 : 1,
            cursor: isSimulating ? 'not-allowed' : 'pointer'
          }}
          onClick={handleSimulateConversation}
          disabled={isSimulating}
        >
          {isSimulating ? '💭 Simulating...' : '🎭 Simulate Full Conversation'}
        </button>

        <div style={{ width: '100%', height: '1px', background: 'var(--border-divider-themed)', margin: '4px 0' }} />

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('list_files', {}, 'completed', 1500)}>📂 list</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('read_file', { path: 'src/main.py' }, 'completed', 1500)}>🔍 read</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('create_file', { path: 'new.py' }, 'completed', 1500)}>➕ create</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('edit_file', { path: 'src/config.py' }, 'completed', 2000)}>✏️ edit</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('delete_file', { path: 'temp.log' }, 'completed', 1200)}>🗑️ delete</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('move_file', { path: 'a.js', newPath: 'b.js' }, 'completed', 1500)}>🚚 move</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('get_outline', {}, 'completed', 1000)}>📋 outline</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('check_syntax', {}, 'completed', 1500)}>✅ syntax</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('compile_and_check', {}, 'completed', 2500)}>🔧 compile</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('get_pdf_page', { page: 5 }, 'completed', 1800)}>📄 pdf</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('list_skills', {}, 'completed', 1000)}>🧠 skills</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => onSimulateToolCall('read_skill', { path: 'refactor' }, 'completed', 1200)}>📖 read_sk</button>

        <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px', background: '#dc3545', color: 'white' }}
          onClick={() => onSimulateToolCall('read_file', { path: 'error.txt' }, 'error', 1500)}>❌ ERROR</button>
      </div>
    </div>
  )
}