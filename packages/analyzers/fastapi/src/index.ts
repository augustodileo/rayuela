import { parseFile, queryTree } from "rayuela-core";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analyzer, AnalyzerContext, AnalysisResult, GraphNode, GraphEdge, AnalysisWarning } from "@rayuela/sdk";
import {
  ROUTE_DECORATOR_QUERY,
  DEPENDS_GUARD_QUERY,
  INCLUDE_ROUTER_WITH_PREFIX_QUERY,
  INCLUDE_ROUTER_NO_PREFIX_QUERY,
  APIROUTER_CONSTRUCTOR_QUERY,
} from "./queries.js";
import { classifyGuard, classifyGuardBySource } from "./guards.js";
import type { NameResolver } from "rayuela-core";

/** Maps a router variable in a file to its constructor prefix */
interface ConstructorPrefix {
  file: string;
  varName: string;
  prefix: string;
}

/** An include_router() call linking parent to child */
interface RouterInclusion {
  parentFile: string;
  parentVar: string;
  childVar: string;
  childVarLine: number;
  includePrefix: string;
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

  async analyze(sourceDir: string, context?: AnalyzerContext): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const warnings: AnalysisWarning[] = [];
    const typedResolver = context?.resolver as InstanceType<typeof NameResolver> | undefined;
    const lspClient = context?.lspClient;
    const traceStore = context?.traceStore as InstanceType<typeof import("rayuela-core").TraceStore> | undefined;

    const pyFiles = await glob("**/*.py", { cwd: sourceDir, absolute: true });

    // === Pass 1: Collect APIRouter constructor prefixes ===
    const constructorPrefixes: ConstructorPrefix[] = [];
    for (const file of pyFiles) {
      const tree = parseFile(file);
      const matches = queryTree(tree, APIROUTER_CONSTRUCTOR_QUERY);
      for (const m of matches) {
        const varName = m.captures["var_name"]?.text;
        const prefix = m.captures["prefix"]?.text;
        if (varName && prefix) {
          constructorPrefixes.push({ file, varName, prefix });
        }
      }
    }

    // === Pass 2: Collect include_router calls ===
    const inclusions: RouterInclusion[] = [];
    for (const file of pyFiles) {
      const tree = parseFile(file);

      // include_router(router_var, prefix="/...")
      const withPrefix = queryTree(tree, INCLUDE_ROUTER_WITH_PREFIX_QUERY);
      for (const m of withPrefix) {
        inclusions.push({
          parentFile: file,
          parentVar: m.captures["app_var"]?.text || "",
          childVar: m.captures["router_var"]?.text || "",
          childVarLine: m.startLine,
          includePrefix: m.captures["prefix"]?.text || "",
        });
      }

      // include_router(router_var) — no prefix
      const noPrefix = queryTree(tree, INCLUDE_ROUTER_NO_PREFIX_QUERY);
      for (const m of noPrefix) {
        const childVar = m.captures["router_var"]?.text || "";
        const alreadyCaptured = inclusions.some(
          (inc) => inc.parentFile === file && inc.childVar === childVar
        );
        if (!alreadyCaptured) {
          inclusions.push({
            parentFile: file,
            parentVar: m.captures["app_var"]?.text || "",
            childVar,
            childVarLine: m.startLine,
            includePrefix: "",
          });
        }
      }
    }

    // === Pass 3: Find route decorators and resolve full paths ===
    for (const file of pyFiles) {
      const tree = parseFile(file);
      const routes = queryTree(tree, ROUTE_DECORATOR_QUERY);

      for (const route of routes) {
        const method = route.captures["http_method"]?.text?.toUpperCase();
        // route_str includes quotes: '""' or '"/items"'. Strip them to get the path.
        const routeStr = route.captures["route_str"]?.text || '""';
        const routePath = routeStr.replace(/^["']|["']$/g, "");
        const handlerName = route.captures["handler_name"]?.text;
        const routerVar = route.captures["router_var"]?.text;

        if (!method || routePath === undefined || !handlerName) continue;

        // Resolve the full prefix chain for this file's router
        const fullPrefix = resolveFullPrefix(
          file,
          routerVar || "router",
          constructorPrefixes,
          inclusions,
          typedResolver,
        );
        const combinedPath = `${fullPrefix}${routePath === "/" ? "" : routePath}`;
        const fullPath = combinedPath || "/";

        // Find Depends() guards in this handler's parameters
        const guardMatches = queryTree(tree, DEPENDS_GUARD_QUERY);
        const guards = guardMatches
          .filter((g) => g.startLine >= route.startLine && g.endLine <= route.endLine)
          .map((g) => {
            const guardName = g.captures["guard_name"]?.text || "";
            if (typedResolver) {
              return classifyGuardBySource(guardName, file, g.startLine, typedResolver);
            }
            return classifyGuard(guardName);
          })
          .filter((g): g is string => g !== null);

        const nodeId = `${method} ${fullPath || "/"}`;
        nodes.push({
          type: "endpoint",
          id: nodeId,
          source: { file, line: route.startLine },
          guards,
          conditions: [],
          metadata: { handler: handlerName, router: routerVar },
        });

        // When LSP is available, build call hierarchy for the handler
        if (lspClient) {
          try {
            const { buildCallTree, flattenCallTree } = await import("@rayuela/lsp");
            const tree = await buildCallTree(lspClient as any, {
              file,
              line: route.startLine,
              col: route.captures?.["handler_name"]?.startCol ?? 10,
            }, 3);
            if (tree) {
              const calls = flattenCallTree(tree);
              for (const call of calls) {
                if (call.name !== tree.name && !call.file.includes("typeshed")) {
                  edges.push({
                    type: "calls",
                    from: nodeId,
                    to: `${call.name} (${call.file.split("/").pop()}:${call.line})`,
                    source: { file: call.file, line: call.line },
                    conditions: [],
                  });
                }
              }
            }
          } catch {
            // LSP call hierarchy not available for this handler
          }
        }

        // Build trace for this endpoint
        if (traceStore) {
          try {
            const { TraceKind } = await import("rayuela-core");
            const guardHashes: string[] = [];
            for (const guard of guards) {
              const gh = traceStore.insertLeaf(
                guard, file, route.startLine,
                TraceKind.Guard, [`guard:${guard}`],
              );
              guardHashes.push(gh);
            }
            const endpointHash = traceStore.insert(
              nodeId, file, route.startLine,
              TraceKind.Endpoint,
              guards.map((g: string) => `guard:${g}`),
              guardHashes,
            );
            traceStore.addRoot(endpointHash);
          } catch {
            // TraceStore not available
          }
        }
      }
    }

    return { nodes, edges, warnings };
  },
};

/**
 * Resolve the full prefix chain for a router variable in a file.
 * Uses Stack Graphs (when available) to resolve import bindings.
 * Falls back to constructor prefix matching when resolver is unavailable.
 */
function resolveFullPrefix(
  file: string,
  varName: string,
  constructorPrefixes: ConstructorPrefix[],
  inclusions: RouterInclusion[],
  resolver?: InstanceType<typeof NameResolver>,
  visited: Set<string> = new Set(),
): string {
  const key = `${file}:${varName}`;
  if (visited.has(key)) return "";
  visited.add(key);

  // Get this router's constructor prefix
  const ownPrefix = constructorPrefixes.find(
    (cp) => cp.file === file && cp.varName === varName,
  )?.prefix || "";

  // Find who includes this file's router
  for (const inc of inclusions) {
    let childResolvedFile: string | undefined;

    if (resolver) {
      // PRINCIPLED: Use Stack Graphs to resolve the child variable to its source file
      const def = resolver.findDefinition(inc.childVar, inc.parentFile, inc.childVarLine);
      childResolvedFile = def?.file;
    } else {
      // FALLBACK (no resolver): Match by variable name convention
      // e.g., "auth_router" or "auth" → file basename "auth.py"
      const varBaseName = inc.childVar.replace(/_router$/, "");
      const fileBaseName = path.basename(file, ".py");
      if (fileBaseName === varBaseName || inc.childVar === fileBaseName) {
        childResolvedFile = file;
      }
    }

    // Check if this inclusion points to our file
    if (childResolvedFile === file) {
      const parentPrefix = resolveFullPrefix(
        inc.parentFile,
        inc.parentVar,
        constructorPrefixes,
        inclusions,
        resolver,
        visited,
      );
      return parentPrefix + inc.includePrefix + ownPrefix;
    }
  }

  return ownPrefix;
}

export default fastapiAnalyzer;
