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

/** Tree-sitter query: useAuthStore() or useAuth() call (implies auth guard) */
const AUTH_STORE_QUERY = `
(call_expression
  function: (identifier) @hook
  (#match? @hook "^use.*[Aa]uth"))
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
