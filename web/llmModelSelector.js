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
        populateProviders();
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
      <option value="codex">Codex</option>
      <option value="claude">Claude</option>
      <option value="cursor">Cursor</option>
      <option value="grok">Grok</option>
    `;
    llmModelSelect.innerHTML = '<option value="">Not available</option>';
    llmModelSelect.disabled = true;
  }

  /**
   * Populate the provider dropdown with unique providers from identities
   */
  function populateProviders() {
    if (!allIdentities || allIdentities.length === 0) {
      llmProviderSelect.innerHTML = '<option value="">No providers available</option>';
      llmModelSelect.innerHTML = '<option value="">No models available</option>';
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

    // Reset model select
    llmModelSelect.innerHTML = '<option value="">Select a brand first</option>';
    llmModelSelect.disabled = true;
  }

  /**
   * Populate the model dropdown based on selected provider
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
      populateModels(e.target.value);
    });
  }

  if (llmModelSelect) {
    llmModelSelect.addEventListener('change', (e) => {
      selectedIdentityId = e.target.value || null;
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
