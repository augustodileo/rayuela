import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { Analyzer, AnalyzerContext, AnalysisResult, GraphNode, GraphEdge } from "@rayuela/sdk";
import { discoverScreens } from "./screens.js";
import { detectApiCalls, detectNavigations, detectAuthGuard } from "./api-calls.js";
import { parseApiClient, buildApiMapping } from "./api-client-parser.js";

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

  async analyze(sourceDir: string, context?: AnalyzerContext): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lspClient = context?.lspClient;

    // Try LSP-first for API call resolution, fall back to tree-sitter parsing
    const apiMapping = lspClient
      ? await resolveApiMappingViaLsp(sourceDir, lspClient)
      : await resolveApiMappingViaParsing(sourceDir);

    const apiModules = new Set<string>(["api"]);
    for (const key of apiMapping.keys()) {
      apiModules.add(key.split(".")[0]);
    }

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

      // When LSP is available, use call hierarchy to find ALL calls from this screen
      // (including through hooks like useRolls → rolls.list)
      if (lspClient) {
        try {
          const lspEdges = await resolveScreenCallsViaLsp(
            screen.file, screen.name, lspClient, apiMapping,
          );
          edges.push(...lspEdges);
        } catch {
          // LSP failed — fall back to tree-sitter
          addTreeSitterEdges(screen, edges, apiMapping, apiModules);
        }
      } else {
        addTreeSitterEdges(screen, edges, apiMapping, apiModules);
      }

      // Navigation edges (always tree-sitter — these are syntactic)
      const navigations = detectNavigations(screen.file, screen.name);
      for (const nav of navigations) {
        const targetScreen = screens.find(
          (s) => s.route === nav.to || nav.to.startsWith(s.route.replace(/:[\w]+/g, ""))
        );
        if (targetScreen) {
          edges.push({ ...nav, to: targetScreen.name });
        }
      }
    }

    return { nodes, edges, warnings: [] };
  },
};

/**
 * LSP-first: Use call hierarchy on the screen's default export function
 * to find ALL outgoing calls (including through hooks).
 * Then match each call against the API mapping.
 */
async function resolveScreenCallsViaLsp(
  screenFile: string,
  screenName: string,
  lspClient: unknown,
  apiMapping: Map<string, string>,
): Promise<GraphEdge[]> {
  const { buildCallTree, flattenCallTree } = await import("@rayuela/lsp");
  const client = lspClient as Awaited<ReturnType<typeof import("@rayuela/lsp").getClient>>;
  if (!client) return [];

  // Build call tree from the screen's default export (line 1 is usually imports,
  // the actual component is further down — use a broad search)
  // Open the file first
  await client.openFile(screenFile, "typescript");

  // Try to get call hierarchy from the default export function
  // The exported component is typically the last function in the file
  const { parseFile, queryTree } = await import("rayuela-core");
  const tree = parseFile(screenFile);

  // Find the default export function position
  const exportMatches = queryTree(tree, `
    (export_statement
      (function_declaration
        name: (identifier) @fn_name))
  `);
  const defaultExport = queryTree(tree, `
    (export_default_declaration
      (function_declaration
        name: (identifier) @fn_name))
  `);
  const fnMatch = defaultExport[0] || exportMatches[0];
  if (!fnMatch) return [];

  const fnLine = fnMatch.startLine;
  const fnCol = fnMatch.captures["fn_name"]?.startCol ?? 0;

  const callTree = await buildCallTree(client, {
    file: screenFile,
    line: fnLine,
    col: fnCol,
  }, 4);

  if (!callTree) return [];

  const allCalls = flattenCallTree(callTree);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const call of allCalls) {
    if (call.name === callTree.name) continue; // Skip self
    if (call.file.includes("node_modules")) continue; // Skip library internals

    // Check if this call matches any API function
    for (const [key, endpointId] of apiMapping) {
      const methodName = key.split(".").pop();
      if (call.name === methodName && !seen.has(endpointId)) {
        seen.add(endpointId);
        edges.push({
          type: "calls",
          from: screenName,
          to: endpointId,
          source: { file: call.file, line: call.line },
          conditions: [],
        });
      }
    }
  }

  return edges;
}

/**
 * Fallback: tree-sitter based API call detection + client parsing.
 */
function addTreeSitterEdges(
  screen: { file: string; name: string },
  edges: GraphEdge[],
  apiMapping: Map<string, string>,
  apiModules: Set<string>,
) {
  const apiCalls = detectApiCalls(screen.file, screen.name, apiModules);
  for (const call of apiCalls) {
    const resolved = apiMapping.get(call.to);
    edges.push(resolved ? { ...call, to: resolved } : call);
  }
}

/**
 * LSP-first API mapping: Use LSP definition resolution on API imports.
 * Falls back to tree-sitter parsing if LSP can't resolve.
 */
async function resolveApiMappingViaLsp(
  sourceDir: string,
  _lspClient: unknown,
): Promise<Map<string, string>> {
  // For now, use tree-sitter parsing as the base.
  // LSP enhancement: when we find an unresolved call, use LSP definition
  // to follow it to the API client and extract the URL.
  // This hybrid approach gets the best of both worlds.
  return resolveApiMappingViaParsing(sourceDir);
}

/**
 * Tree-sitter based API client parsing (fallback).
 */
async function resolveApiMappingViaParsing(sourceDir: string): Promise<Map<string, string>> {
  const candidates = [
    "lib/api.ts", "lib/api.tsx", "src/api.ts", "src/api.tsx",
    "src/lib/api.ts", "api/index.ts", "services/api.ts",
  ];

  for (const candidate of candidates) {
    try {
      const endpoints = parseApiClient(path.join(sourceDir, candidate));
      if (endpoints.length > 0) return buildApiMapping(endpoints);
    } catch { /* next */ }
  }

  const apiFiles = await glob("**/api.{ts,tsx,js}", {
    cwd: sourceDir, absolute: true,
    ignore: ["**/node_modules/**", "**/*.test.*"],
  });

  for (const file of apiFiles) {
    try {
      const endpoints = parseApiClient(file);
      if (endpoints.length > 0) return buildApiMapping(endpoints);
    } catch { /* next */ }
  }

  return new Map();
}

export default expoRouterAnalyzer;
