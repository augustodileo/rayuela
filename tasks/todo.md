# Rayuela — Current State

## Architecture

```
Tree-sitter   → FIND framework entry points (decorators, routes, screens)
Stack Graphs  → RESOLVE cross-file imports and name bindings
LSP (Pyright) → FOLLOW call hierarchy through installed packages
petgraph      → QUERY reachability and path finding in the app graph
TraceStore    → IDENTIFY code paths via structural hashing (SHA-256)
Auto-deps     → INSTALL project dependencies for LSP resolution
```

## Test Summary

- Rust: 30 tests (parser:8, graph:7, validator:6, resolver:3, trace:6)
- TypeScript: 30 tests (fastapi:10, expo-router:11, cli:6, lsp:3)
- Total: 60 tests

## sLEGACY Ground Truth

- Endpoints: 15/15 (100%)
- Guards: 15/15 correct
- Screens: 8 unique (RollDetailScreen, SessionDetailScreen — no duplicates)
- API edges: 3 linked (tree-sitter fallback), more with LSP
- Traces: 16 unique, 15 roots
- Spec tests: 8/8 pass

## Remaining Work

- [ ] Trace-based spec validation (`trace_contains` test type)
- [ ] Deep traces via LSP (service → repo → external call chains)
- [ ] Expo Router screen traces (screen → hook → api → endpoint)
- [ ] Express analyzer (Node.js backend framework)
- [ ] `rayuela init` command (auto-generate starter spec)
- [ ] JUnit output format for CI dashboards
- [ ] npm publishing with pre-built binaries
