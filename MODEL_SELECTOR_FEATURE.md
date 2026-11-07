# LLM Model Selection Feature - TAGGY-3451

## Overview
This feature enhances the LLM model selection interface to provide a hierarchical view where models are grouped by their providers (Claude, Codex, Cursor, Grok, etc.) as submenu items in a single dropdown.

## Implementation Details

### Changes Made

#### 1. Hierarchical Model Selector (`src/llmModelSelector.js` and `web/llmModelSelector.js`)

**New Function: `populateModelsHierarchical()`**
- Groups all available model identities by their provider
- Creates HTML `<optgroup>` elements for each provider
- Populates each optgroup with the provider's available models
- Auto-selects if only one model is available across all providers

**Key Features:**
- **Provider Grouping**: Models are organized under provider headings (e.g., Claude, Codex, Grok)
- **Model Display Names**: Properly formatted model names (e.g., "claude-sonnet-4-5" → "Claude sonnet 4.5")
- **Backward Compatibility**: Maintains support for the existing two-dropdown approach
- **Auto-selection**: If only one model is available system-wide, it's automatically selected

#### 2. Enhanced Event Handling

**Provider Dropdown Integration:**
- When a provider is selected, the model dropdown filters to show only that provider's models
- When cleared, the model dropdown resets to show all models hierarchically
- When a model is selected from the hierarchical view, the provider dropdown auto-updates

#### 3. Diagnostic Logging

Added console logging for:
- Number of identities loaded
- Provider groups created
- Models added for each provider
- Auto-selection events

### User Interface

The model selector now displays:

```
Select a model...
  Claude
    ├─ Claude opus 4
    ├─ Claude sonnet 4.5
    └─ Claude haiku 3.5
  Codex
    └─ Codex standard
  Grok
    └─ Grok 2
```

### API Integration

The feature relies on the `/api/language-model/identities` endpoint which returns:

```json
{
  "identities": [
    {
      "id": "claude-opus-1",
      "provider": "claude",
      "model": "claude-opus-4",
      "strategy": "cli",
      "remote": false,
      "capabilities": {
        "text": true,
        "attachments": true,
        "interactive_approvals": false,
        "native_resume": true
      }
    }
  ]
}
```

## Files Changed

1. **`src/llmModelSelector.js`** - Desktop/Electron version
   - Added `populateModelsHierarchical()` function
   - Enhanced event listeners for synchronized selection
   - Added diagnostic logging

2. **`web/llmModelSelector.js`** - Web version
   - Added `populateModelsHierarchical()` function
   - Enhanced event listeners for synchronized selection
   - Added diagnostic logging

3. **`tests/llmModelSelector.test.js`** - New test suite
   - Tests for hierarchical grouping
   - Tests for auto-selection
   - Tests for provider filtering
   - Tests for model name formatting

## Testing

### Manual Testing
1. Open the "New agent conversation" dialog
2. Verify the "Language Model" dropdown shows models grouped by provider
3. Select a model from any provider group
4. Verify the "Agent Brand" dropdown auto-updates to match the selected model's provider
5. Change the "Agent Brand" dropdown and verify the model dropdown filters accordingly

### Automated Testing
Run the test suite:
```bash
cd /subjective/clients/desktop/subjective_chat
npm test tests/llmModelSelector.test.js
```

## Backward Compatibility

The implementation maintains full backward compatibility:
- Legacy provider-only mode still works if the API is unavailable
- Two-dropdown workflow is preserved for users who prefer it
- Existing conversations and configurations are unaffected

## Benefits

1. **Improved UX**: Users can see all available models in one view without needing to know which provider offers which model
2. **Faster Selection**: Single-step selection process for choosing a model
3. **Better Organization**: Clear visual grouping makes it easy to compare models across providers
4. **Discoverability**: Users can explore all available models without trial-and-error

## Future Enhancements

Potential improvements for future iterations:
- Model metadata display (e.g., capabilities, token limits)
- Search/filter functionality within the model selector
- Recently used models section
- Model recommendations based on workspace or task type
- Visual indicators for model capabilities (e.g., image support, code execution)
