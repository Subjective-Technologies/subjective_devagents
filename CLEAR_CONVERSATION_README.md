> Update 2026-10-05: the analysis below describes the earlier frontend-only fix and
> the retired Node backend. The active backend is `services/subjective_devagents_fastapi`.
> The implemented fix and exact storage/version-verification paths are documented in
> that service's README under "Clear messages and deployment verification". Local
> history clearing is now covered by backend, frontend, and Selenium tests; deployment
> status must be checked with `scripts/verify_deployment.py`, not inferred from this file.

# Clear Conversation Issue - Complete Documentation

## Quick Summary

**Problem:** The × (clear) button in chat frames clears messages from the UI but they come back when you reopen the conversation.

**Root Cause:** The button only clears frontend memory, not the disk files where LLM conversations are actually stored.

**Status:** Documented, not yet fixed. Awaiting decision on solution approach.

---

## Documentation Files

1. **CLEAR_CONVERSATION_FLOW.txt** ⭐ **START HERE**
   - Visual ASCII diagram showing exactly what happens
   - Step-by-step breakdown of current vs expected behavior
   - Shows the gap between frontend clearing and backend persistence
   - Best for understanding the bug quickly

2. **CLEAR_CONVERSATION_ISSUE_SUMMARY.md**
   - Executive summary with all solution options
   - Pros/cons of each approach
   - Recommendation: Option C (Hybrid)
   - Decision framework for choosing solution

3. **CLEAR_CHAT_ANALYSIS.md**
   - Deep technical analysis
   - Architecture discovery (where conversations are stored)
   - Database table references
   - Complete implementation plan for each option

4. **ISSUES_PROMPT.txt**
   - Added to HIGH priority section
   - Part of comprehensive platform issues list
   - Includes this issue under "💬 USER INTERFACE ISSUES"

---

## The Bug in One Sentence

**clearConversationMessages() only clears the in-memory JavaScript Map, but LLM conversations reload from ~/.cursor/ SQLite databases when reopened, restoring all messages.**

---

## Quick Reference: What Needs to Happen

### Current Code (Broken)
```javascript
function clearConversationMessages(target) {
  conversation.events = [];  // ⚠️ Only clears memory
  renderVisibleFrameTranscripts();
  // NO backend call!
}
```

### Fixed Code (Option A - Backend API)
```javascript
async function clearConversationMessages(target) {
  const result = await bridge.clearLlmConversation(target);  // ✅ Backend call
  if (result.ok) {
    conversation.events = [];
    renderVisibleFrameTranscripts();
  } else {
    showError(result.error);  // Handle read-only conversations
  }
}
```

---

## Solution Options (Quick Reference)

| Option | Description | Pros | Cons | Implementation |
|--------|-------------|------|------|----------------|
| **A** | Add backend API to delete files | Permanent deletion | Irreversible | Medium effort |
| **B** | Improve UX messaging only | Non-destructive | Misleading | Easy |
| **C** | Hybrid (delete local, error on provider) | Best UX | Complex | High effort |
| **D** | Use existing delete API | Already exists | Too drastic | Easy |

**Recommendation:** Option C (Hybrid)

---

## Implementation Checklist (If choosing Option A or C)

Backend:
- [ ] Add `clearConversationMessages(target)` to `src/llmService.js`
- [ ] Add `POST /api/llm/clear-conversation` route to `src/webServer.js`
- [ ] Add Electron IPC handler to `src/main.js`
- [ ] Handle writable vs read-only conversations
- [ ] Broadcast `llm-conversation-cleared` event

Frontend:
- [ ] Add `clearLlmConversation(target)` to `web/webBridge.js`
- [ ] Update `clearConversationMessages()` in `src/renderer.js`
- [ ] Add error handling for read-only conversations
- [ ] Show confirmation dialog for destructive operation
- [ ] Update button labels based on conversation type
- [ ] Add visual feedback (toast/notification)

Testing:
- [ ] Test with local LLM conversation (should delete)
- [ ] Test with Cursor history (should show error)
- [ ] Test with Claude history (should show error)
- [ ] Test with IRC conversation (should work as-is)
- [ ] Test reopening after clear (should stay empty)

---

## Files Modified by Previous (Incorrect) Fix

The commit `0ae6b09` added `clearConversationMessages()` function but it only clears the frontend:

- `src/renderer.js:2185` - Added function (clears memory only)
- `CLEAR_BUTTON_FIX.md` - Documentation (incomplete understanding)

**This fix made the UI clear correctly but didn't solve persistence.**

---

## Storage Locations Reference

```
LLM Conversations (PERSISTENT):
~/.subjective_chat_history/          → History pipeline output
~/.cursor/                            → Cursor app data
~/.cursor/workspaceStorage/*/state.vscdb  → SQLite databases
~/.claude/                            → Claude conversation files
~/.codex/                             → Codex conversation files

IRC Conversations (EPHEMERAL):
In-memory only: conversations Map in renderer.js
```

**Clear button only touches the in-memory Map, never the disk files.**

---

## How to Reproduce

1. Open a Cursor/Claude/Codex conversation in a chat frame
2. Send a few messages (they persist to disk automatically)
3. Click the × (clear) button
4. Messages disappear from UI ✅
5. Drag & drop the same conversation back to any frame
6. **BUG:** All messages are back! ❌

---

## Next Steps

1. **Decide** which solution option to implement (A, B, C, or D)
2. **Assign** to appropriate agent (coder_agent) with decision
3. **Implement** backend API + frontend changes
4. **Test** with all conversation types
5. **Deploy** and verify in production

---

## Questions?

See detailed analysis in:
- `CLEAR_CHAT_ANALYSIS.md` for technical deep-dive
- `CLEAR_CONVERSATION_FLOW.txt` for visual explanation
- `CLEAR_CONVERSATION_ISSUE_SUMMARY.md` for decision framework

---

**Created:** 2026-10-05  
**Status:** Documented, awaiting decision  
**Priority:** HIGH (UX broken)  
**Affects:** LLM conversations (Cursor/Claude/Codex)  
**Workaround:** Use "Delete conversation" instead of "Clear"
