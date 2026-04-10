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

    // Parse API client for endpoint mapping
    const apiMapping = await resolveApiMappingViaParsing(sourceDir);
    const apiModules = new Set<string>(["api"]);
    for (const key of apiMapping.keys()) apiModules.add(key.split(".")[0]);

    // If LSP available, open all TS files for warm-up
    if (lspClient) {
      const tsFiles = await glob("**/*.{ts,tsx}", {
        cwd: sourceDir, absolute: true,
        ignore: ["**/node_modules/**", "**/*.test.*"],
      });
      for (const f of tsFiles) {
        await (lspClient as any).openFile(f, "typescript");
      }
      await new Promise(r => setTimeout(r, 3000));
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

      // When LSP available, use definition-based tracing to follow hooks → API calls
      if (lspClient) {
        try {
          const lspEdges = await traceScreenCallsViaLsp(
            screen.file, screen.name, lspClient, apiMapping, sourceDir,
          );
          if (lspEdges.length > 0) {
            edges.push(...lspEdges);
            continue; // Skip tree-sitter fallback
          }
        } catch {
          // Fall through to tree-sitter
        }
      }

      // Fallback: tree-sitter based detection
      const apiCalls = detectApiCalls(screen.file, screen.name, apiModules);
      for (const call of apiCalls) {
        const resolved = apiMapping.get(call.to);
        edges.push(resolved ? { ...call, to: resolved } : call);
      }

      // Navigation edges
      const navigations = detectNavigations(screen.file, screen.name);
      for (const nav of navigations) {
        const target = screens.find(
          (s) => s.route === nav.to || nav.to.startsWith(s.route.replace(/:[\w]+/g, ""))
        );
        if (target) edges.push({ ...nav, to: target.name });
      }
    }

    return { nodes, edges, warnings: [] };
  },
};

/**
 * LSP-based: use buildCallTreeViaDefinitions to follow hooks → API calls.
 */
async function traceScreenCallsViaLsp(
  screenFile: string,
  screenName: string,
  lspClient: unknown,
  apiMapping: Map<string, string>,
  sourceDir: string,
): Promise<GraphEdge[]> {
  const { buildCallTreeViaDefinitions, flattenCallTree } = await import("@rayuela/lsp");
  const { parseFile, queryTree } = await import("rayuela-core");
  const absSourceDir = path.resolve(sourceDir);

  const tree = parseFile(screenFile);

  // Find the default export function
  const defaultExport = queryTree(tree, `
    (export_default_declaration
      (function_declaration
        name: (identifier) @fn_name))
  `);
  const fnMatch = defaultExport[0];
  if (!fnMatch) return [];

  const fnLine = fnMatch.captures["fn_name"]?.startLine;
  if (!fnLine) return [];

  // Build call tree via definition resolution
  const callTree = await buildCallTreeViaDefinitions(
    lspClient as any,
    { file: screenFile, line: fnLine, col: fnMatch.captures["fn_name"]?.startCol ?? 0 },
    absSourceDir,
    4,
  );
  if (!callTree) return [];

  const allCalls = flattenCallTree(callTree);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const call of allCalls) {
    if (call.name === callTree.name) continue;

    // Match against API mapping
    for (const [key, endpointId] of apiMapping) {
      const methodName = key.split(".").pop();
      if (call.name === methodName && !seen.has(endpointId)) {
        seen.add(endpointId);
        edges.push({
          type: "calls", from: screenName, to: endpointId,
          source: { file: call.file, line: call.line }, conditions: [],
        });
      }
    }
  }

  return edges;
}

async function resolveApiMappingViaParsing(sourceDir: string): Promise<Map<string, string>> {
  const candidates = [
    "lib/api.ts", "lib/api.tsx", "src/api.ts", "services/api.ts",
  ];
  for (const c of candidates) {
    try {
      const eps = parseApiClient(path.join(sourceDir, c));
      if (eps.length > 0) return buildApiMapping(eps);
    } catch { /* next */ }
  }

  const files = await glob("**/api.{ts,tsx,js}", {
    cwd: sourceDir, absolute: true,
    ignore: ["**/node_modules/**", "**/*.test.*"],
  });
  for (const f of files) {
    try {
      const eps = parseApiClient(f);
      if (eps.length > 0) return buildApiMapping(eps);
    } catch { /* next */ }
  }
  return new Map();
}

export default expoRouterAnalyzer;
