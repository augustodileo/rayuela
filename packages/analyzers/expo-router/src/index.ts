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

  async analyze(sourceDir: string, _resolver?: unknown): Promise<AnalysisResult> {
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
