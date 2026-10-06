# TAGGY-3452: Backend Status Persistence on Page Reload

## Problem Statement

When a user initiates an LLM backend processing task and then reloads the page or navigates away and returns, the UI loses visibility of the ongoing backend processing status. The backend may continue processing, but the UI shows nothing, breaking the continuity contract between frontend and backend.

## Root Cause Analysis

The LLM conversation state (including `busy`, `progress`, `busySince`, and `thoughts` fields) is stored exclusively in the `conversations` Map in `src/renderer.js` (line 90). This Map is held in JavaScript memory and is completely lost when the page reloads.

**Flow before fix:**
1. User sends message to LLM
2. Backend starts processing, emits `llm-busy: true` event
3. Renderer updates `conversation.busy = true` in memory Map
4. Shows "thinking" bubble with progress updates
5. **User reloads page**
6. `conversations` Map is reset to empty
7. When conversation is re-hydrated, backend might still be processing but frontend has lost all state
8. No "thinking" indicator shown even though backend is still working

## Solution Architecture

Implement **localStorage-based persistence** for LLM processing state that survives page reloads:

### Components Added

1. **`persistLlmProcessingState(target, state)`** - Saves processing state to localStorage
   - Stores: busy flag, progress text, busySince timestamp, thoughts array
   - Auto-cleanup: deletes entry when busy becomes false
   - Location: `src/renderer.js` after conversations Map declaration

2. **`restoreLlmProcessingState(target)`** - Restores processing state on page load
   - Returns persisted state if valid and recent (< 30 minutes old)
   - Auto-cleanup: deletes stale states (> 30 minutes)
   - Returns null if no valid state exists

3. **`clearLlmProcessingState(target)`** - Explicit cleanup helper

### Integration Points

#### 1. State Persistence (Write Path)

**Location:** `src/renderer.js`, `llm-busy` event handler (line ~3520)
```javascript
case 'llm-busy': {
  const conversation = conversations.get(event.target);
  if (conversation) {
    conversation.busy = event.busy;
    conversation.busySince = event.busy ? Date.now() : 0;
    if (event.busy) conversation.thoughts = [];
    else conversation.progress = '';
    
    // TAGGY-3452: Persist processing state to survive page reload
    persistLlmProcessingState(event.target, conversation);
    
    // ... rest of handler
  }
}
```

**Location:** `src/renderer.js`, `llm-progress` event handler (line ~3500)
```javascript
case 'llm-progress': {
  const conversation = conversations.get(event.target);
  if (conversation && event.text) {
    conversation.progress = event.text;
    if (!Array.isArray(conversation.thoughts)) conversation.thoughts = [];
    if (conversation.thoughts[conversation.thoughts.length - 1] !== event.text) {
      conversation.thoughts.push(event.text);
      if (conversation.thoughts.length > 100) conversation.thoughts.shift();
    }
    
    // TAGGY-3452: Persist progress updates
    if (conversation.busy) {
      persistLlmProcessingState(event.target, conversation);
    }
    
    updateThinkingSteps(event.target, conversation);
  }
}
```

#### 2. State Restoration (Read Path)

**Location:** `src/renderer.js`, `upsertLlmConversation` function (line ~2970)
```javascript
function upsertLlmConversation(payload) {
  // ... existing hydration logic ...
  
  if (typeof payload.busy === 'boolean') conversation.busy = payload.busy;
  
  // TAGGY-3452: Restore persisted processing state on page reload
  // If backend says not busy but we have persisted state, restore the "thinking" UI
  if (!conversation.busy && !existing) {
    const persistedState = restoreLlmProcessingState(payload.target);
    if (persistedState) {
      conversation.busy = persistedState.busy;
      conversation.busySince = persistedState.busySince;
      conversation.progress = persistedState.progress;
      conversation.thoughts = persistedState.thoughts;
      rendererLog('info', 'Restored LLM processing state from localStorage', {
        target: payload.target,
        progress: persistedState.progress,
        thoughtCount: persistedState.thoughts.length
      });
    }
  }
  
  // ... rest of function ...
}
```

## State Schema

**localStorage key:** `subjective-llm-processing-state`

**Value:** JSON object mapping conversation targets to state:
```json
{
  "llm://claude/workspace1": {
    "busy": true,
    "progress": "Analyzing repository structure...",
    "busySince": 1696608000000,
    "thoughts": [
      "Reading project files",
      "Analyzing dependencies",
      "Generating response"
    ],
    "timestamp": 1696608123456
  }
}
```

## Edge Cases Handled

1. **Stale State Cleanup**: States older than 30 minutes are automatically ignored and deleted
2. **Backend Completion During Reload**: If backend finishes while page is reloading, the `llm-busy: false` event will clear the persisted state
3. **Multiple Conversations**: Each conversation's state is stored independently
4. **Storage Errors**: Try-catch blocks prevent localStorage quota/private mode errors from breaking the app
5. **Backend Authoritative**: Backend's busy state always takes precedence over persisted state (see existing comment in upsertLlmConversation)

## Testing

Created comprehensive test suite: `tests/llmProcessingStatePersistence.test.js`

**Test coverage:**
- ✅ Persist busy state with progress and thoughts
- ✅ Clear persisted state when busy becomes false
- ✅ Handle multiple conversations independently
- ✅ Restore persisted state on page load
- ✅ Ignore stale state older than 30 minutes
- ✅ Return null for non-existent/non-busy conversations
- ✅ Integration scenario: complete page reload during LLM processing

## Files Changed

1. **src/renderer.js**
   - Added: `persistLlmProcessingState()`, `restoreLlmProcessingState()`, `clearLlmProcessingState()`
   - Modified: `llm-busy` event handler - added persist call
   - Modified: `llm-progress` event handler - added persist call for progress updates
   - Modified: `upsertLlmConversation()` - added state restoration on conversation hydration

2. **tests/llmProcessingStatePersistence.test.js** (new)
   - Complete test suite for persistence/restoration logic
   - Integration tests for page reload scenarios

## Verification Steps

1. Start the app and open an LLM conversation
2. Send a message that triggers LLM processing
3. Observe "thinking" bubble with progress updates
4. **While LLM is still processing**, reload the page (Cmd+R / Ctrl+R)
5. **Expected**: After reload, the conversation should immediately show the "thinking" bubble with the last known progress
6. Wait for LLM to complete
7. **Expected**: The "thinking" bubble disappears and response appears
8. Check localStorage in DevTools: `subjective-llm-processing-state` should be empty (no active tasks)

## Behavior Changes

**Before:**
- Page reload → Lost all processing state → User sees nothing even if backend still working
- User confusion: "Did my request work? Should I resend?"

**After:**
- Page reload → State restored from localStorage → User sees "thinking" indicator continues
- Clear continuity: User knows their request is still being processed
- Auto-cleanup: Stale states (> 30 min) don't clutter localStorage
- Backend authoritative: If backend says "done" during reload, state is properly cleared

## Notes

- This implementation follows the architectural directive from @Architect Agent
- Only affects desktop app (`subjective_chat` workspace) - web dashboard needs separate implementation
- Uses same localStorage pattern as existing frame layout persistence (`CHAT_FRAME_STORAGE`)
- No backend changes required - all state management is frontend-only
- Compatible with existing `llm-busy` event flow from main process
