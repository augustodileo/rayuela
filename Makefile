REGISTRY  := ghcr.io/augustodileo/rayuela
VERSION   := $(shell git describe --tags --always 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo dev)

.PHONY: install setup \
        build build-rust build-ts image \
        lint format \
        test test-rust test-ts test-all ci \
        clean

# ── Dependencies ─────────────────────────────────

install: _check-prereqs
	source "$$HOME/.cargo/env" && cargo check
	pnpm install

# ── Setup (first time) ──────────────────────────

setup:
	@echo "→ Installing Rust toolchain..."
	@command -v rustup >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
	@echo "→ Installing pnpm..."
	@command -v pnpm >/dev/null || npm install -g pnpm
	$(MAKE) install
	$(MAKE) build-rust
	@echo ""
	@echo "  ✓ Setup complete."
	@echo "  → make test       (run all tests)"
	@echo "  → make build      (build everything)"
	@echo ""

# ── Build ────────────────────────────────────────

build: build-rust build-ts

build-rust:
	source "$$HOME/.cargo/env" && cd crates/core && napi build --platform --release --js index.js --dts index.d.ts

build-ts:
	pnpm -r run build

image:
	docker build -t $(REGISTRY):$(VERSION) -f Dockerfile .
	@echo "  $(REGISTRY):$(VERSION)"

# ── Lint & format ────────────────────────────────

lint: install
	source "$$HOME/.cargo/env" && cargo clippy -- -D warnings
	pnpm -r run build

format:
	source "$$HOME/.cargo/env" && cargo fmt
	pnpm -r run format 2>/dev/null || true

# ── Testing ──────────────────────────────────────

test: test-rust test-ts

test-rust:
	source "$$HOME/.cargo/env" && cargo test --lib -- --nocapture

test-ts: build-rust
	pnpm -r run test

test-all: test

ci: lint test

# ── Clean ────────────────────────────────────────

clean:
	source "$$HOME/.cargo/env" && cargo clean
	rm -rf node_modules packages/*/node_modules packages/analyzers/*/node_modules
	rm -rf packages/*/dist packages/analyzers/*/dist
	rm -f crates/core/*.node

# ── Internal helpers ─────────────────────────────

_check-prereqs:
	@command -v cargo  >/dev/null || (echo "ERROR: cargo not found — curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" && exit 1)
	@command -v node   >/dev/null || (echo "ERROR: node not found — https://nodejs.org" && exit 1)
	@command -v pnpm   >/dev/null || (echo "ERROR: pnpm not found — npm install -g pnpm" && exit 1)
