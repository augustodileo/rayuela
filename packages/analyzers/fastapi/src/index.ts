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
