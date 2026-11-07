/**
 * LLM Model Selector
 * Fetches available language models from the API and populates hierarchical dropdowns
 */

(function() {
  'use strict';

  // Store all identities fetched from the API
  let allIdentities = [];
  let selectedIdentityId = null;

  const llmProviderSelect = document.getElementById('llmProviderSelect');
  const llmModelSelect = document.getElementById('llmModelSelect');

  /**
   * Fetch available language model identities from the API
   */
  async function fetchIdentities() {
    try {
      const response = await window.subjectiveChat.bridge.get('/api/language-model/identities');
      if (response && response.identities) {
        allIdentities = response.identities;
        populateModelsHierarchical();
      } else {
        // Fallback to legacy provider-only mode if API is not available
        useLegacyProviderMode();
      }
    } catch (error) {
      console.warn('Could not fetch language model identities, using legacy mode:', error);
      useLegacyProviderMode();
    }
  }

  /**
   * Fallback to simple provider selection if the new API is unavailable
   */
  function useLegacyProviderMode() {
    llmProviderSelect.innerHTML = `
      <option value="">Select provider...</option>
      <option value="codex">Codex</option>
      <option value="claude">Claude</option>
      <option value="cursor">Cursor</option>
      <option value="grok">Grok</option>
    `;
    llmModelSelect.innerHTML = '<option value="">Not available</option>';
    llmModelSelect.disabled = true;
  }

  /**
   * Populate hierarchical model selector with providers as optgroups
   */
  function populateModelsHierarchical() {
    console.log('[llmModelSelector] Populating hierarchical model selector with', allIdentities.length, 'identities');
    
    if (!allIdentities || allIdentities.length === 0) {
      llmModelSelect.innerHTML = '<option value="">No models available</option>';
      llmModelSelect.disabled = false;
      return;
    }

    // Group identities by provider
    const providerGroups = {};
    allIdentities.forEach(identity => {
      if (!providerGroups[identity.provider]) {
        providerGroups[identity.provider] = [];
      }
      providerGroups[identity.provider].push(identity);
    });

    console.log('[llmModelSelector] Provider groups:', Object.keys(providerGroups).join(', '));

    // Clear and populate the hierarchical model selector
    llmModelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    // Sort providers alphabetically
    const sortedProviders = Object.keys(providerGroups).sort();
    
    sortedProviders.forEach(provider => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = capitalize(provider);
      
      const models = [];
      providerGroups[provider].forEach(identity => {
        const option = document.createElement('option');
        option.value = identity.id;
        option.textContent = getModelDisplayName(identity);
        optgroup.appendChild(option);
        models.push(identity.model || identity.id);
      });
      
      console.log(`[llmModelSelector] Added ${provider} with models:`, models.join(', '));
      llmModelSelect.appendChild(optgroup);
    });

    llmModelSelect.disabled = false;
    
    // Auto-select if only one model available across all providers
    if (allIdentities.length === 1) {
      llmModelSelect.value = allIdentities[0].id;
      selectedIdentityId = allIdentities[0].id;
      console.log('[llmModelSelector] Auto-selected single model:', allIdentities[0].id);
    } else {
      selectedIdentityId = null;
    }
  }

  /**
   * Populate the provider dropdown with unique providers from identities (for backward compatibility)
   */
  function populateProviders() {
    if (!allIdentities || allIdentities.length === 0) {
      llmProviderSelect.innerHTML = '<option value="">No providers available</option>';
      return;
    }

    // Get unique providers
    const providers = [...new Set(allIdentities.map(id => id.provider))].sort();
    
    llmProviderSelect.innerHTML = '<option value="">Select a brand...</option>';
    providers.forEach(provider => {
      const option = document.createElement('option');
      option.value = provider;
      option.textContent = capitalize(provider);
      llmProviderSelect.appendChild(option);
    });
  }

  /**
   * Populate the model dropdown based on selected provider (for backward compatibility)
   */
  function populateModels(provider) {
    if (!provider) {
      llmModelSelect.innerHTML = '<option value="">Select a brand first</option>';
      llmModelSelect.disabled = true;
      selectedIdentityId = null;
      return;
    }

    const identitiesForProvider = allIdentities.filter(id => id.provider === provider);
    
    if (identitiesForProvider.length === 0) {
      llmModelSelect.innerHTML = '<option value="">No models available</option>';
      llmModelSelect.disabled = true;
      selectedIdentityId = null;
      return;
    }

    llmModelSelect.innerHTML = '<option value="">Select a model...</option>';
    identitiesForProvider.forEach(identity => {
      const option = document.createElement('option');
      option.value = identity.id;
      option.textContent = getModelDisplayName(identity);
      llmModelSelect.appendChild(option);
    });

    llmModelSelect.disabled = false;
    
    // Auto-select if only one model available
    if (identitiesForProvider.length === 1) {
      llmModelSelect.value = identitiesForProvider[0].id;
      selectedIdentityId = identitiesForProvider[0].id;
    } else {
      selectedIdentityId = null;
    }
  }

  /**
   * Get a human-readable display name for a model
   */
  function getModelDisplayName(identity) {
    if (identity.model) {
      // Format model names nicely (e.g., "claude-sonnet-4-5" -> "Claude Sonnet 4.5")
      return identity.model
        .split('-')
        .map((part, i) => i === 0 ? capitalize(part) : part)
        .join(' ')
        .replace(/(\d)_(\d)/g, '$1.$2')
        .replace(/(\d) (\d)/g, '$1.$2');
    }
    return identity.id;
  }

  /**
   * Capitalize first letter of a string
   */
  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Get the currently selected identity ID
   */
  function getSelectedIdentityId() {
    return selectedIdentityId;
  }

  /**
   * Get the currently selected provider
   */
  function getSelectedProvider() {
    return llmProviderSelect ? llmProviderSelect.value : '';
  }

  /**
   * Get identity details by ID
   */
  function getIdentityById(id) {
    return allIdentities.find(identity => identity.id === id);
  }

  // Event listeners
  if (llmProviderSelect) {
    llmProviderSelect.addEventListener('change', (e) => {
      // Filter model selector based on provider selection
      const provider = e.target.value;
      if (provider) {
        populateModels(provider);
      } else {
        // Reset to show all models hierarchically
        populateModelsHierarchical();
      }
    });
  }

  if (llmModelSelect) {
    llmModelSelect.addEventListener('change', (e) => {
      selectedIdentityId = e.target.value || null;
      // Auto-update provider selector if model is selected from hierarchical view
      if (selectedIdentityId && llmProviderSelect) {
        const identity = allIdentities.find(id => id.id === selectedIdentityId);
        if (identity && llmProviderSelect.value !== identity.provider) {
          llmProviderSelect.value = identity.provider;
        }
      }
    });
  }

  // Initialize when the LLM dialog is opened
  document.addEventListener('DOMContentLoaded', () => {
    const createLlmButton = document.getElementById('createLlmButton');
    if (createLlmButton) {
      createLlmButton.addEventListener('click', () => {
        // Fetch identities when dialog opens (if not already fetched)
        if (allIdentities.length === 0) {
          fetchIdentities();
        }
      });
    }
  });

  // Expose API for renderer.js to use
  window.llmModelSelector = {
    getSelectedIdentityId,
    getSelectedProvider,
    getIdentityById,
    fetchIdentities
  };
})();
