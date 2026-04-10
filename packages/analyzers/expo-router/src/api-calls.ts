import { parseFile, queryTree } from "rayuela-core";
import type { GraphEdge } from "@rayuela/sdk";

/** Tree-sitter query: api.module.method() calls (nested pattern) */
const API_CALL_NESTED_QUERY = `
(call_expression
  function: (member_expression
    object: (member_expression
      object: (identifier) @api_obj
      (#eq? @api_obj "api")
      property: (property_identifier) @module)
    property: (property_identifier) @method))
`;

/** Tree-sitter query: module.method() calls (flat pattern — auth.signup, rolls.list, etc.) */
const API_CALL_FLAT_QUERY = `
(call_expression
  function: (member_expression
    object: (identifier) @module
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

/** Tree-sitter query: useAuthStore() or useAuth() call (implies auth guard) */
const AUTH_STORE_QUERY = `
(call_expression
  function: (identifier) @hook
  (#match? @hook "^use.*[Aa]uth"))
`;

/** Known API module names to filter flat calls (avoids matching router.push, etc.) */
const DEFAULT_API_MODULES = new Set(["api", "auth", "users", "rolls", "sessions", "items"]);

export function detectApiCalls(
  file: string,
  screenName: string,
  apiModules?: Set<string>,
): GraphEdge[] {
  const tree = parseFile(file);
  const knownModules = apiModules || DEFAULT_API_MODULES;
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  // Nested: api.module.method() — key uses module.method (matching parser output)
  for (const m of queryTree(tree, API_CALL_NESTED_QUERY)) {
    const key = `${m.captures["module"]?.text}.${m.captures["method"]?.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({
        type: "calls", from: screenName, to: key,
        source: { file, line: m.startLine }, conditions: [],
      });
    }
  }

  // Flat: module.method() where module is a known API namespace
  for (const m of queryTree(tree, API_CALL_FLAT_QUERY)) {
    const module = m.captures["module"]?.text;
    const method = m.captures["method"]?.text;
    if (module && method && knownModules.has(module)) {
      const key = `${module}.${method}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          type: "calls", from: screenName, to: key,
          source: { file, line: m.startLine }, conditions: [],
        });
      }
    }
  }

  return edges;
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
