/*
 * Reconnect guard adapted from Block, Inc. Buzz (Apache-2.0), commit
 * 3c7f288c60d67df78577b237e27c3dfc8831aaa1:
 * desktop/src/shared/api/relayReconnectPolicy.ts
 * Copyright 2026 Block, Inc. See vendor/buzz/LICENSE and README.md.
 * Modified 2026-09-06: browser/CommonJS wrapper, native SSE transport,
 * durable-state catch-up, coalesced refresh and lifecycle cancellation.
 */
(function (root) {
  "use strict";
  function shouldScheduleReconnect(inputs) {
    if (inputs.terminal) return false;
    if (inputs.hasPendingReconnect) return false;
    if (inputs.hasLiveSocket) return false;
    if (!inputs.keepAliveRequested && !inputs.hasLiveSubscriptions) return false;
    return true;
  }

  function connect(options) {
    const EventSourceClass = options.EventSource || root.EventSource;
    const lifecycle = options.lifecycle || root;
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    const unschedule = options.clearTimeout || root.clearTimeout.bind(root);
    const onSync = options.onSync || (() => {});
    const onError = options.onError || (() => {});
    let source = null;
    let timer = null;
    let generation = 0;
    let busy = false;
    let dirty = false;
    let paused = false;
    let disposed = false;
    let terminal = false;
    const status = (value) => options.onStatus?.(value);

    // Subscribe first, then reload persistent state on EVERY open, including
    // native reconnects. Events during a reload schedule one trailing reload.
    function queueSync() {
      if (disposed || paused) return;
      dirty = true;
      if (busy || timer !== null) return;
      const token = generation;
      timer = schedule(async () => {
        timer = null;
        if (token !== generation || disposed || paused) return;
        busy = true;
        dirty = false;
        try { await onSync(); }
        catch (error) { if (token === generation) onError(error); }
        finally {
          if (token === generation) {
            busy = false;
            if (dirty) queueSync();
          }
        }
      }, options.debounceMs ?? 250);
    }

    function start() {
      if (disposed || paused || !EventSourceClass) return;
      if (!shouldScheduleReconnect({ terminal, hasPendingReconnect: false,
        // CONNECTING belongs to native EventSource's retry loop too.
        hasLiveSocket: source !== null, keepAliveRequested: true, hasLiveSubscriptions: true })) return;
      const token = ++generation;
      const current = source = new EventSourceClass(options.url || "/api/agent/events");
      const active = () => token === generation && source === current && !disposed && !paused;
      current.addEventListener("open", () => {
        if (!active()) return;
        status("connected");
        queueSync();
      });
      for (const name of ["job", "run", "approval"]) {
        current.addEventListener(name, (event) => {
          if (!active()) return;
          try { options.onEvent?.(name, event); } catch (error) { onError(error); }
          queueSync();
        });
      }
      current.addEventListener("error", () => {
        if (!active()) return;
        terminal = current.readyState === 2;
        status(terminal ? "closed" : "reconnecting");
        // Do not compete with native backoff, or resurrect a terminal stream.
        // CLOSED does not identify the cause (e.g. auth vs content type).
      });
    }

    function stop() {
      ++generation;
      if (timer !== null) unschedule(timer);
      timer = null;
      source?.close();
      source = null;
      dirty = false;
      busy = false;
    }
    function hide() { paused = true; stop(); }
    function show() { if (!disposed) { paused = false; start(); } }
    lifecycle.addEventListener?.("pagehide", hide);
    lifecycle.addEventListener?.("pageshow", show);
    start();
    return {
      refresh: queueSync,
      retry() { if (!disposed) { stop(); terminal = false; paused = false; start(); } },
      close() {
        disposed = true;
        stop();
        lifecycle.removeEventListener?.("pagehide", hide);
        lifecycle.removeEventListener?.("pageshow", show);
      },
    };
  }
  const api = { connect, shouldScheduleReconnect };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClownfishAgentEvents = api;
})(typeof window !== "undefined" ? window : globalThis);
