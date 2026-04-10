import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { Analyzer, AnalysisResult, GraphNode, GraphEdge } from "@rayuela/sdk";
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

  async analyze(sourceDir: string, _resolver?: unknown): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Parse API client to get deterministic endpoint mapping
    const apiMapping = await findAndParseApiClient(sourceDir);

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

      // Detect API calls and resolve via parsed client mapping
      const apiCalls = detectApiCalls(screen.file, screen.name);
      for (const call of apiCalls) {
        const resolvedEndpoint = apiMapping.get(call.to);
        if (resolvedEndpoint) {
          edges.push({ ...call, to: resolvedEndpoint });
        } else {
          edges.push(call); // Keep unresolved edge as-is
        }
      }

      // Detect navigation to other screens
      const navigations = detectNavigations(screen.file, screen.name);
      for (const nav of navigations) {
        const targetScreen = screens.find(
          (s) =>
            s.route === nav.to ||
            nav.to.startsWith(s.route.replace(/:[\w]+/g, ""))
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
 * Find and parse the API client file in the project.
 * Looks for common patterns: lib/api.ts, src/api.ts, api/index.ts, etc.
 */
async function findAndParseApiClient(sourceDir: string): Promise<Map<string, string>> {
  const candidates = [
    "lib/api.ts", "lib/api.tsx",
    "src/api.ts", "src/api.tsx",
    "src/lib/api.ts",
    "api/index.ts",
    "services/api.ts",
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(sourceDir, candidate);
    try {
      const endpoints = parseApiClient(fullPath);
      if (endpoints.length > 0) {
        return buildApiMapping(endpoints);
      }
    } catch {
      // File doesn't exist or parse failed — try next
    }
  }

  // Fallback: search for files exporting an `api` object
  const apiFiles = await glob("**/api.{ts,tsx,js}", {
    cwd: sourceDir,
    absolute: true,
    ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"],
  });

  for (const file of apiFiles) {
    try {
      const endpoints = parseApiClient(file);
      if (endpoints.length > 0) {
        return buildApiMapping(endpoints);
      }
    } catch {
      // Parse failed — try next
    }
  }

  return new Map();
}

export default expoRouterAnalyzer;
