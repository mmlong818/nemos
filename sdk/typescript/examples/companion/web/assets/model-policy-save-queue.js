"use strict";
(function installModelPolicySaveQueue(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClownfishPolicySaveQueue = api;
})(typeof window === "undefined" ? globalThis : window, () => {
  function createLatestPolicyQueue({ execute, onQueued, onCommitted, onSettled }) {
    const pending = new Map();
    const generations = new Map();
    let running = false;
    let idlePromise = Promise.resolve();
    let resolveIdle = null;

    async function drain() {
      const outcomes = new Map();
      try {
        while (pending.size) {
          const [key, operation] = pending.entries().next().value;
          pending.delete(key);
          try {
            const value = await execute(operation);
            onCommitted?.(value, operation);
            if (generations.get(key) === operation.generation) {
              outcomes.set(key, { ok: true, operation, value });
            }
          } catch (error) {
            if (generations.get(key) === operation.generation) {
              outcomes.set(key, { ok: false, operation, error });
            }
          }
        }
      } finally {
        running = false;
        onSettled?.(outcomes);
        resolveIdle?.();
        resolveIdle = null;
      }
    }

    function enqueue(operation) {
      const generation = (generations.get(operation.key) || 0) + 1;
      generations.set(operation.key, generation);
      const queued = { ...operation, generation };
      pending.set(operation.key, queued);
      onQueued?.(queued);
      if (!running) {
        running = true;
        idlePromise = new Promise((resolve) => { resolveIdle = resolve; });
        void drain();
      }
      return generation;
    }

    return {
      enqueue,
      isRunning: () => running,
      waitForIdle: () => idlePromise,
    };
  }

  return { createLatestPolicyQueue };
});
