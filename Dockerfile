# Stage 1: Build the Rust native module
FROM rust:1.94-slim AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js for napi-rs
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm @napi-rs/cli

# Copy Rust workspace
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/

# Build native module
RUN cd crates/core && napi build --platform --release --js index.js --dts index.d.ts

# Stage 2: Build TypeScript
FROM node:22-slim AS ts-builder

RUN npm install -g pnpm

WORKDIR /app

# Copy package files first for caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk/package.json packages/sdk/tsconfig.json ./packages/sdk/
COPY packages/cli/package.json packages/cli/tsconfig.json ./packages/cli/
COPY packages/analyzers/fastapi/package.json packages/analyzers/fastapi/tsconfig.json ./packages/analyzers/fastapi/
COPY packages/analyzers/expo-router/package.json packages/analyzers/expo-router/tsconfig.json ./packages/analyzers/expo-router/

# Copy native module from rust builder
COPY --from=rust-builder /app/crates/core/package.json ./crates/core/package.json
COPY --from=rust-builder /app/crates/core/index.js ./crates/core/index.js
COPY --from=rust-builder /app/crates/core/index.mjs ./crates/core/index.mjs
COPY --from=rust-builder /app/crates/core/index.d.ts ./crates/core/index.d.ts
COPY --from=rust-builder /app/crates/core/*.node ./crates/core/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ ./packages/

# Build TypeScript
RUN pnpm -r run build

# Stage 3: Minimal runtime
FROM node:22-slim

RUN npm install -g pnpm

WORKDIR /app

COPY --from=ts-builder /app/ ./

ENTRYPOINT ["node", "packages/cli/dist/index.js"]
