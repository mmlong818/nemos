# Buzz: selected mechanisms, not an embedded service

Upstream: https://github.com/block/buzz

Pinned commit: `3c7f288c60d67df78577b237e27c3dfc8831aaa1` (verified 2026-09-06).

Copyright 2026 Block, Inc. Upstream code remains under Apache-2.0; see LICENSE.
No root-level upstream NOTICE was present at this commit. Other components'
notices do not apply because those components were not copied.

## Local modifications / provenance

- `../../web/assets/agent-events.js`: the five-guard reconnect policy is adapted
  from `desktop/src/shared/api/relayReconnectPolicy.ts`. Converted to browser /
  CommonJS JavaScript and integrated with native EventSource, snapshot catch-up,
  event coalescing, lifecycle cleanup, explicit terminal retry and generation checks.
  This is not Buzz's WebSocket transport or its full reconnect controller.
- `../../relationship-memory.ts`: independently implemented local JSON persistence
  safeguards inspired by `crates/buzz-acp/src/engram_fetch.rs`'s confirmed-absence /
  read-failure distinction. No Rust memory code or encryption implementation copied.
- `../../product-platform.ts`: independently implemented stable attention grouping
  inspired by `desktop/src/features/home/lib/inbox.ts`. No React/Nostr dependencies.

No Buzz agent engines, relay, Rust runtime, database stack, memory graph UI or
workflow executor are included. See the repository validation report for tested
scope and limitations. The containing directory and LICENSE are carried by the
existing portable build's companion-directory copy rule.
