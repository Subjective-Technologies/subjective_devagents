# Clear Button Fix - Clear Messages Instead of Closing Pane

## Issue
When clicking the "Clear" (×) button in a chat frame, it was closing/removing the conversation from the pane but keeping all previous messages intact. When the conversation was opened again, all the old messages were still there.

## Expected Behavior
When clicking "Clear conversations", the messages should be emptied while the conversation remains open in the pane.

## Changes Made

### 1. Added `clearConversationMessages()` function (src/renderer.js ~line 2185)
```javascript
function clearConversationMessages(target) {
  const conversation = conversations.get(target);
  if (!conversation) return;
  // Clear all messages/events from the conversation
  conversation.events = [];
  conversation.unread = 0;
  conversation.updatedAt = Date.now();
  // Re-render all visible transcripts showing this conversation
  if (framesEnabled()) {
    renderVisibleFrameTranscripts();
  } else if (activeTarget === target) {
    renderTranscript();
  }
  renderConversations();
  rendererLog('info', 'Cleared conversation messages', { target, label: conversation.label });
}
```

### 2. Modified Clear Button Click Handler (src/renderer.js ~line 378)
**Before:**
```javascript
frame.querySelector('.frame-clear').addEventListener('click', (event) => {
  event.stopPropagation();
  assignChatFrame(index, '');
});
```

**After:**
```javascript
frame.querySelector('.frame-clear').addEventListener('click', (event) => {
  event.stopPropagation();
  const target = frameTargets[index];
  if (target) {
    clearConversationMessages(target);
  }
});
```

### 3. Updated Button Label (src/renderer.js ~line 363)
**Before:**
```html
<button type="button" class="frame-clear" hidden title="Clear pane" aria-label="Clear pane">×</button>
```

**After:**
```html
<button type="button" class="frame-clear" hidden title="Clear messages" aria-label="Clear messages">×</button>
```

## How It Works
1. User clicks the × button on a chat frame
2. The button gets the target (conversation ID) of that frame
3. `clearConversationMessages()` is called which:
   - Finds the conversation in the `conversations` Map
   - Clears the `events` array (all messages)
   - Resets `unread` count to 0
   - Updates `updatedAt` timestamp
   - Re-renders all visible transcripts to show the empty conversation
   - Logs the action for debugging
4. The conversation remains open in the pane, but is now empty

## Files Modified
- `src/renderer.js` - Main renderer logic for both desktop and web versions

## Testing
The web version uses the same `renderer.js` file (loaded via bootstrap.js), so this fix applies to both:
- Desktop Electron app
- Web version at devagents-api.subjectivetechnologies.com

To test:
1. Open a conversation with messages
2. Click the × (Clear messages) button
3. Verify all messages are cleared
4. Verify the conversation remains open in the pane
5. Verify you can still send new messages
