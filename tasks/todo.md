# Rayuela MVP — Task Tracker

## Completed

- [x] Task 1: Project Scaffolding — Rust workspace + pnpm workspace + SDK types
- [x] Task 2: Test Fixtures — FastAPI app + Expo Router app
- [x] Task 3: Rust Core — Tree-sitter Parsing (8 tests)
- [x] Task 4: Rust Core — App Graph (7 tests)
- [x] Task 5: Rust Core — Spec Validation (6 tests)
- [x] Task 6: napi-rs Build + TypeScript Smoke Test
- [x] Task 7: FastAPI Analyzer Plugin (6 tests)
- [x] Task 8: Expo Router Analyzer Plugin (10 tests)
- [x] Task 9: Spec Loader + CLI Commands (2 tests)
- [x] Task 10: End-to-End Test — discover + test working against fixtures
- [x] Task 11: Stack Graphs Name Resolution (scaffolding, 2 tests)
- [x] Infrastructure: Makefile, Dockerfile, GitHub workflows (commented out)

## Test Summary

- Rust tests: 23 passing (parser: 8, graph: 7, validator: 6, resolver: 2)
- TypeScript tests: 18 passing (fastapi: 6, expo-router: 10, spec-loader: 2)
- E2E: `rayuela discover` + `rayuela test` verified against FastAPI fixture

## Review

All 11 plan tasks completed. MVP delivers:
- Tree-sitter parsing for Python and TypeScript
- FastAPI endpoint + guard discovery
- Expo Router screen + navigation discovery
- Declarative YAML spec with path/match tests
- Pass/fail CLI output with exit codes
- Stack Graphs scaffolding (stitcher deferred to post-MVP)
