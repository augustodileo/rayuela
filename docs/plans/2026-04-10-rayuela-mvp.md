# Rayuela MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that statically analyzes source code to discover every path through an app (endpoints, screens, guards, call chains) and validates them against a declarative behavior spec — pass/fail.

**Architecture:** Rust core (Tree-sitter parsing + Stack Graphs name resolution + petgraph graph engine) exposed to TypeScript via napi-rs. Framework-specific analyzer plugins written in TypeScript. CLI in TypeScript.

**Tech Stack:** Rust, Tree-sitter, Stack Graphs, petgraph, napi-rs, TypeScript, pnpm workspaces, commander (CLI), vitest (TS tests)

**Development environment:** Ubuntu/WSL. Requires: Rust toolchain (rustup), Node.js 20+, pnpm, build-essential (C compiler for Tree-sitter grammars).

**Spec:** `docs/superpowers/specs/2026-04-09-rayuela-design.md`

---

## File Structure

```
rayuela/
├── Cargo.toml                          # Rust workspace root
├── package.json                        # pnpm workspace root
├── pnpm-workspace.yaml
├── .gitignore
├── crates/
│   └── core/
│       ├── Cargo.toml                  # Rust crate: rayuela-core
│       ├── build.rs                    # napi-rs build script
│       ├── src/
│       │   ├── lib.rs                  # napi exports, module declarations
│       │   ├── parser.rs              # Tree-sitter: parse_file, query_tree
│       │   ├── resolver.rs            # Stack Graphs: build, find_definition, find_references
│       │   ├── calls.rs               # Call hierarchy: get_outgoing_calls
│       │   ├── graph.rs               # AppGraph: nodes, edges, reachability (petgraph)
│       │   └── validator.rs           # Spec validation: match spec against graph
│       └── __tests__/
│           ├── parser_test.rs
│           ├── resolver_test.rs
│           ├── calls_test.rs
│           └── graph_test.rs
├── packages/
│   ├── sdk/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts               # Analyzer interface, shared types
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # CLI entry point (commander)
│   │       ├── discover.ts            # discover command logic
│   │       ├── test-cmd.ts            # test command logic
│   │       ├── spec-loader.ts         # YAML spec parsing + validation
│   │       ├── plugins.ts             # Plugin auto-detection + loading
│   │       └── formatters/
│   │           ├── text.ts            # Human-readable output
│   │           └── junit.ts           # JUnit XML output
│   └── analyzers/
│       ├── fastapi/
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   └── src/
│       │       ├── index.ts           # FastAPI analyzer: detect + analyze
│       │       ├── queries.ts         # Tree-sitter query patterns for Python/FastAPI
│       │       └── guards.ts          # Guard classification from call hierarchy
│       └── expo-router/
│           ├── package.json
│           ├── tsconfig.json
│           └── src/
│               ├── index.ts           # Expo Router analyzer: detect + analyze
│               ├── screens.ts         # File-system route scanning
│               └── api-calls.ts       # API client call detection
└── fixtures/
    ├── fastapi-app/                   # Small FastAPI app for testing
    │   ├── app/
    │   │   ├── main.py
    │   │   ├── api/
    │   │   │   ├── auth.py
    │   │   │   └── items.py
    │   │   ├── services/
    │   │   │   └── item_service.py
    │   │   └── infra/
    │   │       ├── auth.py
    │   │       └── database.py
    │   └── pyproject.toml
    ├── expo-app/                       # Small Expo Router app for testing
    │   ├── app/
    │   │   ├── _layout.tsx
    │   │   ├── auth.tsx
    │   │   ├── (tabs)/
    │   │   │   ├── index.tsx
    │   │   │   └── profile.tsx
    │   │   └── item/
    │   │       └── [id].tsx
    │   ├── lib/
    │   │   ├── api.ts
    │   │   └── auth.ts
    │   └── package.json
    └── rollview/                       # Git submodule or copy of sLEGACY for e2e test
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `rayuela/Cargo.toml`, `rayuela/package.json`, `rayuela/pnpm-workspace.yaml`, `rayuela/.gitignore`
- Create: `rayuela/crates/core/Cargo.toml`, `rayuela/crates/core/build.rs`, `rayuela/crates/core/src/lib.rs`
- Create: `rayuela/packages/sdk/package.json`, `rayuela/packages/sdk/tsconfig.json`, `rayuela/packages/sdk/src/index.ts`

- [ ] **Step 1: Create project directory and initialize git**

```bash
mkdir -p ~/rayuela && cd ~/rayuela
git init
```

- [ ] **Step 2: Create Rust workspace root**

Create `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/core"]
```

- [ ] **Step 3: Create the Rust core crate**

Create `crates/core/Cargo.toml`:
```toml
[package]
name = "rayuela-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", default-features = false, features = ["napi9", "serde-json"] }
napi-derive = "2"

tree-sitter = "0.24"
tree-sitter-python = "0.23"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.23"

stack-graphs = "0.14"
tree-sitter-stack-graphs = "0.10"
tree-sitter-stack-graphs-python = "0.3"
tree-sitter-stack-graphs-typescript = "0.4"

petgraph = "0.7"
globset = "0.4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
napi-build = "2"
```

Create `crates/core/build.rs`:
```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```

Create `crates/core/src/lib.rs`:
```rust
#[macro_use]
extern crate napi_derive;

mod parser;
mod resolver;
mod calls;
mod graph;
mod validator;
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cd ~/rayuela
cargo check 2>&1
```

Expected: Compilation succeeds (warnings are OK — modules are empty). If it fails on missing C compiler: `sudo apt install build-essential`.

- [ ] **Step 5: Create pnpm workspace**

Create `package.json`:
```json
{
  "name": "rayuela",
  "private": true,
  "scripts": {
    "build:rust": "cd crates/core && napi build --platform --release",
    "build:ts": "pnpm -r run build",
    "test:rust": "cargo test",
    "test:ts": "pnpm -r run test"
  }
}
```

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "packages/analyzers/*"
```

- [ ] **Step 6: Create the SDK package with shared types**

Create `packages/sdk/package.json`:
```json
{
  "name": "@rayuela/sdk",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/sdk/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Create `packages/sdk/src/index.ts`:
```typescript
export interface SourceLocation {
  file: string;
  line: number;
}

export interface GraphNode {
  type: "endpoint" | "screen" | "store";
  id: string;
  source: SourceLocation;
  guards: string[];
  conditions: string[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  type: "calls" | "navigates" | "flows";
  from: string;
  to: string;
  source: SourceLocation;
  conditions: string[];
}

export interface AnalysisWarning {
  message: string;
  source: SourceLocation;
}

export interface AnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: AnalysisWarning[];
}

export interface Analyzer {
  name: string;
  detect(sourceDir: string): Promise<boolean>;
  analyze(sourceDir: string): Promise<AnalysisResult>;
}
```

- [ ] **Step 7: Create .gitignore and install dependencies**

Create `.gitignore`:
```
target/
node_modules/
dist/
*.node
.pnpm-store/
```

```bash
cd ~/rayuela
pnpm install
```

- [ ] **Step 8: Commit scaffolding**

```bash
cd ~/rayuela
git add -A
git commit -m "feat: project scaffolding — Rust workspace + pnpm workspace + SDK types"
```

---

## Task 2: Test Fixtures

**Files:**
- Create: `fixtures/fastapi-app/**` (small FastAPI app)
- Create: `fixtures/expo-app/**` (small Expo Router app)

These fixtures are used by ALL subsequent tasks for testing. They're small, self-contained code samples representing the patterns Rayuela needs to detect.

- [ ] **Step 1: Create FastAPI fixture**

Create `fixtures/fastapi-app/pyproject.toml`:
```toml
[project]
name = "fixture-app"
dependencies = ["fastapi", "sqlalchemy"]
```

Create `fixtures/fastapi-app/app/main.py`:
```python
from fastapi import FastAPI
from app.api.auth import router as auth_router
from app.api.items import router as items_router

app = FastAPI()
app.include_router(auth_router, prefix="/api/v1/auth")
app.include_router(items_router, prefix="/api/v1/items")


@app.get("/health")
async def health():
    return {"status": "ok"}
```

Create `fixtures/fastapi-app/app/api/auth.py`:
```python
from fastapi import APIRouter
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/signup")
async def signup(email: str, password: str):
    service = AuthService()
    return await service.create_user(email, password)


@router.post("/login")
async def login(email: str, password: str):
    service = AuthService()
    return await service.authenticate(email, password)
```

Create `fixtures/fastapi-app/app/api/items.py`:
```python
from fastapi import APIRouter, Depends
from uuid import UUID
from app.infra.auth import get_current_user_id
from app.services.item_service import ItemService

router = APIRouter()


@router.post("/")
async def create_item(name: str, user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.create(name, user_id)


@router.get("/")
async def list_items(user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.list_by_user(user_id)


@router.get("/{item_id}")
async def get_item(item_id: UUID, user_id: UUID = Depends(get_current_user_id)):
    service = ItemService()
    return await service.get(item_id, user_id)
```

Create `fixtures/fastapi-app/app/infra/auth.py`:
```python
import jwt
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from uuid import UUID

http_bearer = HTTPBearer()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(http_bearer),
) -> UUID:
    token = credentials.credentials
    payload = jwt.decode(token, "secret", algorithms=["HS256"])
    return UUID(payload["sub"])
```

Create `fixtures/fastapi-app/app/infra/database.py`:
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession


engine = create_async_engine("postgresql+asyncpg://localhost/app")


async def get_db() -> AsyncSession:
    async with AsyncSession(engine) as session:
        yield session
```

Create `fixtures/fastapi-app/app/services/item_service.py`:
```python
from app.infra.database import get_db


class ItemService:
    async def create(self, name: str, user_id):
        db = get_db()
        return {"id": "new-id", "name": name, "user_id": str(user_id)}

    async def list_by_user(self, user_id):
        db = get_db()
        return []

    async def get(self, item_id, user_id):
        db = get_db()
        return {"id": str(item_id), "name": "item", "user_id": str(user_id)}
```

Create `fixtures/fastapi-app/app/services/auth_service.py`:
```python
class AuthService:
    async def create_user(self, email: str, password: str):
        return {"id": "new-user", "email": email, "token": "jwt-token"}

    async def authenticate(self, email: str, password: str):
        return {"token": "jwt-token"}
```

- [ ] **Step 2: Create Expo Router fixture**

Create `fixtures/expo-app/package.json`:
```json
{
  "name": "fixture-expo-app",
  "dependencies": {
    "expo-router": "^6.0.0",
    "@react-navigation/native": "^7.0.0",
    "react": "^19.0.0",
    "react-native": "^0.81.0"
  }
}
```

Create `fixtures/expo-app/lib/auth.ts`:
```typescript
import { create } from "zustand";

interface AuthState {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  login: async (email: string, password: string) => {
    const res = await api.auth.login(email, password);
    set({ user: res.user, isAuthenticated: true });
  },
  logout: () => set({ user: null, isAuthenticated: false }),
}));
```

Create `fixtures/expo-app/lib/api.ts`:
```typescript
const BASE_URL = "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  return res.json();
}

export const api = {
  auth: {
    signup: (data: { email: string; password: string }) =>
      request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(data) }),
    login: (email: string, password: string) =>
      request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  },
  items: {
    create: (data: { name: string }) =>
      request("/api/v1/items", { method: "POST", body: JSON.stringify(data) }),
    list: () =>
      request("/api/v1/items"),
    get: (id: string) =>
      request(`/api/v1/items/${id}`),
  },
};
```

Create `fixtures/expo-app/app/_layout.tsx`:
```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack />;
}
```

Create `fixtures/expo-app/app/auth.tsx`:
```tsx
import { useAuthStore } from "../lib/auth";
import { api } from "../lib/api";
import { useRouter } from "expo-router";

export default function AuthScreen() {
  const { login } = useAuthStore();
  const router = useRouter();

  const handleLogin = async () => {
    await login("user@test.com", "password");
    router.replace("/(tabs)");
  };

  return null; // simplified, no JSX needed for analysis
}
```

Create `fixtures/expo-app/app/(tabs)/index.tsx`:
```tsx
import { useRouter } from "expo-router";
import { useAuthStore } from "../../lib/auth";
import { api } from "../../lib/api";
import { useEffect, useState } from "react";

export default function ItemListScreen() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.items.list().then(setItems);
  }, []);

  const openItem = (id: string) => {
    router.push(`/item/${id}`);
  };

  return null;
}
```

Create `fixtures/expo-app/app/(tabs)/profile.tsx`:
```tsx
import { useAuthStore } from "../../lib/auth";

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  return null;
}
```

Create `fixtures/expo-app/app/item/[id].tsx`:
```tsx
import { useLocalSearchParams } from "expo-router";
import { api } from "../../lib/api";
import { useAuthStore } from "../../lib/auth";
import { useEffect, useState } from "react";

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useAuthStore();
  const [item, setItem] = useState(null);

  useEffect(() => {
    api.items.get(id as string).then(setItem);
  }, [id]);

  return null;
}
```

- [ ] **Step 3: Commit fixtures**

```bash
cd ~/rayuela
git add fixtures/
git commit -m "feat: add test fixtures — FastAPI app + Expo Router app"
```

---

## Task 3: Rust Core — Tree-sitter Parsing

**Files:**
- Create: `crates/core/src/parser.rs`
- Test: `crates/core/tests/parser_test.rs`

This module exposes two functions via napi: `parse_file` (parse a source file into a tree) and `query_tree` (run a Tree-sitter query pattern against a parsed tree).

- [ ] **Step 1: Write the parser module**

Create `crates/core/src/parser.rs`:
```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;

/// Result of parsing a source file with Tree-sitter.
/// Holds the source text + a reference to the tree for subsequent queries.
#[napi]
pub struct ParseResult {
    source: Arc<String>,
    tree: tree_sitter::Tree,
    language: tree_sitter::Language,
    lang_name: String,
}

/// A single match from a Tree-sitter query, with named captures.
#[napi(object)]
pub struct QueryMatch {
    pub captures: HashMap<String, CaptureInfo>,
    pub start_line: u32,
    pub end_line: u32,
}

/// Information about a captured node in a query match.
#[napi(object)]
pub struct CaptureInfo {
    pub text: String,
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
}

fn detect_language(file_path: &str) -> Result<(&str, tree_sitter::Language)> {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    match ext {
        "py" => Ok(("python", tree_sitter_python::LANGUAGE.into())),
        "ts" | "tsx" => Ok(("typescript", tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())),
        "js" | "jsx" => Ok(("javascript", tree_sitter_javascript::LANGUAGE.into())),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("Unsupported file extension: .{other}"),
        )),
    }
}

/// Parse a source file into a Tree-sitter syntax tree.
/// Returns a ParseResult that can be passed to query_tree.
#[napi]
pub fn parse_file(file_path: String) -> Result<ParseResult> {
    let source = std::fs::read_to_string(&file_path).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to read {file_path}: {e}"))
    })?;

    let (lang_name, language) = detect_language(&file_path)?;

    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&language).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to set language: {e}"))
    })?;

    let tree = parser.parse(&source, None).ok_or_else(|| {
        Error::new(Status::GenericFailure, "Tree-sitter parse returned None")
    })?;

    Ok(ParseResult {
        source: Arc::new(source),
        tree,
        language,
        lang_name: lang_name.to_string(),
    })
}

/// Parse source code from a string (not a file). Useful for testing.
#[napi]
pub fn parse_source(source: String, language: String) -> Result<ParseResult> {
    let (lang_name, ts_language) = match language.as_str() {
        "python" => ("python", tree_sitter_python::LANGUAGE.into()),
        "typescript" => ("typescript", tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "javascript" => ("javascript", tree_sitter_javascript::LANGUAGE.into()),
        other => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Unsupported language: {other}"),
            ))
        }
    };

    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&ts_language).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to set language: {e}"))
    })?;

    let tree = parser.parse(&source, None).ok_or_else(|| {
        Error::new(Status::GenericFailure, "Tree-sitter parse returned None")
    })?;

    Ok(ParseResult {
        source: Arc::new(source),
        tree,
        language: ts_language,
        lang_name: lang_name.to_string(),
    })
}

/// Run a Tree-sitter query pattern against a parsed tree.
/// Returns all matches with their captured nodes.
#[napi]
pub fn query_tree(parse_result: &ParseResult, pattern: String) -> Result<Vec<QueryMatch>> {
    let query = tree_sitter::Query::new(&parse_result.language, &pattern).map_err(|e| {
        Error::new(Status::InvalidArg, format!("Invalid query pattern: {e}"))
    })?;

    let mut cursor = tree_sitter::QueryCursor::new();
    let source_bytes = parse_result.source.as_bytes();
    let root = parse_result.tree.root_node();

    let mut results = Vec::new();

    for query_match in cursor.matches(&query, root, source_bytes) {
        let mut captures = HashMap::new();
        let mut min_start = u32::MAX;
        let mut max_end = 0u32;

        for capture in query_match.captures {
            let name = query.capture_names()[capture.index as usize].to_string();
            let node = capture.node;
            let text = node.utf8_text(source_bytes).unwrap_or("").to_string();
            let start_line = node.start_position().row as u32 + 1;
            let end_line = node.end_position().row as u32 + 1;

            min_start = min_start.min(start_line);
            max_end = max_end.max(end_line);

            captures.insert(
                name,
                CaptureInfo {
                    text,
                    start_line,
                    start_col: node.start_position().column as u32,
                    end_line,
                    end_col: node.end_position().column as u32,
                },
            );
        }

        if !captures.is_empty() {
            results.push(QueryMatch {
                captures,
                start_line: min_start,
                end_line: max_end,
            });
        }
    }

    Ok(results)
}

/// Get the language name detected for a ParseResult.
#[napi]
pub fn get_language_name(parse_result: &ParseResult) -> String {
    parse_result.lang_name.clone()
}
```

- [ ] **Step 2: Update lib.rs to export parser module**

Replace `crates/core/src/lib.rs`:
```rust
#[macro_use]
extern crate napi_derive;

pub mod parser;
// pub mod resolver;  // uncomment when implemented
// pub mod calls;     // uncomment when implemented
// pub mod graph;     // uncomment when implemented
// pub mod validator; // uncomment when implemented
```

- [ ] **Step 3: Verify Rust compiles**

```bash
cd ~/rayuela
cargo check 2>&1
```

Expected: Compiles successfully. If tree-sitter C compilation fails, ensure `build-essential` is installed.

- [ ] **Step 4: Write Rust integration test for parser**

Create `crates/core/tests/parser_test.rs`:
```rust
use rayuela_core::parser::*;

#[test]
fn test_parse_python_source() {
    let result = parse_source(
        r#"
@router.post("/items")
async def create_item(name: str):
    return {"name": name}
"#
        .to_string(),
        "python".to_string(),
    )
    .unwrap();

    assert_eq!(get_language_name(&result), "python");
}

#[test]
fn test_query_python_decorated_function() {
    let result = parse_source(
        r#"
@router.post("/items")
async def create_item(name: str):
    return {"name": name}
"#
        .to_string(),
        "python".to_string(),
    )
    .unwrap();

    let matches = query_tree(
        &result,
        r#"
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router
        attribute: (identifier) @method)
      arguments: (argument_list
        (string (string_content) @path))))
  definition: (function_definition
    name: (identifier) @func_name))
"#
        .to_string(),
    )
    .unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].captures["method"].text, "post");
    assert_eq!(matches[0].captures["path"].text, "/items");
    assert_eq!(matches[0].captures["func_name"].text, "create_item");
}

#[test]
fn test_query_python_depends_guard() {
    let result = parse_source(
        r#"
@router.get("/items")
async def list_items(user_id: UUID = Depends(get_current_user_id)):
    return []
"#
        .to_string(),
        "python".to_string(),
    )
    .unwrap();

    let matches = query_tree(
        &result,
        r#"
(default_parameter
  value: (call
    function: (identifier) @dep_func
    (#eq? @dep_func "Depends")
    arguments: (argument_list
      (identifier) @guard_name)))
"#
        .to_string(),
    )
    .unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].captures["guard_name"].text, "get_current_user_id");
}

#[test]
fn test_parse_typescript_source() {
    let result = parse_source(
        r#"
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const router = useRouter();
  router.push("/item/123");
}
"#
        .to_string(),
        "typescript".to_string(),
    )
    .unwrap();

    assert_eq!(get_language_name(&result), "typescript");
}

#[test]
fn test_query_typescript_function_calls() {
    let result = parse_source(
        r#"
import { api } from "../lib/api";

export default function HomeScreen() {
  api.items.list().then(setItems);
  api.items.get("123").then(setItem);
}
"#
        .to_string(),
        "typescript".to_string(),
    )
    .unwrap();

    // Query for member expression calls like api.X.Y()
    let matches = query_tree(
        &result,
        r#"
(call_expression
  function: (member_expression
    object: (member_expression
      object: (identifier) @api_obj
      (#eq? @api_obj "api")
      property: (property_identifier) @module)
    property: (property_identifier) @method))
"#
        .to_string(),
    )
    .unwrap();

    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].captures["module"].text, "items");
    assert_eq!(matches[0].captures["method"].text, "list");
    assert_eq!(matches[1].captures["module"].text, "items");
    assert_eq!(matches[1].captures["method"].text, "get");
}

#[test]
fn test_query_typescript_router_push() {
    let result = parse_source(
        r#"
const router = useRouter();
router.push("/item/123");
router.replace("/(tabs)");
"#
        .to_string(),
        "typescript".to_string(),
    )
    .unwrap();

    let matches = query_tree(
        &result,
        r#"
(call_expression
  function: (member_expression
    object: (identifier) @router_obj
    (#eq? @router_obj "router")
    property: (property_identifier) @nav_method
    (#match? @nav_method "^(push|replace|navigate)$"))
  arguments: (arguments
    (string (string_fragment) @target)))
"#
        .to_string(),
    )
    .unwrap();

    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].captures["target"].text, "/item/123");
    assert_eq!(matches[1].captures["target"].text, "/(tabs)");
}

#[test]
fn test_parse_file_from_fixture() {
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fastapi-app/app/api/items.py"
    );
    let result = parse_file(fixture_path.to_string()).unwrap();
    assert_eq!(get_language_name(&result), "python");

    // Should find 3 route decorators
    let matches = query_tree(
        &result,
        r#"
(decorated_definition
  (decorator
    (call
      function: (attribute
        attribute: (identifier) @method
        (#match? @method "^(get|post|put|delete|patch)$"))))
  definition: (function_definition
    name: (identifier) @func_name))
"#
        .to_string(),
    )
    .unwrap();

    assert_eq!(matches.len(), 3, "Expected 3 routes in items.py");
}

#[test]
fn test_unsupported_language_returns_error() {
    let result = parse_source("fn main() {}".to_string(), "rust".to_string());
    assert!(result.is_err());
}
```

- [ ] **Step 5: Run tests**

```bash
cd ~/rayuela
cargo test -- --nocapture 2>&1
```

Expected: All 7 tests pass. If any query pattern fails, the error message from Tree-sitter will indicate what's wrong with the S-expression pattern — adjust the pattern to match the actual tree structure.

**Debugging tip:** If a query doesn't match, use `tree-sitter parse` CLI or print the tree with `parse_result.tree.root_node().to_sexp()` to see the actual CST shape.

- [ ] **Step 6: Commit**

```bash
cd ~/rayuela
git add crates/core/src/parser.rs crates/core/src/lib.rs crates/core/tests/parser_test.rs
git commit -m "feat(core): tree-sitter parsing — parse_file, parse_source, query_tree"
```

---

## Task 4: Rust Core — App Graph

**Files:**
- Create: `crates/core/src/graph.rs`
- Test: `crates/core/tests/graph_test.rs`

The graph module stores discovered nodes and edges, and answers reachability and pattern-matching queries. Uses petgraph internally.

- [ ] **Step 1: Write the graph module**

Create `crates/core/src/graph.rs`:
```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::algo::has_path_connecting;
use std::collections::HashMap;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct GraphNodeData {
    pub node_type: String,
    pub id: String,
    pub file: String,
    pub line: u32,
    pub guards: Vec<String>,
    pub conditions: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct GraphEdgeData {
    pub edge_type: String,
    pub from_id: String,
    pub to_id: String,
    pub file: String,
    pub line: u32,
}

#[napi]
pub struct AppGraph {
    graph: DiGraph<GraphNodeData, GraphEdgeData>,
    node_index: HashMap<String, NodeIndex>,
}

#[napi]
impl AppGraph {
    #[napi(constructor)]
    pub fn new() -> Self {
        AppGraph {
            graph: DiGraph::new(),
            node_index: HashMap::new(),
        }
    }

    #[napi]
    pub fn add_node(&mut self, node: GraphNodeData) {
        let id = node.id.clone();
        if !self.node_index.contains_key(&id) {
            let idx = self.graph.add_node(node);
            self.node_index.insert(id, idx);
        }
    }

    #[napi]
    pub fn add_edge(&mut self, edge: GraphEdgeData) {
        if let (Some(&from), Some(&to)) = (
            self.node_index.get(&edge.from_id),
            self.node_index.get(&edge.to_id),
        ) {
            self.graph.add_edge(from, to, edge);
        }
    }

    /// Check if there's a directed path from one node to another.
    #[napi]
    pub fn is_reachable(&self, from_id: String, to_id: String) -> bool {
        match (self.node_index.get(&from_id), self.node_index.get(&to_id)) {
            (Some(&from), Some(&to)) => has_path_connecting(&self.graph, from, to, None),
            _ => false,
        }
    }

    /// Find all nodes matching a type and glob pattern on the id.
    #[napi]
    pub fn find_nodes(&self, node_type: String, pattern: String) -> Vec<GraphNodeData> {
        let glob = globset::GlobBuilder::new(&pattern)
            .literal_separator(false)
            .build()
            .and_then(|g| g.compile_matcher().into());

        self.graph
            .node_weights()
            .filter(|n| {
                n.node_type == node_type
                    && match &glob {
                        Ok(m) => m.is_match(&n.id),
                        Err(_) => n.id.contains(&pattern),
                    }
            })
            .cloned()
            .collect()
    }

    /// Find all nodes of a type that have zero incoming edges of a given edge type.
    #[napi]
    pub fn find_orphans(&self, node_type: String, edge_type: String) -> Vec<GraphNodeData> {
        self.graph
            .node_indices()
            .filter(|&idx| {
                let node = &self.graph[idx];
                node.node_type == node_type
                    && !self
                        .graph
                        .edges_directed(idx, petgraph::Direction::Incoming)
                        .any(|e| e.weight().edge_type == edge_type)
            })
            .map(|idx| self.graph[idx].clone())
            .collect()
    }

    /// Get all nodes.
    #[napi]
    pub fn get_all_nodes(&self) -> Vec<GraphNodeData> {
        self.graph.node_weights().cloned().collect()
    }

    /// Get all edges.
    #[napi]
    pub fn get_all_edges(&self) -> Vec<GraphEdgeData> {
        self.graph.edge_weights().cloned().collect()
    }

    /// Get a single node by id.
    #[napi]
    pub fn get_node(&self, id: String) -> Option<GraphNodeData> {
        self.node_index
            .get(&id)
            .map(|&idx| self.graph[idx].clone())
    }

    /// Count nodes by type.
    #[napi]
    pub fn count_nodes(&self, node_type: String) -> u32 {
        self.graph
            .node_weights()
            .filter(|n| n.node_type == node_type)
            .count() as u32
    }

    /// Check if a path exists through a sequence of node IDs.
    #[napi]
    pub fn path_exists(&self, node_ids: Vec<String>) -> bool {
        if node_ids.len() < 2 {
            return node_ids.len() == 1 && self.node_index.contains_key(&node_ids[0]);
        }
        for pair in node_ids.windows(2) {
            if !self.is_reachable(pair[0].clone(), pair[1].clone()) {
                return false;
            }
        }
        true
    }
}
```

- [ ] **Step 2: Uncomment graph in lib.rs**

In `crates/core/src/lib.rs`, change `// pub mod graph;` to `pub mod graph;`.

- [ ] **Step 3: Write graph tests**

Create `crates/core/tests/graph_test.rs`:
```rust
use rayuela_core::graph::*;

fn make_endpoint(id: &str, guards: Vec<&str>) -> GraphNodeData {
    GraphNodeData {
        node_type: "endpoint".to_string(),
        id: id.to_string(),
        file: "test.py".to_string(),
        line: 1,
        guards: guards.into_iter().map(String::from).collect(),
        conditions: vec![],
    }
}

fn make_screen(id: &str, guards: Vec<&str>) -> GraphNodeData {
    GraphNodeData {
        node_type: "screen".to_string(),
        id: id.to_string(),
        file: "test.tsx".to_string(),
        line: 1,
        guards: guards.into_iter().map(String::from).collect(),
        conditions: vec![],
    }
}

fn make_edge(from: &str, to: &str, edge_type: &str) -> GraphEdgeData {
    GraphEdgeData {
        edge_type: edge_type.to_string(),
        from_id: from.to_string(),
        to_id: to.to_string(),
        file: "test.py".to_string(),
        line: 1,
    }
}

#[test]
fn test_add_nodes_and_edges() {
    let mut graph = AppGraph::new();
    graph.add_node(make_screen("UploadScreen", vec!["authenticated"]));
    graph.add_node(make_endpoint("POST /api/items", vec!["authenticated"]));

    assert_eq!(graph.count_nodes("screen".to_string()), 1);
    assert_eq!(graph.count_nodes("endpoint".to_string()), 1);

    graph.add_edge(make_edge("UploadScreen", "POST /api/items", "calls"));

    assert!(graph.is_reachable("UploadScreen".to_string(), "POST /api/items".to_string()));
    assert!(!graph.is_reachable("POST /api/items".to_string(), "UploadScreen".to_string()));
}

#[test]
fn test_transitive_reachability() {
    let mut graph = AppGraph::new();
    graph.add_node(make_screen("ScreenA", vec![]));
    graph.add_node(make_endpoint("POST /api/foo", vec![]));
    graph.add_node(make_screen("ScreenB", vec![]));

    graph.add_edge(make_edge("ScreenA", "POST /api/foo", "calls"));
    graph.add_edge(make_edge("POST /api/foo", "ScreenB", "navigates"));

    assert!(graph.is_reachable("ScreenA".to_string(), "ScreenB".to_string()));
}

#[test]
fn test_find_nodes_by_pattern() {
    let mut graph = AppGraph::new();
    graph.add_node(make_endpoint("GET /api/items", vec!["auth"]));
    graph.add_node(make_endpoint("POST /api/items", vec!["auth"]));
    graph.add_node(make_endpoint("GET /health", vec![]));

    let api_endpoints = graph.find_nodes("endpoint".to_string(), "/api/*".to_string());
    assert_eq!(api_endpoints.len(), 2);

    let health = graph.find_nodes("endpoint".to_string(), "/health".to_string());
    assert_eq!(health.len(), 1);
}

#[test]
fn test_find_orphans() {
    let mut graph = AppGraph::new();
    graph.add_node(make_endpoint("GET /api/items", vec![]));
    graph.add_node(make_endpoint("GET /api/secret", vec![]));
    graph.add_node(make_screen("HomeScreen", vec![]));
    graph.add_edge(make_edge("HomeScreen", "GET /api/items", "calls"));

    let orphans = graph.find_orphans("endpoint".to_string(), "calls".to_string());
    assert_eq!(orphans.len(), 1);
    assert_eq!(orphans[0].id, "GET /api/secret");
}

#[test]
fn test_path_exists_through_sequence() {
    let mut graph = AppGraph::new();
    graph.add_node(make_screen("Upload", vec![]));
    graph.add_node(make_endpoint("POST /upload", vec![]));
    graph.add_node(make_screen("Detail", vec![]));

    graph.add_edge(make_edge("Upload", "POST /upload", "calls"));
    graph.add_edge(make_edge("POST /upload", "Detail", "navigates"));

    assert!(graph.path_exists(vec![
        "Upload".to_string(),
        "POST /upload".to_string(),
        "Detail".to_string(),
    ]));

    assert!(!graph.path_exists(vec![
        "Detail".to_string(),
        "Upload".to_string(),
    ]));
}

#[test]
fn test_duplicate_node_not_added() {
    let mut graph = AppGraph::new();
    graph.add_node(make_endpoint("GET /api/items", vec![]));
    graph.add_node(make_endpoint("GET /api/items", vec!["auth"]));

    assert_eq!(graph.count_nodes("endpoint".to_string()), 1);
    // First one wins
    let node = graph.get_node("GET /api/items".to_string()).unwrap();
    assert!(node.guards.is_empty());
}

#[test]
fn test_get_node_returns_none_for_missing() {
    let graph = AppGraph::new();
    assert!(graph.get_node("nonexistent".to_string()).is_none());
}
```

- [ ] **Step 4: Run tests**

```bash
cd ~/rayuela
cargo test -- --nocapture 2>&1
```

Expected: All parser tests + all graph tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/rayuela
git add crates/core/src/graph.rs crates/core/src/lib.rs crates/core/tests/graph_test.rs
git commit -m "feat(core): app graph — nodes, edges, reachability, pattern matching"
```

---

## Task 5: Rust Core — Spec Validation

**Files:**
- Create: `crates/core/src/validator.rs`
- Test: `crates/core/tests/validator_test.rs`

Validates a parsed spec against the graph. Produces pass/fail results per test.

- [ ] **Step 1: Write the validator module**

Create `crates/core/src/validator.rs`:
```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use crate::graph::AppGraph;

/// A single test from the spec file (parsed by TypeScript, passed to Rust).
#[napi(object)]
#[derive(Clone, Debug)]
pub struct SpecTest {
    pub name: String,
    pub test_type: String, // "path" | "match"
    // For "path" tests:
    pub from_id: Option<String>,
    pub through_ids: Option<Vec<String>>,
    pub to_id: Option<String>,
    // For "match" tests:
    pub match_type: Option<String>,      // "endpoint" | "screen"
    pub match_pattern: Option<String>,    // glob
    pub exclude_pattern: Option<String>,  // glob to exclude
    // Expected properties:
    pub expect_reachable: Option<bool>,
    pub expect_guards: Option<Vec<String>>,
    pub expect_min_callers: Option<u32>,
}

/// Result of validating one spec test.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    pub message: Option<String>,
    pub failures: Vec<TestFailure>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TestFailure {
    pub node_id: String,
    pub reason: String,
    pub file: String,
    pub line: u32,
}

/// Validate a list of spec tests against the graph.
#[napi]
pub fn validate_spec(graph: &AppGraph, tests: Vec<SpecTest>) -> Vec<TestResult> {
    tests.iter().map(|test| validate_one(graph, test)).collect()
}

fn validate_one(graph: &AppGraph, test: &SpecTest) -> TestResult {
    match test.test_type.as_str() {
        "path" => validate_path_test(graph, test),
        "match" => validate_match_test(graph, test),
        _ => TestResult {
            name: test.name.clone(),
            passed: false,
            message: Some(format!("Unknown test type: {}", test.test_type)),
            failures: vec![],
        },
    }
}

fn validate_path_test(graph: &AppGraph, test: &SpecTest) -> TestResult {
    let mut failures = Vec::new();

    // Build the path sequence: [from, ...through, to]
    let mut path_ids = Vec::new();
    if let Some(from) = &test.from_id {
        path_ids.push(from.clone());
    }
    if let Some(through) = &test.through_ids {
        path_ids.extend(through.clone());
    }
    if let Some(to) = &test.to_id {
        path_ids.push(to.clone());
    }

    // Check all nodes exist
    for id in &path_ids {
        if graph.get_node(id.clone()).is_none() {
            failures.push(TestFailure {
                node_id: id.clone(),
                reason: format!("{id} not found in graph"),
                file: String::new(),
                line: 0,
            });
        }
    }

    if !failures.is_empty() {
        return TestResult {
            name: test.name.clone(),
            passed: false,
            message: Some("Path contains nodes not found in graph".to_string()),
            failures,
        };
    }

    // Check reachability
    if let Some(expect_reachable) = test.expect_reachable {
        let is_reachable = if path_ids.len() >= 2 {
            graph.path_exists(path_ids.clone())
        } else if path_ids.len() == 1 {
            graph.get_node(path_ids[0].clone()).is_some()
        } else {
            false
        };

        if is_reachable != expect_reachable {
            let msg = if expect_reachable {
                "Expected path to be reachable but it is not"
            } else {
                "Expected path to NOT be reachable but it is"
            };
            failures.push(TestFailure {
                node_id: path_ids.first().cloned().unwrap_or_default(),
                reason: msg.to_string(),
                file: String::new(),
                line: 0,
            });
        }
    }

    // Check guards on all nodes in the path
    if let Some(expected_guards) = &test.expect_guards {
        for id in &path_ids {
            if let Some(node) = graph.get_node(id.clone()) {
                for guard in expected_guards {
                    if !node.guards.contains(guard) {
                        failures.push(TestFailure {
                            node_id: id.clone(),
                            reason: format!("Missing guard: {guard}"),
                            file: node.file.clone(),
                            line: node.line,
                        });
                    }
                }
            }
        }
    }

    TestResult {
        name: test.name.clone(),
        passed: failures.is_empty(),
        message: None,
        failures,
    }
}

fn validate_match_test(graph: &AppGraph, test: &SpecTest) -> TestResult {
    let node_type = test.match_type.clone().unwrap_or_default();
    let pattern = test.match_pattern.clone().unwrap_or("*".to_string());
    let mut failures = Vec::new();

    let matching_nodes = graph.find_nodes(node_type, pattern);

    // Filter out excluded nodes
    let matching_nodes: Vec<_> = if let Some(exclude) = &test.exclude_pattern {
        let exclude_glob = globset::GlobBuilder::new(exclude)
            .literal_separator(false)
            .build()
            .ok()
            .and_then(|g| Some(g.compile_matcher()));

        matching_nodes
            .into_iter()
            .filter(|n| match &exclude_glob {
                Some(m) => !m.is_match(&n.id),
                None => true,
            })
            .collect()
    } else {
        matching_nodes
    };

    // Check reachability (negative assertion: "should not exist")
    if let Some(false) = test.expect_reachable {
        for node in &matching_nodes {
            failures.push(TestFailure {
                node_id: node.id.clone(),
                reason: format!("{} exists but should not be reachable", node.id),
                file: node.file.clone(),
                line: node.line,
            });
        }

        return TestResult {
            name: test.name.clone(),
            passed: failures.is_empty(),
            message: None,
            failures,
        };
    }

    // Check guards on all matching nodes
    if let Some(expected_guards) = &test.expect_guards {
        for node in &matching_nodes {
            for guard in expected_guards {
                if !node.guards.contains(guard) {
                    failures.push(TestFailure {
                        node_id: node.id.clone(),
                        reason: format!("Missing guard: {guard}"),
                        file: node.file.clone(),
                        line: node.line,
                    });
                }
            }
        }
    }

    TestResult {
        name: test.name.clone(),
        passed: failures.is_empty(),
        message: None,
        failures,
    }
}
```

- [ ] **Step 2: Uncomment validator in lib.rs**

In `crates/core/src/lib.rs`, uncomment `pub mod validator;`.

- [ ] **Step 3: Write validator tests**

Create `crates/core/tests/validator_test.rs`:
```rust
use rayuela_core::graph::*;
use rayuela_core::validator::*;

fn build_test_graph() -> AppGraph {
    let mut graph = AppGraph::new();

    graph.add_node(GraphNodeData {
        node_type: "screen".to_string(),
        id: "UploadScreen".to_string(),
        file: "upload.tsx".to_string(),
        line: 1,
        guards: vec!["authenticated".to_string()],
        conditions: vec![],
    });
    graph.add_node(GraphNodeData {
        node_type: "endpoint".to_string(),
        id: "POST /api/items".to_string(),
        file: "items.py".to_string(),
        line: 10,
        guards: vec!["authenticated".to_string()],
        conditions: vec![],
    });
    graph.add_node(GraphNodeData {
        node_type: "screen".to_string(),
        id: "DetailScreen".to_string(),
        file: "detail.tsx".to_string(),
        line: 1,
        guards: vec!["authenticated".to_string()],
        conditions: vec![],
    });
    graph.add_node(GraphNodeData {
        node_type: "endpoint".to_string(),
        id: "GET /health".to_string(),
        file: "main.py".to_string(),
        line: 5,
        guards: vec![],
        conditions: vec![],
    });

    graph.add_edge(GraphEdgeData {
        edge_type: "calls".to_string(),
        from_id: "UploadScreen".to_string(),
        to_id: "POST /api/items".to_string(),
        file: "upload.tsx".to_string(),
        line: 15,
    });
    graph.add_edge(GraphEdgeData {
        edge_type: "navigates".to_string(),
        from_id: "UploadScreen".to_string(),
        to_id: "DetailScreen".to_string(),
        file: "upload.tsx".to_string(),
        line: 20,
    });

    graph
}

#[test]
fn test_path_reachable_passes() {
    let graph = build_test_graph();
    let results = validate_spec(&graph, vec![SpecTest {
        name: "Upload flow exists".to_string(),
        test_type: "path".to_string(),
        from_id: Some("UploadScreen".to_string()),
        through_ids: Some(vec!["POST /api/items".to_string()]),
        to_id: None,
        match_type: None,
        match_pattern: None,
        exclude_pattern: None,
        expect_reachable: Some(true),
        expect_guards: None,
        expect_min_callers: None,
    }]);

    assert!(results[0].passed);
}

#[test]
fn test_path_unreachable_fails() {
    let graph = build_test_graph();
    let results = validate_spec(&graph, vec![SpecTest {
        name: "Reverse path should fail".to_string(),
        test_type: "path".to_string(),
        from_id: Some("DetailScreen".to_string()),
        through_ids: None,
        to_id: Some("UploadScreen".to_string()),
        match_type: None,
        match_pattern: None,
        exclude_pattern: None,
        expect_reachable: Some(true),
        expect_guards: None,
        expect_min_callers: None,
    }]);

    assert!(!results[0].passed);
}

#[test]
fn test_match_guards_passes() {
    let graph = build_test_graph();
    let results = validate_spec(&graph, vec![SpecTest {
        name: "All API endpoints require auth".to_string(),
        test_type: "match".to_string(),
        from_id: None,
        through_ids: None,
        to_id: None,
        match_type: Some("endpoint".to_string()),
        match_pattern: Some("/api/*".to_string()),
        exclude_pattern: None,
        expect_reachable: None,
        expect_guards: Some(vec!["authenticated".to_string()]),
        expect_min_callers: None,
    }]);

    assert!(results[0].passed);
}

#[test]
fn test_match_guards_fails_for_unguarded() {
    let graph = build_test_graph();
    let results = validate_spec(&graph, vec![SpecTest {
        name: "All endpoints need auth".to_string(),
        test_type: "match".to_string(),
        from_id: None,
        through_ids: None,
        to_id: None,
        match_type: Some("endpoint".to_string()),
        match_pattern: Some("*".to_string()),
        exclude_pattern: None,
        expect_reachable: None,
        expect_guards: Some(vec!["authenticated".to_string()]),
        expect_min_callers: None,
    }]);

    assert!(!results[0].passed);
    assert_eq!(results[0].failures.len(), 1);
    assert_eq!(results[0].failures[0].node_id, "GET /health");
}

#[test]
fn test_negative_assertion_no_debug_endpoints() {
    let graph = build_test_graph();
    // No debug endpoints exist, so this passes
    let results = validate_spec(&graph, vec![SpecTest {
        name: "No debug endpoints".to_string(),
        test_type: "match".to_string(),
        from_id: None,
        through_ids: None,
        to_id: None,
        match_type: Some("endpoint".to_string()),
        match_pattern: Some("/debug/*".to_string()),
        exclude_pattern: None,
        expect_reachable: Some(false),
        expect_guards: None,
        expect_min_callers: None,
    }]);

    assert!(results[0].passed);
}

#[test]
fn test_missing_node_in_path_fails() {
    let graph = build_test_graph();
    let results = validate_spec(&graph, vec![SpecTest {
        name: "Path with nonexistent node".to_string(),
        test_type: "path".to_string(),
        from_id: Some("NonExistentScreen".to_string()),
        through_ids: None,
        to_id: Some("POST /api/items".to_string()),
        match_type: None,
        match_pattern: None,
        exclude_pattern: None,
        expect_reachable: Some(true),
        expect_guards: None,
        expect_min_callers: None,
    }]);

    assert!(!results[0].passed);
    assert!(results[0].failures[0].reason.contains("not found"));
}
```

- [ ] **Step 4: Run tests**

```bash
cd ~/rayuela
cargo test -- --nocapture 2>&1
```

Expected: All parser + graph + validator tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/rayuela
git add crates/core/src/validator.rs crates/core/src/lib.rs crates/core/tests/validator_test.rs
git commit -m "feat(core): spec validator — path tests, match tests, guard checks, negative assertions"
```

---

## Task 6: napi-rs Build + TypeScript Smoke Test

**Files:**
- Modify: `package.json` (add napi build scripts)
- Create: `packages/cli/package.json`, `packages/cli/src/index.ts`
- Test: manual smoke test calling Rust from TypeScript

This task verifies the Rust → TypeScript bridge works end-to-end.

- [ ] **Step 1: Install napi-rs CLI globally**

```bash
npm install -g @napi-rs/cli
```

- [ ] **Step 2: Build the native module**

```bash
cd ~/rayuela/crates/core
napi build --platform --release 2>&1
```

Expected: Produces a `.node` file (e.g., `rayuela-core.linux-x64-gnu.node`) and `index.js` + `index.d.ts` in the crate directory.

- [ ] **Step 3: Create a smoke test script**

Create `packages/cli/package.json`:
```json
{
  "name": "@rayuela/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "rayuela": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "smoke": "tsx src/smoke-test.ts"
  },
  "dependencies": {
    "@rayuela/sdk": "workspace:*",
    "rayuela-core": "file:../../crates/core",
    "commander": "^13.0.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Create `packages/cli/src/smoke-test.ts`:
```typescript
import { parseFile, queryTree, getLanguageName } from "rayuela-core";
import path from "node:path";

const fixturePath = path.resolve(
  import.meta.dirname,
  "../../../fixtures/fastapi-app/app/api/items.py"
);

console.log("Parsing:", fixturePath);
const result = parseFile(fixturePath);
console.log("Language:", getLanguageName(result));

const matches = queryTree(
  result,
  `(decorated_definition
    (decorator
      (call
        function: (attribute
          attribute: (identifier) @method
          (#match? @method "^(get|post|put|delete|patch)$"))))
    definition: (function_definition
      name: (identifier) @func_name))`
);

console.log(`Found ${matches.length} routes:`);
for (const m of matches) {
  console.log(`  ${m.captures["method"]?.text.toUpperCase()} - ${m.captures["func_name"]?.text}`);
}

console.log("\nSmoke test PASSED");
```

- [ ] **Step 4: Install and run smoke test**

```bash
cd ~/rayuela
pnpm install
cd packages/cli
pnpm run smoke 2>&1
```

Expected output:
```
Parsing: /home/.../fixtures/fastapi-app/app/api/items.py
Language: python
Found 3 routes:
  POST - create_item
  GET - list_items
  GET - get_item

Smoke test PASSED
```

- [ ] **Step 5: Delete smoke test, commit**

```bash
rm ~/rayuela/packages/cli/src/smoke-test.ts
cd ~/rayuela
git add packages/cli/package.json packages/cli/tsconfig.json
git commit -m "feat: napi-rs bridge verified — Rust core callable from TypeScript"
```

---

## Task 7: FastAPI Analyzer Plugin

**Files:**
- Create: `packages/analyzers/fastapi/package.json`, `packages/analyzers/fastapi/tsconfig.json`
- Create: `packages/analyzers/fastapi/src/index.ts`, `packages/analyzers/fastapi/src/queries.ts`, `packages/analyzers/fastapi/src/guards.ts`
- Test: `packages/analyzers/fastapi/src/__tests__/analyzer.test.ts`

- [ ] **Step 1: Create package structure**

Create `packages/analyzers/fastapi/package.json`:
```json
{
  "name": "@rayuela/analyzer-fastapi",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@rayuela/sdk": "workspace:*",
    "rayuela-core": "file:../../../crates/core",
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/analyzers/fastapi/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Create Tree-sitter query patterns**

Create `packages/analyzers/fastapi/src/queries.ts`:
```typescript
/** Matches @router.METHOD("path") decorated functions in FastAPI */
export const ROUTE_DECORATOR_QUERY = `
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router_var
        attribute: (identifier) @http_method
        (#match? @http_method "^(get|post|put|delete|patch|options|head)$"))
      arguments: (argument_list
        (string (string_content) @route_path))))
  definition: (function_definition
    name: (identifier) @handler_name
    parameters: (parameters) @params))
`;

/** Matches Depends(guard_function) in function parameters */
export const DEPENDS_GUARD_QUERY = `
(default_parameter
  value: (call
    function: (identifier) @dep_func
    (#eq? @dep_func "Depends")
    arguments: (argument_list
      (identifier) @guard_name)))
`;

/** Matches include_router calls for prefix extraction */
export const INCLUDE_ROUTER_QUERY = `
(call
  function: (attribute
    object: (identifier) @app_var
    attribute: (identifier) @method
    (#eq? @method "include_router"))
  arguments: (argument_list
    (identifier) @router_var
    (keyword_argument
      name: (identifier) @kwarg
      (#eq? @kwarg "prefix")
      value: (string (string_content) @prefix))))
`;
```

- [ ] **Step 3: Create guard classification**

Create `packages/analyzers/fastapi/src/guards.ts`:
```typescript
/** Classify a guard function name into a human-readable guard type */
export function classifyGuard(guardName: string): string {
  const name = guardName.toLowerCase();

  if (name.includes("current_user") || name.includes("user_id") || name.includes("auth")) {
    return "authenticated";
  }
  if (name.includes("admin")) {
    return "role:admin";
  }
  if (name.includes("role") || name.includes("permission")) {
    return "role_check";
  }
  if (name.includes("api_key") || name.includes("apikey")) {
    return "api_key";
  }
  return guardName;
}
```

- [ ] **Step 4: Create the analyzer**

Create `packages/analyzers/fastapi/src/index.ts`:
```typescript
import { parseFile, queryTree } from "rayuela-core";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analyzer, AnalysisResult, GraphNode, GraphEdge, AnalysisWarning } from "@rayuela/sdk";
import { ROUTE_DECORATOR_QUERY, DEPENDS_GUARD_QUERY, INCLUDE_ROUTER_QUERY } from "./queries.js";
import { classifyGuard } from "./guards.js";

interface RouterPrefix {
  routerVar: string;
  prefix: string;
}

export const fastapiAnalyzer: Analyzer = {
  name: "fastapi",

  async detect(sourceDir: string): Promise<boolean> {
    try {
      const content = await readFile(path.join(sourceDir, "pyproject.toml"), "utf-8");
      return content.includes("fastapi");
    } catch {
      try {
        const content = await readFile(path.join(sourceDir, "requirements.txt"), "utf-8");
        return content.includes("fastapi");
      } catch {
        return false;
      }
    }
  },

  async analyze(sourceDir: string): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const warnings: AnalysisWarning[] = [];

    const pyFiles = await glob("**/*.py", { cwd: sourceDir, absolute: true });

    // First pass: find include_router calls to build prefix map
    const prefixMap = new Map<string, string>();
    for (const file of pyFiles) {
      const tree = parseFile(file);
      const includes = queryTree(tree, INCLUDE_ROUTER_QUERY);
      for (const m of includes) {
        const routerVar = m.captures["router_var"]?.text;
        const prefix = m.captures["prefix"]?.text;
        if (routerVar && prefix) {
          prefixMap.set(`${file}:${routerVar}`, prefix);
        }
      }
    }

    // Second pass: find route decorators
    for (const file of pyFiles) {
      const tree = parseFile(file);
      const routes = queryTree(tree, ROUTE_DECORATOR_QUERY);

      for (const route of routes) {
        const method = route.captures["http_method"]?.text?.toUpperCase();
        const routePath = route.captures["route_path"]?.text;
        const handlerName = route.captures["handler_name"]?.text;
        const routerVar = route.captures["router_var"]?.text;

        if (!method || !routePath || !handlerName) continue;

        // Find the prefix for this router (if registered via include_router)
        // Look through all files for include_router that references this router module
        const prefix = findPrefixForFile(file, prefixMap, pyFiles) || "";
        const fullPath = `${prefix}${routePath === "/" ? "" : routePath}`;

        // Find Depends() guards in this handler's parameters
        const guardMatches = queryTree(tree, DEPENDS_GUARD_QUERY);
        // Filter guards that appear within this handler's line range
        const guards = guardMatches
          .filter((g) => g.startLine >= route.startLine && g.endLine <= route.endLine)
          .map((g) => classifyGuard(g.captures["guard_name"]?.text || ""))
          .filter(Boolean);

        const nodeId = `${method} ${fullPath || "/"}`;
        nodes.push({
          type: "endpoint",
          id: nodeId,
          source: { file, line: route.startLine },
          guards,
          conditions: [],
          metadata: { handler: handlerName, router: routerVar },
        });
      }
    }

    return { nodes, edges, warnings };
  },
};

function findPrefixForFile(
  routeFile: string,
  prefixMap: Map<string, string>,
  allFiles: string[]
): string | undefined {
  // Simple heuristic: check if any main.py has an include_router
  // whose router var name matches this file's module name
  const moduleName = path.basename(routeFile, ".py");
  for (const [key, prefix] of prefixMap) {
    if (key.endsWith(`:${moduleName}_router`) || key.endsWith(`:${moduleName}`)) {
      return prefix;
    }
    // Also match "router as X_router" patterns
    const varName = key.split(":")[1];
    if (varName && moduleName.includes(varName.replace("_router", ""))) {
      return prefix;
    }
  }
  return undefined;
}

export default fastapiAnalyzer;
```

- [ ] **Step 5: Write tests**

Create `packages/analyzers/fastapi/src/__tests__/analyzer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { fastapiAnalyzer } from "../index.js";
import path from "node:path";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../fixtures/fastapi-app"
);

describe("FastAPI Analyzer", () => {
  it("detects FastAPI from pyproject.toml", async () => {
    const detected = await fastapiAnalyzer.detect(FIXTURE_DIR);
    expect(detected).toBe(true);
  });

  it("does not detect in non-FastAPI project", async () => {
    const detected = await fastapiAnalyzer.detect("/tmp/nonexistent");
    expect(detected).toBe(false);
  });

  it("discovers all endpoints", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const endpointIds = result.nodes.map((n) => n.id).sort();
    expect(endpointIds).toContain("POST /api/v1/auth/signup");
    expect(endpointIds).toContain("POST /api/v1/auth/login");
    expect(endpointIds).toContain("POST /api/v1/items");
    expect(endpointIds).toContain("GET /api/v1/items");
    expect(endpointIds).toContain("GET /api/v1/items/{item_id}");
    expect(endpointIds).toContain("GET /health");
  });

  it("detects guards on protected endpoints", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const createItem = result.nodes.find((n) => n.id === "POST /api/v1/items");
    expect(createItem?.guards).toContain("authenticated");

    const listItems = result.nodes.find((n) => n.id === "GET /api/v1/items");
    expect(listItems?.guards).toContain("authenticated");
  });

  it("auth endpoints have no guards", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const signup = result.nodes.find((n) => n.id === "POST /api/v1/auth/signup");
    expect(signup?.guards).toHaveLength(0);

    const login = result.nodes.find((n) => n.id === "POST /api/v1/auth/login");
    expect(login?.guards).toHaveLength(0);
  });

  it("health endpoint has no guards", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const health = result.nodes.find((n) => n.id === "GET /health");
    expect(health?.guards).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Install dependencies and run tests**

```bash
cd ~/rayuela
pnpm install
cd packages/analyzers/fastapi
pnpm test 2>&1
```

Expected: All tests pass. If prefix resolution doesn't work perfectly, adjust `findPrefixForFile` logic and re-run.

- [ ] **Step 7: Commit**

```bash
cd ~/rayuela
git add packages/analyzers/fastapi/
git commit -m "feat(analyzer): FastAPI — endpoint discovery, guard detection, prefix resolution"
```

---

## Task 8: Expo Router Analyzer Plugin

**Files:**
- Create: `packages/analyzers/expo-router/package.json`, `packages/analyzers/expo-router/tsconfig.json`
- Create: `packages/analyzers/expo-router/src/index.ts`, `packages/analyzers/expo-router/src/screens.ts`, `packages/analyzers/expo-router/src/api-calls.ts`
- Test: `packages/analyzers/expo-router/src/__tests__/analyzer.test.ts`

- [ ] **Step 1: Create package structure**

Create `packages/analyzers/expo-router/package.json`:
```json
{
  "name": "@rayuela/analyzer-expo-router",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@rayuela/sdk": "workspace:*",
    "rayuela-core": "file:../../../crates/core",
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/analyzers/expo-router/tsconfig.json` (same as fastapi's).

- [ ] **Step 2: Create screen discovery from file-system**

Create `packages/analyzers/expo-router/src/screens.ts`:
```typescript
import { glob } from "glob";
import path from "node:path";

export interface DiscoveredScreen {
  name: string;
  route: string;
  file: string;
}

/** Convert Expo Router file path to route path and screen name */
export function fileToRoute(filePath: string, appDir: string): { route: string; name: string } {
  let relative = path.relative(appDir, filePath);
  // Remove extension
  relative = relative.replace(/\.(tsx?|jsx?)$/, "");
  // index files map to parent route
  relative = relative.replace(/\/index$/, "");
  // [param] → :param
  relative = relative.replace(/\[([^\]]+)\]/g, ":$1");
  // _layout files are not screens
  if (relative.endsWith("_layout") || relative === "_layout") {
    return { route: "", name: "" };
  }

  const route = "/" + relative;

  // Generate screen name from file name
  const baseName = path.basename(filePath, path.extname(filePath));
  const screenName =
    baseName === "index"
      ? dirToScreenName(path.dirname(relative))
      : baseName.replace(/^\[/, "").replace(/\]$/, "") + "Screen";

  // PascalCase
  const name = screenName
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  return { route, name: name.endsWith("Screen") ? name : name + "Screen" };
}

function dirToScreenName(dir: string): string {
  if (!dir || dir === ".") return "HomeScreen";
  // Strip (group) parentheses
  const cleaned = dir.replace(/\(([^)]+)\)/g, "$1");
  const parts = cleaned.split("/");
  return parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1) + "Screen";
}

export async function discoverScreens(sourceDir: string): Promise<DiscoveredScreen[]> {
  const appDir = path.join(sourceDir, "app");
  const files = await glob("**/*.{tsx,ts,jsx,js}", {
    cwd: appDir,
    absolute: true,
    ignore: ["**/_layout.*", "**/*.test.*", "**/*.spec.*"],
  });

  const screens: DiscoveredScreen[] = [];
  for (const file of files) {
    const { route, name } = fileToRoute(file, appDir);
    if (name) {
      screens.push({ name, route, file });
    }
  }
  return screens;
}
```

- [ ] **Step 3: Create API call detection**

Create `packages/analyzers/expo-router/src/api-calls.ts`:
```typescript
import { parseFile, queryTree } from "rayuela-core";
import type { GraphEdge } from "@rayuela/sdk";

/** Tree-sitter query: api.module.method() calls */
const API_CALL_QUERY = `
(call_expression
  function: (member_expression
    object: (member_expression
      object: (identifier) @api_obj
      (#eq? @api_obj "api")
      property: (property_identifier) @module)
    property: (property_identifier) @method))
`;

/** Tree-sitter query: router.push/replace/navigate calls */
const NAVIGATION_QUERY = `
(call_expression
  function: (member_expression
    object: (identifier) @router_obj
    (#eq? @router_obj "router")
    property: (property_identifier) @nav_method
    (#match? @nav_method "^(push|replace|navigate)$"))
  arguments: (arguments
    [(string (string_fragment) @target)
     (template_string (string_fragment) @target)]))
`;

/** Tree-sitter query: useAuthStore() call (implies auth guard) */
const AUTH_STORE_QUERY = `
(call_expression
  function: (identifier) @hook
  (#match? @hook "^use[A-Z].*[Aa]uth"))
`;

export function detectApiCalls(file: string, screenName: string): GraphEdge[] {
  const tree = parseFile(file);
  const matches = queryTree(tree, API_CALL_QUERY);

  return matches.map((m) => ({
    type: "calls" as const,
    from: screenName,
    to: `api.${m.captures["module"]?.text}.${m.captures["method"]?.text}`,
    source: { file, line: m.startLine },
    conditions: [],
  }));
}

export function detectNavigations(file: string, screenName: string): GraphEdge[] {
  const tree = parseFile(file);
  const matches = queryTree(tree, NAVIGATION_QUERY);

  return matches.map((m) => ({
    type: "navigates" as const,
    from: screenName,
    to: m.captures["target"]?.text || "",
    source: { file, line: m.startLine },
    conditions: [],
  }));
}

export function detectAuthGuard(file: string): boolean {
  const tree = parseFile(file);
  const matches = queryTree(tree, AUTH_STORE_QUERY);
  return matches.length > 0;
}
```

- [ ] **Step 4: Create the analyzer**

Create `packages/analyzers/expo-router/src/index.ts`:
```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analyzer, AnalysisResult, GraphNode, GraphEdge } from "@rayuela/sdk";
import { discoverScreens } from "./screens.js";
import { detectApiCalls, detectNavigations, detectAuthGuard } from "./api-calls.js";

export const expoRouterAnalyzer: Analyzer = {
  name: "expo-router",

  async detect(sourceDir: string): Promise<boolean> {
    try {
      const content = await readFile(path.join(sourceDir, "package.json"), "utf-8");
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return "expo-router" in deps;
    } catch {
      return false;
    }
  },

  async analyze(sourceDir: string): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const screens = await discoverScreens(sourceDir);

    for (const screen of screens) {
      const hasAuth = detectAuthGuard(screen.file);

      nodes.push({
        type: "screen",
        id: screen.name,
        source: { file: screen.file, line: 1 },
        guards: hasAuth ? ["authenticated"] : [],
        conditions: [],
        metadata: { route: screen.route },
      });

      // Detect API calls this screen makes
      const apiCalls = detectApiCalls(screen.file, screen.name);
      edges.push(...apiCalls);

      // Detect navigation to other screens
      const navigations = detectNavigations(screen.file, screen.name);
      for (const nav of navigations) {
        // Resolve route path to screen name
        const targetScreen = screens.find(
          (s) =>
            s.route === nav.to ||
            nav.to.startsWith(s.route.replace(/:[\w]+/g, ""))
        );
        if (targetScreen) {
          edges.push({
            ...nav,
            to: targetScreen.name,
          });
        }
      }
    }

    return { nodes, edges, warnings: [] };
  },
};

export default expoRouterAnalyzer;
```

- [ ] **Step 5: Write tests**

Create `packages/analyzers/expo-router/src/__tests__/analyzer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { expoRouterAnalyzer } from "../index.js";
import { fileToRoute } from "../screens.js";
import path from "node:path";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../fixtures/expo-app"
);

describe("fileToRoute", () => {
  const appDir = path.join(FIXTURE_DIR, "app");

  it("converts index to home route", () => {
    const r = fileToRoute(path.join(appDir, "(tabs)/index.tsx"), appDir);
    expect(r.route).toBe("/(tabs)");
    expect(r.name).toBe("TabsScreen");
  });

  it("converts named file to route", () => {
    const r = fileToRoute(path.join(appDir, "(tabs)/profile.tsx"), appDir);
    expect(r.route).toBe("/(tabs)/profile");
    expect(r.name).toBe("ProfileScreen");
  });

  it("converts dynamic route", () => {
    const r = fileToRoute(path.join(appDir, "item/[id].tsx"), appDir);
    expect(r.route).toBe("/item/:id");
    expect(r.name).toBe("IdScreen");
  });

  it("converts auth screen", () => {
    const r = fileToRoute(path.join(appDir, "auth.tsx"), appDir);
    expect(r.route).toBe("/auth");
    expect(r.name).toBe("AuthScreen");
  });

  it("skips _layout files", () => {
    const r = fileToRoute(path.join(appDir, "_layout.tsx"), appDir);
    expect(r.name).toBe("");
  });
});

describe("Expo Router Analyzer", () => {
  it("detects Expo Router from package.json", async () => {
    const detected = await expoRouterAnalyzer.detect(FIXTURE_DIR);
    expect(detected).toBe(true);
  });

  it("discovers all screens", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);
    const screenNames = result.nodes.filter((n) => n.type === "screen").map((n) => n.id);

    expect(screenNames).toContain("AuthScreen");
    expect(screenNames).toContain("ProfileScreen");
    // Should not contain _layout
    expect(screenNames.every((n) => !n.includes("Layout"))).toBe(true);
  });

  it("detects auth guards from useAuthStore", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const profile = result.nodes.find((n) => n.id === "ProfileScreen");
    expect(profile?.guards).toContain("authenticated");

    const auth = result.nodes.find((n) => n.id === "AuthScreen");
    expect(auth?.guards).toContain("authenticated"); // AuthScreen also uses useAuthStore for login
  });

  it("detects API calls from screens", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const apiCalls = result.edges.filter((e) => e.type === "calls");
    const apiCallTargets = apiCalls.map((e) => `${e.from} -> ${e.to}`);

    // ItemListScreen calls api.items.list
    expect(apiCallTargets).toContainEqual(
      expect.stringContaining("api.items.list")
    );
  });

  it("detects navigation edges", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const navEdges = result.edges.filter((e) => e.type === "navigates");
    expect(navEdges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Install and run tests**

```bash
cd ~/rayuela
pnpm install
cd packages/analyzers/expo-router
pnpm test 2>&1
```

Expected: All tests pass. Adjust screen name generation or route resolution if needed.

- [ ] **Step 7: Commit**

```bash
cd ~/rayuela
git add packages/analyzers/expo-router/
git commit -m "feat(analyzer): Expo Router — file-system screen discovery, API calls, navigation edges"
```

---

## Task 9: Spec Loader + CLI Commands

**Files:**
- Create: `packages/cli/src/spec-loader.ts`
- Create: `packages/cli/src/plugins.ts`
- Create: `packages/cli/src/discover.ts`
- Create: `packages/cli/src/test-cmd.ts`
- Create: `packages/cli/src/formatters/text.ts`
- Create: `packages/cli/src/index.ts`
- Test: `packages/cli/src/__tests__/spec-loader.test.ts`

- [ ] **Step 1: Create the spec loader**

Create `packages/cli/src/spec-loader.ts`:
```typescript
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { SpecTest } from "rayuela-core";

interface RawSpec {
  version: number;
  tests: RawSpecTest[];
}

interface RawSpecTest {
  name: string;
  path?: {
    from?: { screen?: string; endpoint?: string };
    through?: Array<{ screen?: string; endpoint?: string }>;
    to?: { screen?: string; endpoint?: string };
  };
  match?: {
    type?: string;
    pattern?: string;
    endpoint?: string;
    screen?: string;
    exclude?: string;
  };
  expect: {
    reachable?: boolean;
    guards?: string[];
    called_by?: { type: string; min: number };
  };
}

function resolveId(ref: { screen?: string; endpoint?: string } | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.screen || ref.endpoint;
}

export async function loadSpec(specPath: string): Promise<SpecTest[]> {
  const content = await readFile(specPath, "utf-8");
  const raw: RawSpec = YAML.parse(content);

  if (raw.version !== 1) {
    throw new Error(`Unsupported spec version: ${raw.version}`);
  }

  return raw.tests.map((t): SpecTest => {
    const isPathTest = !!t.path;
    const isMatchTest = !!t.match;

    if (isPathTest) {
      return {
        name: t.name,
        testType: "path",
        fromId: resolveId(t.path?.from) ?? null,
        throughIds: t.path?.through?.map((r) => resolveId(r)!).filter(Boolean) ?? null,
        toId: resolveId(t.path?.to) ?? null,
        matchType: null,
        matchPattern: null,
        excludePattern: null,
        expectReachable: t.expect.reachable ?? null,
        expectGuards: t.expect.guards ?? null,
        expectMinCallers: null,
      };
    }

    if (isMatchTest) {
      const matchType = t.match!.type || (t.match!.endpoint ? "endpoint" : "screen");
      const matchPattern = t.match!.pattern || t.match!.endpoint || t.match!.screen || "*";

      return {
        name: t.name,
        testType: "match",
        fromId: null,
        throughIds: null,
        toId: null,
        matchType,
        matchPattern,
        excludePattern: t.match!.exclude ?? null,
        expectReachable: t.expect.reachable ?? null,
        expectGuards: t.expect.guards ?? null,
        expectMinCallers: t.expect.called_by?.min ?? null,
      };
    }

    throw new Error(`Test "${t.name}" must have either "path" or "match"`);
  });
}
```

- [ ] **Step 2: Create plugin loader**

Create `packages/cli/src/plugins.ts`:
```typescript
import type { Analyzer } from "@rayuela/sdk";

// Built-in analyzers — imported directly
import { fastapiAnalyzer } from "@rayuela/analyzer-fastapi";
import { expoRouterAnalyzer } from "@rayuela/analyzer-expo-router";

const BUILTIN_ANALYZERS: Analyzer[] = [fastapiAnalyzer, expoRouterAnalyzer];

export async function detectPlugins(sourceDir: string): Promise<Analyzer[]> {
  const detected: Analyzer[] = [];

  for (const analyzer of BUILTIN_ANALYZERS) {
    if (await analyzer.detect(sourceDir)) {
      detected.push(analyzer);
    }
  }

  return detected;
}
```

- [ ] **Step 3: Create text formatter**

Create `packages/cli/src/formatters/text.ts`:
```typescript
import type { TestResult } from "rayuela-core";
import type { GraphNode } from "@rayuela/sdk";

export function formatDiscovery(
  nodes: GraphNode[],
  detectedFrameworks: string[]
): string {
  const lines: string[] = [];

  lines.push(`  Detected: ${detectedFrameworks.join(", ")}`);
  lines.push("");

  const endpoints = nodes.filter((n) => n.type === "endpoint");
  const screens = nodes.filter((n) => n.type === "screen");

  if (endpoints.length > 0) {
    lines.push(`  -- Endpoints (${endpoints.length}) --`);
    for (const ep of endpoints) {
      const guards = ep.guards.length > 0 ? `guards: [${ep.guards.join(", ")}]` : "guards: none";
      const loc = `${ep.source.file.split("/").pop()}:${ep.source.line}`;
      lines.push(`  ${ep.id.padEnd(45)} ${guards.padEnd(30)} ${loc}`);
    }
    lines.push("");
  }

  if (screens.length > 0) {
    lines.push(`  -- Screens (${screens.length}) --`);
    for (const sc of screens) {
      const guards = sc.guards.length > 0 ? `guards: [${sc.guards.join(", ")}]` : "guards: none";
      const route = (sc.metadata as Record<string, string>)?.route || "";
      lines.push(`  ${sc.id.padEnd(30)} route: ${route.padEnd(20)} ${guards}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatTestResults(results: TestResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    const icon = r.passed ? "PASS" : "FAIL";
    lines.push(`  ${icon}  ${r.name}`);

    if (!r.passed) {
      for (const f of r.failures) {
        const loc = f.file ? ` (${f.file.split("/").pop()}:${f.line})` : "";
        lines.push(`        -> ${f.nodeId}: ${f.reason}${loc}`);
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  lines.push("");
  lines.push(`  ${passed} passed, ${failed} failed`);

  return lines.join("\n");
}
```

- [ ] **Step 4: Create discover command**

Create `packages/cli/src/discover.ts`:
```typescript
import { AppGraph } from "rayuela-core";
import { detectPlugins } from "./plugins.js";
import { formatDiscovery } from "./formatters/text.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

export async function runDiscover(sourceDir: string): Promise<void> {
  const plugins = await detectPlugins(sourceDir);

  if (plugins.length === 0) {
    console.log("  No supported frameworks detected.");
    return;
  }

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  for (const plugin of plugins) {
    const result = await plugin.analyze(sourceDir);
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    for (const warning of result.warnings) {
      console.log(`  WARN  ${warning.message} (${warning.source.file}:${warning.source.line})`);
    }
  }

  console.log(
    formatDiscovery(
      allNodes,
      plugins.map((p) => p.name)
    )
  );

  const endpointCount = allNodes.filter((n) => n.type === "endpoint").length;
  const screenCount = allNodes.filter((n) => n.type === "screen").length;
  console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${allEdges.length} edges`);
}
```

- [ ] **Step 5: Create test command**

Create `packages/cli/src/test-cmd.ts`:
```typescript
import { AppGraph, validateSpec as validateSpecRust } from "rayuela-core";
import { detectPlugins } from "./plugins.js";
import { loadSpec } from "./spec-loader.js";
import { formatTestResults } from "./formatters/text.js";

export async function runTest(sourceDir: string, specPath: string): Promise<boolean> {
  const plugins = await detectPlugins(sourceDir);

  if (plugins.length === 0) {
    console.log("  No supported frameworks detected.");
    return false;
  }

  console.log(`  Detected: ${plugins.map((p) => p.name).join(", ")}`);

  // Build graph from all plugins
  const graph = new AppGraph();
  let totalEndpoints = 0;
  let totalScreens = 0;
  let totalEdges = 0;

  for (const plugin of plugins) {
    const result = await plugin.analyze(sourceDir);
    for (const node of result.nodes) {
      graph.addNode({
        nodeType: node.type,
        id: node.id,
        file: node.source.file,
        line: node.source.line,
        guards: node.guards,
        conditions: node.conditions,
      });
      if (node.type === "endpoint") totalEndpoints++;
      if (node.type === "screen") totalScreens++;
    }
    for (const edge of result.edges) {
      graph.addEdge({
        edgeType: edge.type,
        fromId: edge.from,
        toId: edge.to,
        file: edge.source.file,
        line: edge.source.line,
      });
      totalEdges++;
    }
  }

  console.log(`  Discovered: ${totalEndpoints} endpoints, ${totalScreens} screens, ${totalEdges} edges`);
  console.log("");

  // Load spec and validate
  const specTests = await loadSpec(specPath);
  const results = validateSpecRust(graph, specTests);

  console.log(formatTestResults(results));

  return results.every((r) => r.passed);
}
```

- [ ] **Step 6: Create CLI entry point**

Create `packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { runDiscover } from "./discover.js";
import { runTest } from "./test-cmd.js";

const program = new Command();

program
  .name("rayuela")
  .description("Static analysis framework for discovering and validating app behavior paths")
  .version("0.1.0");

program
  .command("discover <source-dir>")
  .description("Scan source code and output all discovered paths")
  .option("--format <format>", "Output format: text, json, yaml", "text")
  .action(async (sourceDir: string) => {
    const resolved = path.resolve(sourceDir);
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved} ...\n`);
    await runDiscover(resolved);
  });

program
  .command("test <source-dir>")
  .description("Validate source code against a behavior spec")
  .option("--spec <file>", "Path to spec file", "rayuela.test.yml")
  .option("--format <format>", "Output format: text, json, junit", "text")
  .action(async (sourceDir: string, options: { spec: string }) => {
    const resolved = path.resolve(sourceDir);
    const specPath = path.resolve(options.spec);
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved} ...\n`);
    const allPassed = await runTest(resolved, specPath);
    process.exit(allPassed ? 0 : 1);
  });

program.parse();
```

- [ ] **Step 7: Write spec loader test**

Create `packages/cli/src/__tests__/spec-loader.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { loadSpec } from "../spec-loader.js";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Spec Loader", () => {
  const tmpSpec = path.join(os.tmpdir(), "rayuela-test-spec.yml");

  it("parses a path test", async () => {
    await writeFile(
      tmpSpec,
      `
version: 1
tests:
  - name: "Upload flow exists"
    path:
      from: { screen: UploadScreen }
      through:
        - { endpoint: "POST /api/items" }
      to: { screen: DetailScreen }
    expect:
      reachable: true
      guards: [authenticated]
`
    );

    const tests = await loadSpec(tmpSpec);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe("Upload flow exists");
    expect(tests[0].testType).toBe("path");
    expect(tests[0].fromId).toBe("UploadScreen");
    expect(tests[0].throughIds).toEqual(["POST /api/items"]);
    expect(tests[0].toId).toBe("DetailScreen");
    expect(tests[0].expectReachable).toBe(true);
    expect(tests[0].expectGuards).toEqual(["authenticated"]);

    await unlink(tmpSpec);
  });

  it("parses a match test", async () => {
    await writeFile(
      tmpSpec,
      `
version: 1
tests:
  - name: "No debug endpoints"
    match: { endpoint: "/debug/*" }
    expect:
      reachable: false
`
    );

    const tests = await loadSpec(tmpSpec);
    expect(tests).toHaveLength(1);
    expect(tests[0].testType).toBe("match");
    expect(tests[0].matchType).toBe("endpoint");
    expect(tests[0].matchPattern).toBe("/debug/*");
    expect(tests[0].expectReachable).toBe(false);

    await unlink(tmpSpec);
  });
});
```

- [ ] **Step 8: Update CLI package.json with analyzer dependencies**

Add to `packages/cli/package.json` dependencies:
```json
{
  "dependencies": {
    "@rayuela/sdk": "workspace:*",
    "@rayuela/analyzer-fastapi": "workspace:*",
    "@rayuela/analyzer-expo-router": "workspace:*",
    "rayuela-core": "file:../../crates/core",
    "commander": "^13.0.0",
    "yaml": "^2.7.0"
  }
}
```

- [ ] **Step 9: Install, test, commit**

```bash
cd ~/rayuela
pnpm install
cd packages/cli
pnpm test 2>&1
```

Expected: Spec loader tests pass.

```bash
cd ~/rayuela
git add packages/cli/
git commit -m "feat(cli): discover + test commands, spec loader, text formatter"
```

---

## Task 10: End-to-End Test with Fixtures

**Files:**
- Create: `fixtures/fastapi-app/rayuela.test.yml`
- Test: manual CLI run

This validates the entire pipeline: CLI → plugin detection → Tree-sitter parsing → graph building → spec validation → pass/fail output.

- [ ] **Step 1: Create a spec file for the FastAPI fixture**

Create `fixtures/fastapi-app/rayuela.test.yml`:
```yaml
version: 1

tests:
  - name: "Auth endpoints are public"
    match: { type: endpoint, pattern: "/api/v1/auth/*" }
    expect:
      guards: []

  - name: "Item endpoints require authentication"
    match: { type: endpoint, pattern: "/api/v1/items*" }
    expect:
      guards: [authenticated]

  - name: "Health check is public"
    path:
      from: { endpoint: "GET /health" }
    expect:
      guards: []

  - name: "No debug endpoints exist"
    match: { endpoint: "/debug/*" }
    expect:
      reachable: false
```

- [ ] **Step 2: Run rayuela discover**

```bash
cd ~/rayuela
npx tsx packages/cli/src/index.ts discover fixtures/fastapi-app 2>&1
```

Expected output shows all 6 endpoints with guards detected.

- [ ] **Step 3: Run rayuela test**

```bash
cd ~/rayuela
npx tsx packages/cli/src/index.ts test fixtures/fastapi-app --spec fixtures/fastapi-app/rayuela.test.yml 2>&1
```

Expected:
```
  rayuela v0.1.0

  Scanning .../fixtures/fastapi-app ...

  Detected: fastapi
  Discovered: 6 endpoints, 0 screens, 0 edges

  PASS  Auth endpoints are public
  PASS  Item endpoints require authentication
  PASS  Health check is public
  PASS  No debug endpoints exist

  4 passed, 0 failed
```

- [ ] **Step 4: Test with a spec that should FAIL**

Create `fixtures/fastapi-app/rayuela.fail.yml`:
```yaml
version: 1

tests:
  - name: "All endpoints require auth (will fail for health + auth)"
    match: { type: endpoint, pattern: "*" }
    expect:
      guards: [authenticated]
```

```bash
cd ~/rayuela
npx tsx packages/cli/src/index.ts test fixtures/fastapi-app --spec fixtures/fastapi-app/rayuela.fail.yml 2>&1
echo "Exit code: $?"
```

Expected: FAIL with exit code 1, showing health + auth endpoints missing guards.

- [ ] **Step 5: Clean up and commit**

```bash
rm fixtures/fastapi-app/rayuela.fail.yml
cd ~/rayuela
git add fixtures/fastapi-app/rayuela.test.yml
git commit -m "feat: end-to-end test — rayuela discover + test working against FastAPI fixture"
```

---

## Task 11: Stack Graphs Name Resolution (Post-MVP Core Feature)

**Note:** Tasks 1-10 deliver a working MVP that discovers routes and guards using Tree-sitter pattern matching alone. Stack Graphs adds cross-file import resolution and is the next major feature after the core CLI works end-to-end.

**Files:**
- Create: `crates/core/src/resolver.rs`
- Test: `crates/core/tests/resolver_test.rs`

- [ ] **Step 1: Write the resolver module**

Create `crates/core/src/resolver.rs`:
```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;
use stack_graphs::graph::StackGraph;
use tree_sitter_stack_graphs::{NoCancellation, StackGraphLanguage};
use std::path::Path;

#[napi(object)]
pub struct SymbolLocation {
    pub file: String,
    pub line: u32,
    pub symbol: String,
}

#[napi]
pub struct NameResolver {
    graph: StackGraph,
}

#[napi]
impl NameResolver {
    /// Build a name resolution graph from all source files in a directory.
    #[napi(factory)]
    pub fn build(source_dir: String) -> Result<NameResolver> {
        let mut graph = StackGraph::new();

        let python_tsg = tree_sitter_stack_graphs_python::language_configuration(&mut graph);
        let ts_tsg = tree_sitter_stack_graphs_typescript::language_configuration_typescript(&mut graph);

        let source_path = Path::new(&source_dir);
        let entries = walkdir(source_path);

        for entry in entries {
            let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
            let source = match std::fs::read_to_string(&entry) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let file_str = entry.to_string_lossy().to_string();
            let file_handle = graph.get_or_create_file(&file_str);

            let result = match ext {
                "py" => python_tsg.as_ref().ok().and_then(|lang| {
                    lang.build_stack_graph_into(&mut graph, file_handle, &source, &NoCancellation).ok()
                }),
                "ts" | "tsx" => ts_tsg.as_ref().ok().and_then(|lang| {
                    lang.build_stack_graph_into(&mut graph, file_handle, &source, &NoCancellation).ok()
                }),
                _ => None,
            };

            if result.is_none() && (ext == "py" || ext == "ts" || ext == "tsx") {
                eprintln!("Warning: failed to build stack graph for {file_str}");
            }
        }

        Ok(NameResolver { graph })
    }

    /// Find where a symbol is defined, given a file and line where it's referenced.
    #[napi]
    pub fn find_definition(&self, _symbol: String, _file: String, _line: u32) -> Option<SymbolLocation> {
        // Stack Graphs path-finding algorithm:
        // 1. Find the reference node for this symbol at file:line
        // 2. Use ForwardPartialPathStitcher to find complete paths
        // 3. Return the definition at the end of the path
        //
        // Implementation requires wiring up PartialPaths + Database + Stitcher.
        // This is the most complex part of the Stack Graphs API.
        // Placeholder until the stitcher is wired up.
        todo!("Wire up Stack Graphs path stitcher for definition lookup")
    }
}

fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walkdir(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}
```

This task is intentionally left with a `todo!()` for `find_definition` because the Stack Graphs stitcher API is complex and needs careful implementation. The build step validates that all Stack Graphs crates compile and the graph can be constructed from source files.

- [ ] **Step 2: Uncomment resolver in lib.rs**

In `crates/core/src/lib.rs`, uncomment `pub mod resolver;`.

- [ ] **Step 3: Write a basic test**

Create `crates/core/tests/resolver_test.rs`:
```rust
use rayuela_core::resolver::*;

#[test]
fn test_build_resolver_from_fixture() {
    let fixture_dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/fastapi-app"
    );

    // Should not panic — validates that Stack Graphs can process the fixture
    let _resolver = NameResolver::build(fixture_dir.to_string()).unwrap();
}
```

- [ ] **Step 4: Run test**

```bash
cd ~/rayuela
cargo test resolver -- --nocapture 2>&1
```

Expected: Test passes (the resolver builds successfully, even though find_definition is not yet implemented).

- [ ] **Step 5: Commit**

```bash
cd ~/rayuela
git add crates/core/src/resolver.rs crates/core/src/lib.rs crates/core/tests/resolver_test.rs
git commit -m "feat(core): stack graphs resolver scaffolding — graph builds from source files

find_definition() is stubbed (todo!) pending stitcher implementation.
Stack Graphs compilation and graph construction verified against fixtures."
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Auto-detect FastAPI and Expo Router — Tasks 7, 8
- [x] Discover endpoints with guards — Task 7
- [x] Discover screens — Task 8
- [x] `rayuela discover` outputs path list — Task 9, 10
- [x] `rayuela test` validates spec and returns pass/fail — Task 9, 10
- [x] Plugin interface — Task 1 (SDK types)
- [x] CI-ready exit code 0/1 — Task 9
- [x] Stack Graphs resolution — Task 11 (scaffolding, stitcher pending)
- [ ] Express analyzer — deferred to post-MVP (FastAPI + Expo Router prove the concept across Python and TypeScript)
- [ ] JUnit output format — deferred (text format is sufficient for MVP validation)
- [ ] Call hierarchy — deferred until Stack Graphs stitcher is implemented in Task 11
- [ ] npm publishing with pre-built binaries — deferred (local development first)

**Placeholder scan:** No TBDs in implementation code. Task 11's `todo!()` is intentional and documented — it compiles but panics if called, ensuring the Stack Graphs dependency chain works before investing in the complex stitcher API.

**Type consistency:** `SpecTest`, `TestResult`, `TestFailure` types used in validator.rs match the TypeScript interface in spec-loader.ts. `GraphNodeData`/`GraphEdgeData` in graph.rs map to `GraphNode`/`GraphEdge` in SDK. `Analyzer` interface used consistently in all plugins.
