# Rayuela — Design Spec

> *Named after Julio Cortázar's 1963 novel "Rayuela" (Hopscotch) — a book designed to be read via multiple different paths. The reader chooses which chapters to follow, making the novel itself a graph of paths with multiple valid traversals. Exactly what this tool models: your app as a graph of paths, with a spec defining which ones are valid.*

**Date:** 2026-04-09
**Status:** Draft
**Author:** DIL83671 + Claude

**Name alternatives:** Aleph (Borges — "the point that contains all points")

## 1. Problem

Developers lack confidence that their code works before merging. The root causes:

- **Environment setup is the test.** CI spends 5 minutes on infrastructure, 5 seconds on assertions.
- **External service flakiness.** Third-party APIs (Gemini, etc.) return 503s, rate-limit, and cost money. CI fails through no fault of the developer's code.
- **Mocking defeats the purpose.** Static hand-written mocks test the mock, not the app. No tooling exists for dynamically capturing real responses and replaying them.
- **Mobile testing is blocked by build times.** Full native rebuilds (Gradle 20min, Xcode 25min) for every test cycle, even when only JS changed.
- **The gap between "tests pass" and "app works" is huge.** All unit tests pass, but nobody knows if a user can actually complete a flow end-to-end.

The deeper insight: **testing is behavior validation. Behavior is paths through the app. Paths are discoverable from source code.** If a framework can statically analyze code to find every path a user can take — every endpoint, every screen, every data flow — then developers can define expected behavior against that map and validate it on every commit, without running anything.

## 2. Product Overview

**Rayuela** (working name) is an open-source CLI framework that statically analyzes source code to discover every path through an application — API routes, UI navigations, data flows — and validates them against a developer-written behavior spec.

**One-liner:** Give me your source code and I'll find every path through your app. You tell me which ones are expected. I'll verify on every commit.

### Core Philosophy

- **Static is the golden rule.** If your code allows a path, the framework finds it. No running, no infrastructure, no flakiness. If runtime later finds a path that static analysis missed, that's a finding worth investigating.
- **Bring what you have.** Source code is the only input for the MVP. In later phases, Docker Compose and Helm charts provide service topology. No proprietary config language to learn.
- **Test, don't discover.** `discover` is a helper for writing specs. `test` is the product — pass/fail against a behavior spec, like Container Structure Tests for app behavior.
- **Stack-agnostic core, stack-specific plugins.** The graph schema, spec format, and test runner are universal. Analyzers for specific frameworks (Express, FastAPI, React Navigation) are plugins. Community can add more.
- **Zero dependencies at runtime.** Single binary. No language servers, no Docker, no external tools. Everything compiled in.

## 3. How It Works

### Two Commands

| Command | Purpose | Output |
|---|---|---|
| `rayuela discover ./src` | One-time helper. Scans source code, outputs all discovered paths. Helps developers write the spec. | Path list to stdout or YAML file |
| `rayuela test ./src` | The actual test. Reads spec, scans code, compares. Runs in CI. | Pass/fail with exit code 0/1 |

### The Flow

1. Developer runs `rayuela discover ./src` to see every path in their codebase
2. Developer writes `rayuela.test.yml` describing expected behavior (which paths should exist, with what guards, which should NOT exist)
3. Developer runs `rayuela test ./src` — framework re-scans source code and validates against the spec
4. `rayuela test` runs in CI on every PR — pass/fail check

### What the Framework Discovers

From source code alone, the framework extracts:

- **Endpoints** — HTTP routes, GraphQL resolvers, RPC handlers, with their HTTP methods, paths, and parameter shapes
- **Screens** — UI components registered as navigation targets (React Navigation screens, Flutter routes, etc.)
- **Guards** — Authentication middleware, role checks, permission decorators attached to endpoints or screens
- **Internal calls** — When one handler calls another service, writes to a database, invokes an external API (via recursive call hierarchy)
- **Navigation edges** — Screen-to-screen transitions defined in navigation configuration or imperative navigation calls

## 4. The Universal App Graph

The internal data model that all analyzers produce and the test runner validates against.

### Node Types

| Type | Represents | Examples |
|---|---|---|
| **Endpoint** | A callable entry point | `GET /api/users`, `POST /api/upload`, GraphQL `createUser` |
| **Screen** | A UI state the user can see | `LoginScreen`, `DashboardScreen`, `AdminPanel` |
| **Store** | A data persistence or processing boundary (Phase 2) | Postgres `users` table, Redis cache, S3 bucket, Gemini API |

### Edge Types

| Type | Connects | Meaning |
|---|---|---|
| **Calls** | Endpoint -> Endpoint, Screen -> Endpoint | "This invokes that" |
| **Navigates** | Screen -> Screen | "User can go from here to there" |
| **Flows** | Store -> Endpoint -> Store (Phase 2) | "Data moves through this pipeline" |

### Metadata

Every node and edge carries:

- `service` — Which source directory / service owns this (single service in MVP, multi-service in Phase 2)
- `guards` — Auth/role requirements discovered from middleware, decorators, etc.
- `conditions` — Feature flags, environment checks, conditional logic that gates reachability
- `source` — File path and line number where this was discovered (for actionable error messages)

## 5. The Behavior Spec File

The developer-authored test definition. Written in YAML, committed to the repo. Follows the Container Structure Test pattern: define expected state, framework validates reality against it.

### Spec Format

```yaml
# rayuela.test.yml
version: 1

tests:
  # Test that a specific path/flow exists
  - name: "Upload flow exists and is authenticated"
    path:
      from: { screen: UploadScreen }
      through:
        - { endpoint: "POST /api/videos" }
      to: { screen: ResultsScreen }
    expect:
      guards: [authenticated]
      reachable: true

  # Test guards on a specific screen
  - name: "Admin panel requires admin role"
    path:
      from: { screen: AdminPanel }
    expect:
      guards: [authenticated, "role:admin"]
      reachable: true

  # Test a pattern across all matching nodes
  - name: "All backend endpoints require authentication"
    match: { type: endpoint, pattern: "/api/*" }
    expect:
      guards: [authenticated]

  # Test that something should NOT exist
  - name: "Debug endpoints should not exist"
    match: { endpoint: "/debug/*" }
    expect:
      reachable: false
```

### Spec Capabilities

| Feature | Description |
|---|---|
| **Single path test** | Assert a specific path exists with specific properties |
| **Pattern matching** | Assert properties across all nodes matching a glob/regex |
| **Negative assertions** | Assert that a path or endpoint should NOT be reachable |
| **Guard validation** | Assert that specific auth/role guards are present |
| **Reachability** | Assert whether a node is reachable from a given starting point |
| **Path ordering** | `through` list is ordered — nodes must appear in sequence along the path. Use `includes` (unordered) for "all of these exist in the path, any order" |

### Test Output

```
$ rayuela test ./src

  rayuela v0.1.0

  Scanning ./src ... detected: fastapi, expo-router, sqlalchemy
  Discovered: 15 endpoints, 7 screens, 12 edges

  PASS  Upload flow exists and is authenticated
  PASS  Admin panel requires admin role
  FAIL  All backend endpoints require authentication
        -> GET /api/health has no guards (src/routes/health.ts:3)
  FAIL  Debug endpoints should not exist
        -> GET /debug/dump is reachable (src/routes/debug.ts:14)

  2 passed, 2 failed
```

Exit code 0 on all pass, 1 on any failure. CI-ready.

## 6. Technical Architecture

### Overview

The framework is a Rust core exposed to TypeScript via napi-rs. The Rust core handles all analysis (parsing, name resolution, call hierarchy, graph operations). TypeScript handles the user-facing layer (CLI, plugins, config loading, output formatting).

```
┌──────────────────────────────────────────────────┐
│  Layer 4: Framework Plugins (TypeScript)          │  <- Community writes these
│  fastapi-analyzer, express-analyzer,              │
│  expo-router-analyzer, etc.                       │
├──────────────────────────────────────────────────┤
│  Layer 3: CLI & Config (TypeScript)               │  <- User-facing
│  rayuela discover / test, YAML loading,        │
│  output formatting (text, JUnit, JSON)            │
├──────────────────────────────────────────────────┤
│  Layer 2: napi-rs Bridge                          │  <- Auto-generated glue
│  Rust <-> Node.js type-safe bindings              │
├──────────────────────────────────────────────────┤
│  Layer 1: Core Engine (Rust)                      │  <- The heavy lifting
│  Tree-sitter parsing, Stack Graphs name           │
│  resolution, call hierarchy, petgraph             │
│  graph operations, spec validation                │
└──────────────────────────────────────────────────┘
```

### Layer 1: Rust Core

Three Rust-native libraries power the core:

**Tree-sitter** — Universal parser. Parses any language into a concrete syntax tree (CST) that can be queried with declarative patterns. One API for all languages, grammars compiled into the binary. Used to find framework-specific patterns (route decorators, screen exports, call expressions, guard references).

**Stack Graphs** — Cross-file name resolution. Built on Tree-sitter by GitHub. Powers "Go to definition" and "Find references" on github.com. Uses a declarative DSL to define name binding rules per language. Resolves imports, follows symbol references across files, handles re-exports. No external server needed — runs in-process.

**petgraph** — Graph data structure and algorithms. Stores the Universal App Graph. Provides reachability checks, path finding, cycle detection.

```toml
# Cargo.toml
[package]
name = "rayuela-core"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
# napi-rs bridge
napi = { version = "2", features = ["napi9", "serde-json"] }
napi-derive = "2"

# Parsing
tree-sitter = "0.24"
tree-sitter-python = "0.23"
tree-sitter-typescript = "0.23"
tree-sitter-javascript = "0.23"

# Name resolution
tree-sitter-stack-graphs = "0.9"
tree-sitter-stack-graphs-typescript = "0.4"
tree-sitter-stack-graphs-python = "0.3"
stack-graphs = "0.14"

# Graph
petgraph = "0.7"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"

# File matching
globset = "0.4"

# Parallel file scanning
rayon = "1"

[build-dependencies]
napi-build = "2"
```

#### Parsing (Tree-sitter)

Tree-sitter parses any supported language into a uniform syntax tree. Language detection is by file extension. Grammars are compiled into the binary — no runtime downloads.

```rust
#[napi]
pub fn parse_file(file_path: String) -> Result<ParseResult> {
    let source = std::fs::read_to_string(&file_path)?;
    let lang = match file_path.rsplit('.').next() {
        Some("py")         => tree_sitter_python::LANGUAGE,
        Some("ts" | "tsx") => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
        Some("js" | "jsx") => tree_sitter_javascript::LANGUAGE,
        _ => return Err(Error::new(Status::InvalidArg, "Unsupported language"))
    };

    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&lang.into())?;
    let tree = parser.parse(&source, None).unwrap();
    Ok(ParseResult { tree, source, language: lang })
}

#[napi]
pub fn query_tree(parse_result: &ParseResult, pattern: String) -> Result<Vec<QueryMatch>> {
    let query = tree_sitter::Query::new(&parse_result.language, &pattern)?;
    let mut cursor = tree_sitter::QueryCursor::new();
    // ... execute query, collect matches with captured text and positions
}
```

Plugin authors use Tree-sitter to find framework-specific patterns:

```scheme
;; Tree-sitter query: find FastAPI route decorators
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router
        attribute: (identifier) @method
        (#match? @method "^(get|post|put|delete|patch)$"))
      arguments: (argument_list (string) @path)))
  definition: (function_definition
    name: (identifier) @func_name
    parameters: (parameters) @params))
```

The same query API works for any language. A Python decorator and a TypeScript function call produce different tree shapes, but are queried with the same mechanism.

#### Name Resolution (Stack Graphs)

Stack Graphs builds a graph where paths represent valid name bindings. When a plugin finds a symbol reference (e.g., `get_current_user_id` used as a guard), it asks Stack Graphs where that symbol is defined.

```rust
#[napi]
pub struct NameResolver {
    graph: stack_graphs::graph::StackGraph,
}

#[napi]
impl NameResolver {
    /// Build the name resolution graph for all source files
    #[napi]
    pub fn build(source_dir: String) -> Result<NameResolver> {
        let mut graph = StackGraph::new();

        // Load language-specific name binding rules
        let python_rules = StackGraphLanguage::from_str(
            tree_sitter_python::LANGUAGE.into(),
            PYTHON_STACK_GRAPH_RULES,
        )?;
        let typescript_rules = StackGraphLanguage::from_str(
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            TYPESCRIPT_STACK_GRAPH_RULES,
        )?;

        // Process all source files
        for file in find_source_files(&source_dir) {
            let source = std::fs::read_to_string(&file)?;
            let rules = match detect_language(&file) {
                "python" => &python_rules,
                "typescript" => &typescript_rules,
                _ => continue, // skip unsupported languages
            };
            rules.build_stack_graph_into(&mut graph, &file, &source)?;
        }

        Ok(NameResolver { graph })
    }

    /// Find where a symbol is defined
    #[napi]
    pub fn find_definition(&self, symbol: String, used_in_file: String) -> Option<SymbolLocation> {
        // Stack Graphs resolves the reference to its definition
        // Follows imports across files, handles re-exports
    }

    /// Find all references to a symbol
    #[napi]
    pub fn find_references(&self, symbol: String, defined_in_file: String) -> Vec<SymbolLocation> {
        // Returns every file+line that references this symbol
    }
}
```

#### Call Hierarchy (Tree-sitter + Stack Graphs composed)

Call hierarchy is NOT a separate capability — it's built by composing the two primitives recursively:

1. **Tree-sitter** finds all call expressions in a function body
2. **Stack Graphs** resolves each called symbol to its definition
3. **Recurse** into the resolved definition (up to a configurable depth limit)

```rust
#[napi]
pub fn get_outgoing_calls(
    file: String,
    function_line: u32,
    resolver: &NameResolver,
    max_depth: u32,  // default: 3, prevents infinite recursion
) -> Vec<CallChainNode> {
    // 1. Parse the file, find the function body
    let tree = parse_file(&file);
    let func_body = find_function_body(&tree, function_line);

    // 2. Tree-sitter: find all call expressions in the body
    let calls = query_tree(&tree, CALL_EXPRESSION_QUERY, within: func_body);

    let mut results = Vec::new();
    for call in calls {
        let callee_name = extract_callee_name(&call);

        // 3. Stack Graphs: resolve the called symbol to its definition
        let definition = resolver.find_definition(callee_name, &file);

        let mut node = CallChainNode {
            name: callee_name,
            defined_in: definition.file.clone(),
            defined_at: definition.line,
            children: vec![],
        };

        // 4. Recurse (if under depth limit)
        if max_depth > 0 {
            node.children = get_outgoing_calls(
                definition.file,
                definition.line,
                resolver,
                max_depth - 1,
            );
        }

        results.push(node);
    }

    results
}
```

Example output for RollView's `get_upload_url` route handler:

```
get_upload_url (backend/app/api/rolls.py:3)
  ├── get_current_user_id (backend/app/infra/auth.py:28)   <- guard
  │     ├── jwt.decode                                      <- JWT validation
  │     └── HTTPBearer                                      <- token extraction
  └── roll_service.get_upload_url (backend/app/services/roll_service.py:15)
        └── storage.generate_upload_url (backend/app/infra/storage.py:22)
              └── boto3.client.generate_presigned_url       <- S3 call
```

### Layer 2: napi-rs Bridge

napi-rs auto-generates TypeScript types and a JavaScript loader from `#[napi]` annotations. Plugin authors import typed functions that call Rust under the hood.

Auto-generated TypeScript types:

```typescript
// index.d.ts — generated by napi-rs
export function parseFile(filePath: string): ParseResult;
export function queryTree(parseResult: ParseResult, pattern: string): QueryMatch[];

export class NameResolver {
  static build(sourceDir: string): NameResolver;
  findDefinition(symbol: string, usedInFile: string): SymbolLocation | null;
  findReferences(symbol: string, definedInFile: string): SymbolLocation[];
}

export function getOutgoingCalls(
  file: string, functionLine: number,
  resolver: NameResolver, maxDepth?: number
): CallChainNode[];

export class AppGraph {
  constructor();
  addNode(node: GraphNode): void;
  addEdge(edge: GraphEdge): void;
  isReachable(fromId: string, toId: string): boolean;
  findNodes(nodeType: string, pattern: string): GraphNode[];
  findOrphans(nodeType: string, edgeType: string): GraphNode[];
}
```

Pre-built binaries for all platforms. Users never install Rust:

```
@rayuela/core/
  ├── rayuela.darwin-arm64.node     # macOS Apple Silicon
  ├── rayuela.darwin-x64.node       # macOS Intel
  ├── rayuela.linux-x64-gnu.node    # Linux
  ├── rayuela.win32-x64-msvc.node   # Windows
  ├── index.js                         # picks the right binary
  └── index.d.ts                       # TypeScript types
```

### Layer 3: CLI & Config (TypeScript)

User-facing layer. Pure TypeScript.

```typescript
import { parseFile, queryTree, NameResolver, AppGraph, getOutgoingCalls } from '@rayuela/core';
import { loadSpec } from './spec-loader';
import { loadPlugins } from './plugins';
import { formatOutput } from './formatters';

async function test(sourceDir: string, specPath: string) {
  const spec = loadSpec(specPath);
  const resolver = NameResolver.build(sourceDir);
  const plugins = await loadPlugins(sourceDir);

  // Each plugin analyzes source code using the Rust core
  const allResults = [];
  for (const plugin of plugins) {
    allResults.push(await plugin.analyze(sourceDir, resolver));
  }

  // Build graph (Rust petgraph), validate against spec (Rust)
  const graph = new AppGraph();
  for (const result of allResults) {
    result.nodes.forEach(n => graph.addNode(n));
    result.edges.forEach(e => graph.addEdge(e));
  }

  const testResults = graph.validateSpec(spec);
  console.log(formatOutput(testResults));
  process.exit(testResults.every(r => r.passed) ? 0 : 1);
}
```

### Layer 4: Framework Plugins (TypeScript)

Plugin authors write TypeScript. They call the Rust core for parsing and name resolution but contain all framework-specific knowledge.

```typescript
// @rayuela/analyzer-fastapi
import { parseFile, queryTree, getOutgoingCalls } from '@rayuela/core';
import type { Analyzer, NameResolver, GraphNode, GraphEdge } from '@rayuela/sdk';

export const fastapiAnalyzer: Analyzer = {
  name: 'fastapi',

  async detect(sourceDir) {
    const pyproject = await readFile(`${sourceDir}/pyproject.toml`).catch(() => '');
    return pyproject.includes('fastapi');
  },

  async analyze(sourceDir, resolver: NameResolver) {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const file of await glob(`${sourceDir}/**/*.py`)) {
      const tree = parseFile(file);

      // Tree-sitter: find route decorators
      const routes = queryTree(tree, FASTAPI_ROUTE_QUERY);

      for (const route of routes) {
        const method = route.captures['method'].text.toUpperCase();
        const path = route.captures['path'].text.replace(/['"]/g, '');

        // Tree-sitter: find Depends() guards in params
        const guards = queryTree(tree, DEPENDS_QUERY, { within: route.captures['params'] });

        // Stack Graphs: follow each guard to its definition to classify it
        const classifiedGuards = [];
        for (const guard of guards) {
          const def = resolver.findDefinition(guard.captures['guard_name'].text, file);
          if (def) {
            // Read the guard function, analyze what it does
            const guardCalls = getOutgoingCalls(def.file, def.line, resolver, 2);
            classifiedGuards.push(classifyGuard(guard.captures['guard_name'].text, guardCalls));
          }
        }

        nodes.push({
          type: 'endpoint',
          id: `${method} ${resolvePath(file, path)}`,
          source: { file, line: route.startLine },
          guards: classifiedGuards,
        });

        // Call hierarchy: what does this handler call?
        const handlerCalls = getOutgoingCalls(file, route.startLine, resolver, 3);
        for (const call of handlerCalls) {
          edges.push({
            type: 'calls',
            from: `${method} ${resolvePath(file, path)}`,
            to: call.name,
            source: { file: call.definedIn, line: call.definedAt },
          });
        }
      }
    }

    return { nodes, edges, warnings: [] };
  }
};
```

### Plugin Interface

```typescript
interface Analyzer {
  name: string;
  detect(sourceDir: string): Promise<boolean>;
  analyze(sourceDir: string, resolver: NameResolver): Promise<AnalysisResult>;
}

interface AnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: AnalysisWarning[];
}

interface GraphNode {
  type: "endpoint" | "screen" | "store";
  id: string;
  source: SourceLocation;
  guards: string[];
  conditions: string[];
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  type: "calls" | "navigates" | "flows";
  from: string;
  to: string;
  source: SourceLocation;
  conditions: string[];
}
```

### MVP Analyzers

| Analyzer | Detects via | What it discovers |
|---|---|---|
| **fastapi** | `fastapi` in pyproject.toml | `@app.get/post/...` decorators, `Depends()` guards, call chains |
| **express** | `express` in package.json | `router.get/post/...`, middleware chains, `app.use()` |
| **expo-router** | `expo-router` in package.json | File-system routing (directory = route), screen components |
| **react-navigation** | `@react-navigation/*` in package.json | `createStackNavigator`, `Screen` components, linking config |

### Analysis Limitations (Honest)

Static analysis cannot resolve everything:

- **Dynamic routes** (`app.use(dynamicRouter())`) — emits a warning, not a node
- **Runtime-computed guards** (`if (env === 'prod') requireAuth()`) — detected as conditional
- **Reflection / metaprogramming** — opaque to static analysis, flagged as warning
- **Very complex re-exports** — Stack Graphs handles most patterns but edge cases may require LSP (see Future: LSP Enhancement)
- **Cross-service calls** — in MVP (single codebase), these appear as unresolved references. Phase 2 resolves them via deployment descriptors.

Warnings appear in both `discover` and `test` output so developers know what the framework couldn't analyze.

## 7. CLI Design

### Commands

```
rayuela discover <source-dir> [options]
  --format yaml|json|text    Output format (default: text)
  --output <file>            Write to file instead of stdout
  --analyzers <list>         Force specific analyzers (default: auto-detect)
  --depth <n>                Call hierarchy depth (default: 3)

rayuela test <source-dir> [options]
  --spec <file>              Path to spec file (default: rayuela.test.yml)
  --format text|json|junit   Output format (default: text, junit for CI)
  --verbose                  Show all discovered paths, not just test results

rayuela init
  Auto-detect frameworks, run discovery, generate a starter spec file

rayuela plugins list|install|create
  Manage analyzer plugins
```

### CI Integration

```yaml
# GitHub Actions
- name: Rayuela
  run: npx rayuela test ./src --format junit > test-results.xml

# GitLab CI
test:rayuela:
  script: npx rayuela test ./src
```

Exit code 0/1. JUnit output for CI dashboards. No infrastructure, no Docker, no services to boot.

## 8. Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Core language** | Rust | Tree-sitter and Stack Graphs are Rust-native. Single compiled binary. Fastest parsing and graph operations. |
| **User-facing language** | TypeScript | Plugin authors (web developers) already know TS. npm distribution. CLI tooling. |
| **Bridge** | napi-rs | Auto-generates TS types from Rust. Pre-built binaries per platform. Battle-tested (SWC, Turbopack, Biome). |
| **Parsing** | Tree-sitter (compiled into binary) | Universal parser for 200+ languages. Declarative query patterns. Microsecond-per-file performance. |
| **Name resolution** | Stack Graphs (compiled into binary) | Built by GitHub for github.com code navigation. Handles imports, re-exports, scoping. No external server. |
| **Call hierarchy** | Tree-sitter + Stack Graphs composed recursively | Find calls (Tree-sitter) + resolve targets (Stack Graphs) + recurse. No special capability needed. |
| **Graph engine** | petgraph (Rust crate) | Reachability, path finding, cycle detection. In-memory, no database. |
| **Plugin distribution** | npm packages (`@rayuela/analyzer-express`) | Leverages npm ecosystem. `rayuela plugins install` wraps npm. |
| **Spec format** | YAML | Matches developer expectations from Docker Compose, GitHub Actions, k8s manifests. |
| **Distribution** | npm with pre-built native binaries | `npx rayuela` just works. napi-rs handles cross-platform builds. No Rust toolchain needed on user machines. |
| **License** | MIT or Apache 2.0 | Maximum adoption for open-source core. |

## 9. Phased Roadmap

| Phase | Scope | Input | Output |
|---|---|---|---|
| **1 — MVP** | Source code analysis (Tree-sitter + Stack Graphs) + discover + test + spec file + plugin interface + CLI | Source code directory | Pass/fail against behavior spec |
| **2 — Infrastructure** | Docker Compose / Helm parsing, cross-service path tracing, Store nodes (DB, S3, external APIs) | Deployment descriptor + source code | Cross-service path validation |
| **3 — Runtime** | HTTP proxy for runtime path capture, record/replay of external services | Running app | Runtime path graph + recorded cassettes |
| **4 — Diff Engine** | Static vs runtime graph comparison, finding classification | Static graph + runtime graph | Discrepancy report (static predicted X, runtime shows Y) |
| **5 — Cloud** | Hosted environments, device farms, dashboards, team features | Git push | Full confidence report with web UI |

## 10. Competitive Landscape

| Product | Overlap | Key Difference |
|---|---|---|
| **AppMap** | Runtime path visualization, code maps | Runtime-first (instruments running app). Rayuela is static-first. |
| **Octrafic** | Static API route discovery from source code | API-only, no UI/navigation/data flows. No spec/test format. No plugin system. No name resolution. |
| **Testcontainers** | Integration test environment setup | Runs real containers. No path discovery, no static analysis. |
| **Container Structure Tests** | Declarative spec -> pass/fail pattern | Tests container images, not application behavior. Rayuela applies the same pattern to app paths. |
| **SAST tools** (Snyk, SonarQube) | Static code analysis | Focused on security vulnerabilities, not functional path discovery. |
| **OpenTelemetry / Jaeger** | Path tracing across services | Runtime only, requires instrumentation. Observability, not testing. |
| **Stack Graphs (GitHub)** | Name resolution across files | Rayuela uses Stack Graphs as a library. GitHub uses it for code navigation UI. Rayuela uses it for behavior validation. |

No existing product combines: source code static analysis + multi-layer path discovery (API + UI + data) + cross-file name resolution + call hierarchy + declarative behavior spec + pass/fail validation.

## 11. Success Criteria for MVP

- [ ] Auto-detect FastAPI, Express, and Expo Router from source code
- [ ] Discover endpoints with guards (classified via call hierarchy analysis)
- [ ] Discover screens with navigation edges
- [ ] Resolve cross-file imports and symbol references via Stack Graphs
- [ ] Build call hierarchy for route handlers and screen components
- [ ] `rayuela discover` outputs complete path list for RollView sample app
- [ ] `rayuela test` validates a spec file and returns pass/fail
- [ ] Plugin interface allows community to add new analyzers
- [ ] Runs in under 10 seconds for a codebase with <500 source files
- [ ] CI-ready: exit code 0/1, JUnit output format
- [ ] Published as npm package with pre-built native binaries, installable via `npx rayuela`
- [ ] Zero runtime dependencies — single binary, no language servers, no Docker

## 12. Future: LSP Enhancement

Stack Graphs handles import resolution and name binding for the vast majority of patterns. However, some edge cases may benefit from deeper analysis that only a full language server can provide:

- Complex re-exports (`export * from './barrel'` chains)
- Dynamic imports (`const mod = await import(path)`)
- Metaprogramming / runtime code generation
- Full type inference (knowing that `router` is of type `APIRouter`)

**If these limitations become a real problem**, LSP can be added as an optional enhancement. The architecture supports this cleanly:

- `callHierarchy/incomingCalls` — who calls this function (more accurate than Stack Graphs references filtered by call context)
- `callHierarchy/outgoingCalls` — what does this function call (validates our Tree-sitter + Stack Graphs approach)
- `textDocument/hover` — full type information
- `textDocument/definition` — alternative to Stack Graphs for edge cases

LSP would require language servers installed (Pyright, tsserver, gopls). This is acceptable for a post-MVP enhancement because:
- Most developers already have these installed (VS Code installs them)
- CI environments can add them as dev dependencies
- The core framework works without them — LSP only improves accuracy

**Decision: Not in MVP. Re-evaluate after real-world usage reveals whether Stack Graphs' accuracy is sufficient.**

## 13. Open Questions

1. **Monorepo support** — How does the framework handle monorepos where backend and frontend are in different directories but the same repo? (Likely: accept multiple source dirs as arguments, or auto-detect from root)
2. **Dynamic route resolution** — How aggressively should analyzers try to resolve dynamic routes? (Likely: best-effort + warning, never silent skip)
3. **Spec composability** — Should specs support imports/includes for large projects? (Likely: yes, but not in MVP)
4. **Graph visualization** — Should MVP include any visual output (Mermaid diagram export)? (Likely: stretch goal)
5. **Product name** — "Rayuela" is a working name. Needs trademark check.
6. **Stack Graphs language coverage** — Verify that `tree-sitter-stack-graphs-python` and `tree-sitter-stack-graphs-typescript` cover the import patterns used in RollView before committing to this approach.
