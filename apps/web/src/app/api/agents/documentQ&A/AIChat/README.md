# Agent AI Chatbot API

Comprehensive backend API for the Agent AI Chatbot system with task execution, tool calling, memory management, and more.

## API Endpoints

### Chat Management

#### Create Chat
```
POST /api/agent-ai-chatbot/chats
Body: {
  userId: string
  title: string
  agentMode?: 'autonomous' | 'interactive' | 'assisted'
  visibility?: 'public' | 'private'
}
```

#### Get All Chats for User
```
GET /api/agent-ai-chatbot/chats?userId=xxx
```

#### Get Specific Chat with Messages and Tasks
```
GET /api/agent-ai-chatbot/chats/[chatId]
```

#### Update Chat
```
PATCH /api/agent-ai-chatbot/chats/[chatId]
Body: {
  title?: string
  status?: 'active' | 'completed' | 'paused' | 'failed'
  agentMode?: 'autonomous' | 'interactive' | 'assisted'
  visibility?: 'public' | 'private'
}
```

#### Delete Chat
```
DELETE /api/agent-ai-chatbot/chats/[chatId]
```

### Message Management

#### Send Message
```
POST /api/agent-ai-chatbot/messages
Body: {
  chatId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: any (JSON)
  messageType?: 'text' | 'tool_call' | 'tool_result' | 'thinking'
  parentMessageId?: string
}
```

#### Get Messages for Chat
```
GET /api/agent-ai-chatbot/messages?chatId=xxx
```

### Task Management

#### Create Task
```
POST /api/agent-ai-chatbot/tasks
Body: {
  chatId: string
  description: string
  objective: string
  priority?: number (default: 0)
  metadata?: any (JSON)
}
```

#### Get Tasks for Chat
```
GET /api/agent-ai-chatbot/tasks?chatId=xxx
```

#### Get Task with Execution Steps
```
GET /api/agent-ai-chatbot/tasks/[taskId]
```

#### Update Task
```
PATCH /api/agent-ai-chatbot/tasks/[taskId]
Body: {
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  result?: any (JSON)
  metadata?: any (JSON)
  completedAt?: string (ISO date)
}
```

### Tool Calls

#### Create Tool Call
```
POST /api/agent-ai-chatbot/tools
Body: {
  messageId: string
  taskId?: string
  toolName: string
  toolInput: any (JSON)
}
```

#### Get Tool Calls
```
GET /api/agent-ai-chatbot/tools?messageId=xxx
GET /api/agent-ai-chatbot/tools?taskId=xxx
```

#### Update Tool Call Result
```
PATCH /api/agent-ai-chatbot/tools/[toolCallId]
Body: {
  toolOutput?: any (JSON)
  status?: 'pending' | 'running' | 'completed' | 'failed'
  errorMessage?: string
  executionTimeMs?: number
}
```

### Execution Steps

#### Create Execution Step
```
POST /api/agent-ai-chatbot/execution-steps
Body: {
  taskId: string
  stepNumber: number
  stepType: 'reasoning' | 'planning' | 'execution' | 'evaluation' | 'decision'
  description: string
  reasoning?: string
  input?: any (JSON)
  output?: any (JSON)
}
```

#### Get Execution Steps for Task
```
GET /api/agent-ai-chatbot/execution-steps?taskId=xxx
```

#### Update Execution Step
```
PATCH /api/agent-ai-chatbot/execution-steps/[stepId]
Body: {
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  output?: any (JSON)
  reasoning?: string
}
```

### Voting

#### Vote on Message
```
POST /api/agent-ai-chatbot/votes
Body: {
  chatId: string
  messageId: string
  isUpvoted: boolean
  feedback?: string
}
```

#### Get Vote for Message
```
GET /api/agent-ai-chatbot/votes?chatId=xxx&messageId=xxx
```

### Memory Management

#### Store Memory
```
POST /api/agent-ai-chatbot/memory
Body: {
  chatId: string
  memoryType: 'short_term' | 'long_term' | 'working' | 'episodic'
  key: string
  value: any (JSON)
  importance?: number (1-10, default: 5)
  embedding?: number[] (vector)
  expiresAt?: string (ISO date)
}
```

#### Get Memories for Chat
```
GET /api/agent-ai-chatbot/memory?chatId=xxx&memoryType=xxx
```

## Response Format

All endpoints return JSON with the following structure:

### Success Response
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "error": "Error message",
  "details": "Additional details (optional)"
}
```

## Status Codes

- `200` - Success
- `400` - Bad Request (missing required fields)
- `404` - Not Found
- `500` - Internal Server Error

## Usage Examples

### Creating a New Chat and Sending Messages

```typescript
// 1. Create chat
const chatResponse = await fetch('/api/agent-ai-chatbot/chats', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    title: 'Help me analyze data',
    agentMode: 'interactive'
  })
});
const { chat } = await chatResponse.json();

// 2. Send user message
await fetch('/api/agent-ai-chatbot/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chatId: chat.id,
    role: 'user',
    content: { text: 'Can you help me analyze this data?' }
  })
});

// 3. Send AI response
await fetch('/api/agent-ai-chatbot/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chatId: chat.id,
    role: 'assistant',
    content: { text: 'I'd be happy to help! What data would you like to analyze?' }
  })
});
```

### Creating a Task with Execution Steps

```typescript
// 1. Create task
const taskResponse = await fetch('/api/agent-ai-chatbot/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chatId: 'chat123',
    description: 'Analyze sales data',
    objective: 'Identify top-selling products',
    priority: 1
  })
});
const { task } = await taskResponse.json();

// 2. Create execution steps
await fetch('/api/agent-ai-chatbot/execution-steps', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    taskId: task.id,
    stepNumber: 1,
    stepType: 'planning',
    description: 'Plan data analysis approach'
  })
});

// 3. Update step status
await fetch(`/api/agent-ai-chatbot/execution-steps/${stepId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: 'completed',
    output: { plan: '...' }
  })
});
```

## Notes

- All `chatId`, `messageId`, `taskId`, etc. are generated using `crypto.randomUUID()` for unique IDs
- Timestamps are managed automatically by the database
- Foreign key relationships ensure data integrity with cascade deletes
- The API supports rich JSON content for flexible message and data formats

