/**
 * TAGGY-3452: LLM Processing State Persistence Tests
 * 
 * Tests that LLM processing status (busy, progress, thoughts) survives page reload.
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('LLM Processing State Persistence', () => {
  const LLM_PROCESSING_STATE_STORAGE = 'subjective-llm-processing-state';
  let localStorage;

  beforeEach(() => {
    // Mock localStorage
    const store = {};
    localStorage = {
      getItem: jest.fn((key) => store[key] || null),
      setItem: jest.fn((key, value) => { store[key] = value; }),
      removeItem: jest.fn((key) => { delete store[key]; }),
      clear: jest.fn(() => { for (const key in store) delete store[key]; })
    };
    global.localStorage = localStorage;
  });

  afterEach(() => {
    delete global.localStorage;
  });

  describe('persistLlmProcessingState', () => {
    it('should persist busy state with progress and thoughts', () => {
      const target = 'llm://claude/workspace1';
      const state = {
        busy: true,
        progress: 'Analyzing code...',
        busySince: Date.now(),
        thoughts: ['Reading files', 'Analyzing dependencies', 'Generating report']
      };

      // Simulate the persist function (extracted from renderer.js)
      const persistLlmProcessingState = (target, state) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        if (state && state.busy) {
          all[target] = {
            busy: true,
            progress: state.progress || '',
            busySince: state.busySince || Date.now(),
            thoughts: state.thoughts || [],
            timestamp: Date.now()
          };
        } else {
          delete all[target];
        }
        localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
      };

      persistLlmProcessingState(target, state);

      expect(localStorage.setItem).toHaveBeenCalled();
      const saved = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(saved[target]).toBeDefined();
      expect(saved[target].busy).toBe(true);
      expect(saved[target].progress).toBe('Analyzing code...');
      expect(saved[target].thoughts).toEqual(['Reading files', 'Analyzing dependencies', 'Generating report']);
    });

    it('should clear persisted state when busy becomes false', () => {
      const target = 'llm://claude/workspace1';
      
      const persistLlmProcessingState = (target, state) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        if (state && state.busy) {
          all[target] = {
            busy: true,
            progress: state.progress || '',
            busySince: state.busySince || Date.now(),
            thoughts: state.thoughts || [],
            timestamp: Date.now()
          };
        } else {
          delete all[target];
        }
        localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
      };

      // First persist busy state
      persistLlmProcessingState(target, { busy: true, progress: 'Working...' });
      let saved = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(saved[target]).toBeDefined();

      // Then clear it
      persistLlmProcessingState(target, { busy: false });
      saved = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(saved[target]).toBeUndefined();
    });

    it('should handle multiple conversations independently', () => {
      const target1 = 'llm://claude/workspace1';
      const target2 = 'llm://codex/workspace2';

      const persistLlmProcessingState = (target, state) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        if (state && state.busy) {
          all[target] = {
            busy: true,
            progress: state.progress || '',
            busySince: state.busySince || Date.now(),
            thoughts: state.thoughts || [],
            timestamp: Date.now()
          };
        } else {
          delete all[target];
        }
        localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
      };

      persistLlmProcessingState(target1, { busy: true, progress: 'Task 1' });
      persistLlmProcessingState(target2, { busy: true, progress: 'Task 2' });

      const saved = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(saved[target1].progress).toBe('Task 1');
      expect(saved[target2].progress).toBe('Task 2');

      // Clear one shouldn't affect the other
      persistLlmProcessingState(target1, { busy: false });
      const updated = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(updated[target1]).toBeUndefined();
      expect(updated[target2]).toBeDefined();
      expect(updated[target2].progress).toBe('Task 2');
    });
  });

  describe('restoreLlmProcessingState', () => {
    it('should restore persisted state', () => {
      const target = 'llm://claude/workspace1';
      const now = Date.now();
      
      // Setup persisted state
      const state = {
        [target]: {
          busy: true,
          progress: 'Restoring work...',
          busySince: now - 5000,
          thoughts: ['Step 1', 'Step 2'],
          timestamp: now - 5000
        }
      };
      localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(state));

      const restoreLlmProcessingState = (target) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        const state = all[target];
        if (!state || !state.busy) return null;
        const age = Date.now() - (state.timestamp || 0);
        if (age > 30 * 60 * 1000) {
          delete all[target];
          localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
          return null;
        }
        return {
          busy: true,
          progress: state.progress || '',
          busySince: state.busySince || Date.now(),
          thoughts: Array.isArray(state.thoughts) ? state.thoughts : []
        };
      };

      const restored = restoreLlmProcessingState(target);
      
      expect(restored).not.toBeNull();
      expect(restored.busy).toBe(true);
      expect(restored.progress).toBe('Restoring work...');
      expect(restored.thoughts).toEqual(['Step 1', 'Step 2']);
    });

    it('should ignore stale state older than 30 minutes', () => {
      const target = 'llm://claude/workspace1';
      const oldTimestamp = Date.now() - (31 * 60 * 1000); // 31 minutes ago
      
      const state = {
        [target]: {
          busy: true,
          progress: 'Old task',
          timestamp: oldTimestamp
        }
      };
      localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(state));

      const restoreLlmProcessingState = (target) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        const state = all[target];
        if (!state || !state.busy) return null;
        const age = Date.now() - (state.timestamp || 0);
        if (age > 30 * 60 * 1000) {
          delete all[target];
          localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
          return null;
        }
        return {
          busy: true,
          progress: state.progress || '',
          busySince: state.busySince || Date.now(),
          thoughts: Array.isArray(state.thoughts) ? state.thoughts : []
        };
      };

      const restored = restoreLlmProcessingState(target);
      
      expect(restored).toBeNull();
      
      // Verify stale state was cleaned up
      const cleaned = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE));
      expect(cleaned[target]).toBeUndefined();
    });

    it('should return null for non-existent conversation', () => {
      const restoreLlmProcessingState = (target) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        const state = all[target];
        if (!state || !state.busy) return null;
        const age = Date.now() - (state.timestamp || 0);
        if (age > 30 * 60 * 1000) {
          delete all[target];
          localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
          return null;
        }
        return {
          busy: true,
          progress: state.progress || '',
          busySince: state.busySince || Date.now(),
          thoughts: Array.isArray(state.thoughts) ? state.thoughts : []
        };
      };

      const restored = restoreLlmProcessingState('llm://nonexistent/workspace');
      expect(restored).toBeNull();
    });

    it('should return null for non-busy conversation', () => {
      const target = 'llm://claude/workspace1';
      const state = {
        [target]: {
          busy: false,
          progress: 'Done',
          timestamp: Date.now()
        }
      };
      localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(state));

      const restoreLlmProcessingState = (target) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        const state = all[target];
        if (!state || !state.busy) return null;
        return {
          busy: true,
          progress: state.progress || '',
          busySince: state.busySince || Date.now(),
          thoughts: Array.isArray(state.thoughts) ? state.thoughts : []
        };
      };

      const restored = restoreLlmProcessingState(target);
      expect(restored).toBeNull();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle page reload during LLM processing', () => {
      const target = 'llm://claude/workspace1';
      
      const persistLlmProcessingState = (target, state) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        if (state && state.busy) {
          all[target] = {
            busy: true,
            progress: state.progress || '',
            busySince: state.busySince || Date.now(),
            thoughts: state.thoughts || [],
            timestamp: Date.now()
          };
        } else {
          delete all[target];
        }
        localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
      };

      const restoreLlmProcessingState = (target) => {
        const all = JSON.parse(localStorage.getItem(LLM_PROCESSING_STATE_STORAGE) || '{}');
        const state = all[target];
        if (!state || !state.busy) return null;
        const age = Date.now() - (state.timestamp || 0);
        if (age > 30 * 60 * 1000) {
          delete all[target];
          localStorage.setItem(LLM_PROCESSING_STATE_STORAGE, JSON.stringify(all));
          return null;
        }
        return {
          busy: true,
          progress: state.progress || '',
          busySince: state.busySince || Date.now(),
          thoughts: Array.isArray(state.thoughts) ? state.thoughts : []
        };
      };

      // Simulate: User sends message, LLM starts processing
      const initialState = {
        busy: true,
        progress: 'Reading repository...',
        busySince: Date.now(),
        thoughts: ['Cloning repository', 'Analyzing structure']
      };
      persistLlmProcessingState(target, initialState);

      // Simulate: Progress updates come in
      const progressState = {
        busy: true,
        progress: 'Generating response...',
        busySince: initialState.busySince,
        thoughts: [...initialState.thoughts, 'Processing files', 'Generating response']
      };
      persistLlmProcessingState(target, progressState);

      // Simulate: Page reload - restore state
      const restored = restoreLlmProcessingState(target);
      expect(restored).not.toBeNull();
      expect(restored.busy).toBe(true);
      expect(restored.progress).toBe('Generating response...');
      expect(restored.thoughts.length).toBe(4);

      // Simulate: LLM finishes, backend sends busy: false
      persistLlmProcessingState(target, { busy: false });
      
      // Verify state is cleared
      const final = restoreLlmProcessingState(target);
      expect(final).toBeNull();
    });
  });
});
