#!/usr/bin/env node

/**
 * Test script to verify status message persistence
 * Usage: npm run test:status-persistence (from services/web)
 */

import { db, ObjectId } from './app/src/infrastructure/mongodb.mjs'

async function testStatusPersistence() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...')
    
    // Create test data
    const projectId = new ObjectId()
    const userId = new ObjectId()
    const conversationId = new ObjectId()
    
    console.log('\n1. Creating test conversation...')
    const convResult = await db.agentConversations.insertOne({
      _id: conversationId,
      projectId,
      createdBy: userId,
      title: 'Test Chat',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: null,
      lastRunId: null,
      messages: [],
    })
    console.log('✓ Conversation created:', conversationId.toString())
    
    // Simulate what happens when recordMessage is called with role: 'status'
    console.log('\n2. Recording status message (like agentToolCall does)...')
    const testMessage = {
      id: new ObjectId().toHexString(),
      content: 'compile_and_check completed',
      timestamp: Date.now(),
      user_id: userId.toString(),
    }
    
    const recordResult = await db.agentConversations.updateOne(
      {
        _id: conversationId,
        projectId,
        'messages.messageId': { $ne: testMessage.id },
      },
      {
        $set: {
          updatedAt: new Date(),
          lastMessageAt: new Date(testMessage.timestamp),
          lastRunId: 'test-run-1',
        },
        $push: {
          messages: {
            messageId: testMessage.id,
            role: 'status',
            runId: 'test-run-1',
            createdAt: new Date(),
          },
        },
      }
    )
    console.log('✓ Status message recorded:', testMessage.id)
    
    // Verify it was stored
    console.log('\n3. Verifying message in database...')
    const conv = await db.agentConversations.findOne({
      _id: conversationId,
    })
    console.log('Stored messages:', JSON.stringify(conv.messages, null, 2))
    
    // Test getMessageRoles like the controller does
    console.log('\n4. Testing getMessageRoles retrieval...')
    const rolesMap = new Map()
    for (const msg of conv?.messages ?? []) {
      rolesMap.set(msg.messageId, {
        role: msg.role,
        runId: msg.runId ?? null,
      })
    }
    console.log('✓ Roles map:', Array.from(rolesMap.entries()))
    
    // Simulate what getConversationMessages returns
    console.log('\n5. Simulating getConversationMessages response...')
    const threadMessages = [
      {
        id: testMessage.id,
        content: testMessage.content,
        user_id: testMessage.user_id,
        timestamp: testMessage.timestamp,
      },
    ]
    
    const response = threadMessages.map(message => ({
      ...message,
      role: rolesMap.get(message.id)?.role ?? (message.user_id ? 'user' : 'assistant'),
    }))
    
    console.log('✓ Response with roles:', JSON.stringify(response, null, 2))
    
    if (response[0].role === 'status') {
      console.log('\n✅ SUCCESS: Status messages persist correctly!')
    } else {
      console.log('\n❌ FAIL: Status role not assigned')
    }
    
    // Cleanup
    console.log('\n6. Cleaning up...')
    await db.agentConversations.deleteOne({ _id: conversationId })
    console.log('✓ Cleaned up test data')
    
  } catch (err) {
    console.error('❌ Test failed:', err)
    process.exit(1)
  }
}

testStatusPersistence().then(() => {
  console.log('\nTest completed!')
  process.exit(0)
})
