# Clear Chat Feature - Root Cause Analysis

## Problem
When clicking the × (clear) button on a chat:
1. ✅ It **does** clear messages from the in-memory `conversations` Map
2. ❌ It **does NOT** clear messages from the persistent storage (database/disk files)
3. ❌ When you reopen the same conversation (drag & drop user again), messages reload from storage

## Architecture Discovery

### Where Conversations Are Stored

#### LLM Conversations (Cursor/Claude/Codex)
- **Location**: `~/.subjective_chat_history/` and provider-specific dirs
- **How loaded**: Python pipeline `historyRuntime` scans:
  - Cursor: SQLite databases (`.cursor/` dirs, `workspaceStorage/*/state.vscdb`)
  - Claude: JSON conversation files
  - Codex: Unknown format (TBD)
- **Refresh**: `llmService.refreshHistory()` re-scans disk files
- **In-memory**: Stored in `llmService.local[]` array
- **Delete**: `llmService.deleteConversation(target)` marks as hidden, but doesn't delete disk files

#### IRC Conversations
- **Location**: In-memory only (`conversations` Map in renderer.js)
- **No persistence**: IRC messages are ephemeral (standard IRC behavior)

### Current Implementation

#### `clearConversationMessages(target)` (renderer.js:2185)
```javascript
function clearConversationMessages(target) {
  const conversation = conversations.get(target);
  if (!conversation) return;
  conversation.events = [];  // ⚠️ Only clears in-memory
  conversation.unread = 0;
  conversation.updatedAt = Date.now();
  renderVisibleFrameTranscripts();
  renderConversations();
}
```

**What it does:**
- ✅ Clears `conversation.events` array in memory
- ✅ Re-renders UI to show empty transcript
- ❌ **Does NOT** persist the clear operation
- ❌ **Does NOT** modify disk files
- ❌ **Does NOT** call any backend API

### Why Reopening Restores Messages

When you drag & drop a user to reopen a conversation:

1. **IRC**: `assignChatFrame()` → `ensureConversation(target)` → conversation already in `conversations` Map with cleared events → stays empty ✅

2. **LLM**: 
   - `assignChatFrame()` → calls `bridge.getLlmConversation(target)`
   - This calls `/api/llm/conversation?target=...`
   - Backend calls `llmService.reloadConversation(target)`
   - This **re-parses the conversation from disk files**
   - Returns full message history from disk
   - Renderer receives full history and populates `conversation.messages`
   - All messages are back! ❌

## Root Cause

**The clear operation is purely client-side and ephemeral. There's no backend persistence.**

## Solutions

### Option 1: Delete Conversation Entirely (Current Pattern)
Use the existing `deleteLlmConversation` API:
- Marks conversation as hidden (adds to `hiddenTargets`)
- Removes from `llmService.local[]`
- Closes all chat frames showing it
- **Still doesn't delete disk files** (by design, for safety)
- Messages come back on next `refreshHistory()` unless conversation is actually deleted from disk

### Option 2: Add "Clear Messages" Backend API ⭐ RECOMMENDED
Create new endpoint that actually modifies the conversation:

**Backend Changes:**
1. Add `clearConversationMessages(target)` to `llmService.js`
2. Add `POST /api/llm/clear-conversation` route
3. Implementation:
   - For **local** conversations: Delete the conversation file/record
   - For **Cursor/Claude/Codex**: Cannot modify provider's history (read-only)
   - Return error if conversation is read-only
   - Broadcast `llm-conversation-cleared` event

**Frontend Changes:**
1. Update `clearConversationMessages()` to call backend API
2. Handle read-only conversations gracefully
3. Show error message if clear fails

### Option 3: Client-Side Only (IRC Pattern)
Keep LLM conversations read-only, only allow clearing IRC messages:
- Check `conversation.kind === 'irc'` before clearing
- Show error for LLM conversations
- Explain they're backed by provider history files

### Option 4: "Hide Until Refresh" Pattern
Current behavior is actually reasonable for read-only history:
- Clear messages from view temporarily
- Explain they'll reload on refresh
- Add UI indicator "Messages hidden (will reload from history)"

## Recommended Fix

**Hybrid Approach:**

1. **IRC Messages**: Clear permanently (already works, just needs persistence check)
2. **LLM Local Conversations**: Add backend API to actually delete from disk
3. **LLM Provider History**: Show "Clear from view" with warning that they'll reload

### Implementation Steps

1. Add `clearConversationMessages` API endpoint
2. Differentiate writable vs read-only conversations
3. Update frontend to call API for writable, show warning for read-only
4. Add visual feedback (toast/message) explaining the operation
5. Update button labels based on conversation type:
   - IRC: "Clear messages"
   - LLM (local): "Delete conversation history"
   - LLM (provider): "Clear from view" or "Hide messages"

## Database Tables (For Reference)

Based on `UNRESOLVED_ISSUES.md`, there's a D1 database schema mentioned:
- `conversations` table exists in `services/subjective_api_chat/src/subjective_chat_api/schema.sql`
- But web chat uses **file-based** storage, not D1
- D1 is for the separate chat API service (not actively used by this client)

The actual storage is:
- **LLM**: Disk files in `~/.subjective_chat_history/` + provider dirs
- **IRC**: Ephemeral (in-memory only)
- **Web chat state**: `llmService` JSON state file

## Files to Modify

1. `src/llmService.js` - Add `clearConversationMessages(target)` method
2. `src/webServer.js` - Add `POST /api/llm/clear-conversation` route
3. `src/main.js` - Add IPC handler for Electron app
4. `web/webBridge.js` - Add `clearLlmConversation` client method
5. `src/renderer.js` - Update `clearConversationMessages()` to call backend
6. `src/renderer.js` - Add UI feedback for read-only conversations

## Decision Needed

**Which behavior do you want?**

A. **Delete forever** - Clear actually deletes conversation history from disk (irreversible)
B. **Clear from view** - Temporary hide, messages reload on refresh (current behavior, just needs better UX)
C. **Hybrid** - Delete for local/writable, hide for read-only provider history (most user-friendly)

Let me know which approach you prefer and I'll implement it!
