# Clear Conversation Issue - Executive Summary

## Problem Statement

The "Clear conversation" (×) button in the collaboration tool appears to work but **messages come back** when you reopen the same conversation by dragging the user again.

## Root Cause

The clear operation only affects the **frontend in-memory state** and does not persist to the backend storage:

1. ✅ Frontend clears `conversation.events` array
2. ✅ UI shows empty transcript  
3. ❌ **No backend API call made**
4. ❌ Messages still exist in disk files
5. ❌ Reopening conversation calls `/api/llm/conversation` 
6. ❌ Backend reloads full message history from disk
7. ❌ All messages are back!

## Technical Details

### Where Conversations Are Stored

**LLM Conversations (Cursor/Claude/Codex):**
- Disk location: `~/.subjective_chat_history/` + provider directories
- Cursor: SQLite databases (`.cursor/`, `workspaceStorage/*/state.vscdb`)
- Claude: JSON conversation files
- Loaded via: Python pipeline (`llmService.refreshHistory()`)
- **Current implementation**: Read-only from frontend perspective

**IRC Conversations:**
- In-memory only (standard IRC, ephemeral)
- No persistence → clear works correctly ✅

### Current Code Flow

```javascript
// renderer.js:2185
function clearConversationMessages(target) {
  const conversation = conversations.get(target);
  conversation.events = [];  // ⚠️ Only clears in-memory
  renderVisibleFrameTranscripts();
  // No backend call!
}
```

When conversation is reopened:
```javascript
bridge.getLlmConversation(target)
  → GET /api/llm/conversation?target=...
  → llmService.reloadConversation(target)
  → Re-parses disk files
  → Returns full message history
```

## Solution Options

### Option A: Add Backend "Clear" API ⭐ **RECOMMENDED**

**Implementation:**
- New endpoint: `POST /api/llm/clear-conversation`
- For **local** conversations: Delete conversation file from disk
- For **provider history** (Cursor/Claude/Codex): Return error (read-only)
- Frontend calls API and handles errors gracefully

**Pros:**
- Matches user expectation ("clear" means "delete forever")
- Clear separation: writable vs read-only
- Consistent with existing `deleteLlmConversation` pattern

**Cons:**
- Irreversible operation (may want confirmation dialog)
- Cannot clear provider history (Cursor/Claude/Codex files)

**Files to modify:**
1. `src/llmService.js` - Add `clearConversationMessages(target)` method
2. `src/webServer.js` - Add route handler
3. `src/main.js` - Add Electron IPC handler
4. `web/webBridge.js` - Add client method
5. `src/renderer.js` - Update to call backend API

---

### Option B: "Clear from View Only" with Better UX

**Implementation:**
- Keep current behavior (temporary hide)
- Change button label: "Clear from view" or "Hide messages"
- Add tooltip: "Messages will reload from history"
- Show visual indicator when messages are hidden

**Pros:**
- Non-destructive
- Works for all conversation types
- No backend changes needed

**Cons:**
- Misleading if users expect permanent deletion
- Doesn't solve the actual problem

---

### Option C: Hybrid Approach

**Implementation:**
- IRC conversations: Clear permanently (in-memory only)
- Local LLM conversations: Delete file from disk (backend API)
- Provider history: Show "Read-only, cannot clear" message

**Pros:**
- Behavior matches conversation type
- Clear is destructive only where it makes sense
- Best user experience

**Cons:**
- More complex implementation
- Need to distinguish conversation types in UI

---

### Option D: Delete Conversation Entirely (Existing Pattern)

**Implementation:**
- Use existing `deleteLlmConversation` API instead of new endpoint
- Removes conversation from list entirely
- Marks as hidden (won't show up again)

**Pros:**
- No new backend code needed
- Clear user action (conversation is gone)

**Cons:**
- More drastic than "clear messages"
- Conversation disappears from sidebar
- User has to recreate conversation to continue

## Recommendation

**Implement Option C (Hybrid Approach):**

1. **IRC**: Clear works as-is (ephemeral) ✅
2. **Local LLM conversations**: Add backend API to delete file permanently
3. **Provider history**: Show friendly error: "This conversation is loaded from [Cursor/Claude/Codex] history and cannot be modified. Use 'Delete conversation' to hide it from view."

This matches user mental models:
- "Clear" = remove messages (destructive)
- Behavior differs based on what's technically possible
- Clear error messages when operation isn't supported

## Decision Required

**Which option do you prefer?**
- Option A: Backend API for writable conversations only
- Option B: Just improve UX messaging (non-destructive)
- Option C: Hybrid with different behavior per type ⭐
- Option D: Use existing delete conversation API

Once decided, I can implement the chosen solution.

## Related Files

- Analysis: `CLEAR_CHAT_ANALYSIS.md` (detailed technical breakdown)
- Issues: `ISSUES_PROMPT.txt` (added to HIGH priority items)
- Code: `src/renderer.js:2185` (current implementation)
