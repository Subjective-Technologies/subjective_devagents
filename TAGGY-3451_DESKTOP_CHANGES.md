# TAGGY-3451 Desktop Client Changes

## Summary

Modified the desktop client to fetch language model identities from the DevAgents FastAPI backend instead of using hardcoded model lists.

## Files Changed

### Modified

**`src/main.js`** (lines 1451-1500)
- **Removed**: Hardcoded model arrays
- **Removed**: YAML catalog loading logic  
- **Added**: HTTPS fetch from DevAgents API
- **Added**: Error handling and logging
- **Added**: Support for self-signed certificates
- **Added**: 5-second timeout on API requests

## Implementation Details

### Before (Hardcoded)
```javascript
const models = {
  codex: ['codex-default'],
  claude: ['claude-sonnet-4-5', 'claude-opus', 'claude-haiku'],
  cursor: ['cursor-default'],
  grok: ['grok-beta']
};
```

### After (API Fetch)
```javascript
ipcMain.handle('llm:get-identities', async () => {
  const apiUrl = process.env.DEVAGENTS_API_URL || 'https://127.0.0.1:8080';
  const endpoint = `${apiUrl}/api/language-model/identities`;
  
  // HTTPS fetch with error handling...
  // Returns: { identities: [...] }
});
```

## Environment Variables

### Optional

**`DEVAGENTS_API_URL`** (default: `https://127.0.0.1:8080`)
- URL of the DevAgents FastAPI backend
- Used to fetch language model identities
- Example: `export DEVAGENTS_API_URL=https://devagents.example.com:8080`

## Testing

### Manual Test
```bash
cd /subjective/clients/desktop/subjective_chat
npm start
```

1. Open the application
2. Click LLM icon or menu
3. Verify model dropdown shows models from API
4. Select a model and verify it works

### Developer Tools Test
```javascript
// In Electron DevTools console:
await window.subjectiveChat.getLanguageModelIdentities()
// Expected: { identities: Array(7) }
```

## Error Handling

The implementation gracefully handles:
- Network failures → returns empty `{ identities: [] }`
- Timeout (5s) → returns empty list
- Invalid JSON → returns empty list
- HTTP errors (non-200) → returns empty list with logged error

## Logging

All operations are logged to `~/.subjective_chat/logs/*-subjective_chat-log.log`:

**Success:**
```json
{"level": "info", "message": "Loaded LLM model identities from API", "details": {"count": 7, "endpoint": "https://127.0.0.1:8080/api/language-model/identities"}}
```

**Error:**
```json
{"level": "error", "message": "Failed to fetch language model identities", "details": {"error": "...", "endpoint": "..."}}
```

## Dependencies

No new dependencies required. Uses built-in Node.js modules:
- `https` - For HTTPS requests
- `url` - For URL parsing

## Rollback

If issues occur, revert to hardcoded models:

```javascript
ipcMain.handle('llm:get-identities', async () => {
  return {
    identities: [
      {
        id: 'claude-sonnet-4-5',
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        strategy: 'cli',
        remote: false,
        capabilities: {
          text: true,
          attachments: true,
          interactive_approvals: false,
          native_resume: true
        }
      },
      {
        id: 'codex-standard',
        provider: 'codex',
        model: 'codex-standard',
        strategy: 'cli',
        remote: false,
        capabilities: {
          text: true,
          attachments: false,
          interactive_approvals: false,
          native_resume: true
        }
      }
    ]
  };
});
```

## Integration with Backend

This change requires the DevAgents FastAPI backend to be:
1. Running and accessible at the configured URL
2. Serving `/api/language-model/identities` endpoint
3. Configured with `SUBJECTIVE_LANGUAGE_MODELS_CONFIG` pointing to valid catalog

See `/subjective/services/subjective_devagents_fastapi/TAGGY-3451_IMPLEMENTATION.md` for backend setup.

## Commit Message

```
TAGGY-3451: Fetch model identities from DevAgents API

- Replace hardcoded model arrays with API fetch
- Fetch from /api/language-model/identities endpoint  
- Handle errors gracefully with empty list fallback
- Support self-signed certificates for localhost
- Add comprehensive logging
- Remove YAML catalog loading (wrong ownership boundary)

Desktop client now consumes the managed model catalog from the
FastAPI backend instead of maintaining its own hardcoded list.
```
