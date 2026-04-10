import { parseFile, queryTree } from "rayuela-core";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Analyzer, AnalysisResult, GraphNode, GraphEdge, AnalysisWarning } from "@rayuela/sdk";
import {
  ROUTE_DECORATOR_QUERY,
  DEPENDS_GUARD_QUERY,
  INCLUDE_ROUTER_WITH_PREFIX_QUERY,
  INCLUDE_ROUTER_NO_PREFIX_QUERY,
  APIROUTER_CONSTRUCTOR_QUERY,
  IMPORT_FROM_QUERY,
  IMPORT_FROM_ALIASED_QUERY,
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
  includePrefix: string; // explicit prefix from include_router(..., prefix=...)
}

/** An import mapping: localVar in file → resolvedFile */
interface ImportMapping {
  file: string;
  localVar: string;
  resolvedFile: string;
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

  async analyze(sourceDir: string, resolver?: unknown): Promise<AnalysisResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const warnings: AnalysisWarning[] = [];

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

    // === Pass 2: Collect import mappings ===
    const importMappings: ImportMapping[] = [];
    for (const file of pyFiles) {
      const tree = parseFile(file);

      // from app.api.auth import router
      const directImports = queryTree(tree, IMPORT_FROM_QUERY);
      for (const m of directImports) {
        const modulePath = m.captures["module"]?.text;
        const importName = m.captures["import_name"]?.text;
        if (modulePath && importName) {
          const resolvedFile = resolveModulePath(modulePath, sourceDir, pyFiles);
          if (resolvedFile) {
            importMappings.push({ file, localVar: importName, resolvedFile });
          }
        }
      }

      // from app.api.auth import router as auth_router
      const aliasedImports = queryTree(tree, IMPORT_FROM_ALIASED_QUERY);
      for (const m of aliasedImports) {
        const modulePath = m.captures["module"]?.text;
        const alias = m.captures["alias"]?.text;
        if (modulePath && alias) {
          const resolvedFile = resolveModulePath(modulePath, sourceDir, pyFiles);
          if (resolvedFile) {
            importMappings.push({ file, localVar: alias, resolvedFile });
          }
        }
      }
    }

    // === Pass 3: Collect include_router calls ===
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
          includePrefix: m.captures["prefix"]?.text || "",
        });
      }

      // include_router(router_var) — no prefix
      const noPrefix = queryTree(tree, INCLUDE_ROUTER_NO_PREFIX_QUERY);
      for (const m of noPrefix) {
        const childVar = m.captures["router_var"]?.text || "";
        // Skip if already captured with prefix (the no-prefix query also matches with-prefix calls)
        const alreadyCaptured = inclusions.some(
          (inc) => inc.parentFile === file && inc.childVar === childVar
        );
        if (!alreadyCaptured) {
          inclusions.push({
            parentFile: file,
            parentVar: m.captures["app_var"]?.text || "",
            childVar,
            includePrefix: "",
          });
        }
      }
    }

    // === Pass 4: Find route decorators and resolve full paths ===
    for (const file of pyFiles) {
      const tree = parseFile(file);
      const routes = queryTree(tree, ROUTE_DECORATOR_QUERY);

      for (const route of routes) {
        const method = route.captures["http_method"]?.text?.toUpperCase();
        const routePath = route.captures["route_path"]?.text;
        const handlerName = route.captures["handler_name"]?.text;
        const routerVar = route.captures["router_var"]?.text;

        if (!method || !routePath || !handlerName) continue;

        // Resolve the full prefix chain for this file's router
        const fullPrefix = resolveFullPrefix(
          file,
          routerVar || "router",
          constructorPrefixes,
          inclusions,
          importMappings,
        );
        const fullPath = `${fullPrefix}${routePath === "/" ? "" : routePath}`;

        // Find Depends() guards in this handler's parameters
        const guardMatches = queryTree(tree, DEPENDS_GUARD_QUERY);
        const guards = guardMatches
          .filter((g) => g.startLine >= route.startLine && g.endLine <= route.endLine)
          .map((g) => {
            const guardName = g.captures["guard_name"]?.text || "";
            // Use source-based classification when resolver is available
            if (resolver) {
              return classifyGuardBySource(
                guardName, file, g.startLine,
                resolver as InstanceType<typeof NameResolver>,
              );
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
      }
    }

    return { nodes, edges, warnings };
  },
};

/**
 * Resolve the full prefix chain for a router variable in a file.
 * Walks up the inclusion graph: child constructor prefix → include prefix → parent prefix → ...
 */
function resolveFullPrefix(
  file: string,
  varName: string,
  constructorPrefixes: ConstructorPrefix[],
  inclusions: RouterInclusion[],
  importMappings: ImportMapping[],
  visited: Set<string> = new Set(),
): string {
  const key = `${file}:${varName}`;
  if (visited.has(key)) return ""; // cycle detection
  visited.add(key);

  // Get this router's constructor prefix (if any)
  const ownPrefix = constructorPrefixes.find(
    (cp) => cp.file === file && cp.varName === varName,
  )?.prefix || "";

  // Find who includes this file's router
  // First, find all inclusions where the child var resolves to this file
  for (const inc of inclusions) {
    // Resolve the child var to a file via imports
    const childResolvedFile = resolveVarToFile(
      inc.parentFile,
      inc.childVar,
      importMappings,
    );

    if (childResolvedFile === file) {
      // Found: this file's router is included by inc.parentFile:inc.parentVar
      const parentPrefix = resolveFullPrefix(
        inc.parentFile,
        inc.parentVar,
        constructorPrefixes,
        inclusions,
        importMappings,
        visited,
      );
      return parentPrefix + inc.includePrefix + ownPrefix;
    }
  }

  // No parent found — this is a root router (e.g., on the app object)
  return ownPrefix;
}

/**
 * Resolve a variable name in a file to the source file it was imported from.
 */
function resolveVarToFile(
  file: string,
  varName: string,
  importMappings: ImportMapping[],
): string | undefined {
  const mapping = importMappings.find(
    (im) => im.file === file && im.localVar === varName,
  );
  return mapping?.resolvedFile;
}

/**
 * Convert a dotted Python module path to an absolute file path.
 * e.g., "app.api.auth" → "/source/app/api/auth.py" or "/source/app/api/auth/__init__.py"
 */
function resolveModulePath(
  modulePath: string,
  sourceDir: string,
  allFiles: string[],
): string | undefined {
  const relPath = modulePath.replace(/\./g, "/");

  // Try direct .py file first
  const pyFile = path.join(sourceDir, relPath + ".py");
  if (allFiles.includes(pyFile)) return pyFile;

  // Try __init__.py (package)
  const initFile = path.join(sourceDir, relPath, "__init__.py");
  if (allFiles.includes(initFile)) return initFile;

  // Try matching with partial paths (handle cases where sourceDir nesting differs)
  for (const f of allFiles) {
    if (f.endsWith(relPath + ".py") || f.endsWith(relPath + "/__init__.py")) {
      return f;
    }
  }

  return undefined;
}

export default fastapiAnalyzer;
