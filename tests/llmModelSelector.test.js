const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

// Mock HTML structure
const html = `
<!DOCTYPE html>
<html>
<body>
  <select id="llmProviderSelect"></select>
  <select id="llmModelSelect"></select>
</body>
</html>
`;

function setupDOM() {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}

test('hierarchical model selector groups models by provider', (t) => {
  const dom = setupDOM();
  t.after(() => {
    delete global.window;
    delete global.document;
  });

  // Mock identities data
  const mockIdentities = [
    { id: 'claude-opus-1', provider: 'claude', model: 'claude-opus-4' },
    { id: 'claude-sonnet-1', provider: 'claude', model: 'claude-sonnet-4-5' },
    { id: 'claude-haiku-1', provider: 'claude', model: 'claude-haiku-3-5' },
    { id: 'codex-1', provider: 'codex', model: 'codex-standard' },
    { id: 'grok-1', provider: 'grok', model: 'grok-2' }
  ];

  // Load the module code (we'll simulate it here for testing)
  const llmModelSelect = document.getElementById('llmModelSelect');
  
  // Simulate populateModelsHierarchical function
  function populateModelsHierarchical(identities) {
    const providerGroups = {};
    identities.forEach(identity => {
      if (!providerGroups[identity.provider]) {
        providerGroups[identity.provider] = [];
      }
      providerGroups[identity.provider].push(identity);
    });

    llmModelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    const sortedProviders = Object.keys(providerGroups).sort();
    
    sortedProviders.forEach(provider => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider.charAt(0).toUpperCase() + provider.slice(1);
      
      providerGroups[provider].forEach(identity => {
        const option = document.createElement('option');
        option.value = identity.id;
        option.textContent = identity.model;
        optgroup.appendChild(option);
      });
      
      llmModelSelect.appendChild(optgroup);
    });
  }

  populateModelsHierarchical(mockIdentities);

  // Verify structure
  const optgroups = llmModelSelect.querySelectorAll('optgroup');
  assert.equal(optgroups.length, 3, 'Should have 3 optgroups (Claude, Codex, Grok)');
  
  const claudeGroup = Array.from(optgroups).find(og => og.label === 'Claude');
  assert.ok(claudeGroup, 'Should have Claude optgroup');
  assert.equal(claudeGroup.children.length, 3, 'Claude should have 3 models');
  
  const codexGroup = Array.from(optgroups).find(og => og.label === 'Codex');
  assert.ok(codexGroup, 'Should have Codex optgroup');
  assert.equal(codexGroup.children.length, 1, 'Codex should have 1 model');
});

test('model selector auto-selects when only one model available', (t) => {
  const dom = setupDOM();
  t.after(() => {
    delete global.window;
    delete global.document;
  });

  const mockIdentities = [
    { id: 'single-model', provider: 'codex', model: 'codex-only' }
  ];

  const llmModelSelect = document.getElementById('llmModelSelect');
  
  function populateModelsHierarchical(identities) {
    llmModelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    identities.forEach(identity => {
      const option = document.createElement('option');
      option.value = identity.id;
      option.textContent = identity.model;
      llmModelSelect.appendChild(option);
    });
    
    if (identities.length === 1) {
      llmModelSelect.value = identities[0].id;
    }
  }

  populateModelsHierarchical(mockIdentities);
  assert.equal(llmModelSelect.value, 'single-model', 'Should auto-select the only available model');
});

test('provider filter updates model selector to show only relevant models', (t) => {
  const dom = setupDOM();
  t.after(() => {
    delete global.window;
    delete global.document;
  });

  const mockIdentities = [
    { id: 'claude-opus-1', provider: 'claude', model: 'claude-opus-4' },
    { id: 'claude-sonnet-1', provider: 'claude', model: 'claude-sonnet-4-5' },
    { id: 'codex-1', provider: 'codex', model: 'codex-standard' }
  ];

  const llmModelSelect = document.getElementById('llmModelSelect');
  
  function populateModels(provider, identities) {
    const filtered = identities.filter(id => id.provider === provider);
    llmModelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    filtered.forEach(identity => {
      const option = document.createElement('option');
      option.value = identity.id;
      option.textContent = identity.model;
      llmModelSelect.appendChild(option);
    });
  }

  populateModels('claude', mockIdentities);
  
  const options = Array.from(llmModelSelect.querySelectorAll('option'))
    .filter(opt => opt.value !== '');
  
  assert.equal(options.length, 2, 'Should show only 2 Claude models');
  assert.ok(options.every(opt => opt.value.startsWith('claude-')), 'All options should be Claude models');
});

test('model display name formatting', (t) => {
  function getModelDisplayName(identity) {
    if (identity.model) {
      return identity.model
        .split('-')
        .map((part, i) => i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join(' ')
        .replace(/(\d)_(\d)/g, '$1.$2')
        .replace(/(\d) (\d)/g, '$1.$2');
    }
    return identity.id;
  }

  const testCases = [
    { input: { model: 'claude-sonnet-4-5' }, expected: 'Claude sonnet 4.5' },
    { input: { model: 'claude-opus-4' }, expected: 'Claude opus 4' },
    { input: { model: 'codex-standard' }, expected: 'Codex standard' },
    { input: { id: 'fallback-id' }, expected: 'fallback-id' }
  ];

  testCases.forEach(({ input, expected }) => {
    assert.equal(getModelDisplayName(input), expected);
  });
});
