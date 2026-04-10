import type { GraphNode, GraphEdge } from "@rayuela/sdk";

/** Convention-based mapping from API client method names to HTTP methods */
const METHOD_TO_HTTP: Record<string, string> = {
  list: "GET", get: "GET", fetch: "GET", read: "GET", find: "GET",
  create: "POST", add: "POST", signup: "POST", login: "POST", upload: "POST",
  update: "PUT", edit: "PUT",
  patch: "PATCH",
  delete: "DELETE", remove: "DELETE", destroy: "DELETE",
};

/**
 * Resolve frontend API call edges (api.module.method) to backend endpoint IDs.
 *
 * Example: api.items.list → GET /api/v1/items
 *
 * Matching strategy:
 * 1. Parse method name → HTTP method (list→GET, create→POST, etc.)
 * 2. Match module name to endpoint path segment
 * 3. Disambiguate: "list" → collection endpoint, "get" → parameterized endpoint
 */
export function linkApiCalls(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphEdge[] {
  const endpoints = nodes.filter((n) => n.type === "endpoint");
  if (endpoints.length === 0) return edges;

  return edges.map((edge) => {
    if (edge.type !== "calls") return edge;

    const match = edge.to.match(/^api\.(\w+)\.(\w+)$/);
    if (!match) return edge;

    const [, module, method] = match;
    const httpMethod = METHOD_TO_HTTP[method];
    if (!httpMethod) return edge;

    // Find endpoints matching HTTP method + module path segment
    const candidates = endpoints.filter((ep) => {
      const [epMethod, epPath] = ep.id.split(" ", 2);
      return epMethod === httpMethod && epPath && epPath.includes(`/${module}`);
    });

    if (candidates.length === 0) return edge;
    if (candidates.length === 1) return { ...edge, to: candidates[0].id };

    // Disambiguate multiple candidates:
    // 1. Try exact method name match in path (e.g., "login" → /auth/login)
    const exactMatch = candidates.find((ep) => {
      const epPath = ep.id.split(" ", 2)[1];
      return epPath.includes(`/${method}`);
    });
    if (exactMatch) return { ...edge, to: exactMatch.id };

    // 2. "list" prefers collection (no path params after module),
    //    "get" prefers item (has path params after module)
    const isCollection = method === "list" || method === "fetch";
    const target = candidates.find((ep) => {
      const epPath = ep.id.split(" ", 2)[1];
      const afterModule = epPath.split(`/${module}`)[1] || "";
      const hasParams = afterModule.includes("{");
      return isCollection ? !hasParams : hasParams;
    }) || candidates[0];

    return { ...edge, to: target.id };
  });
}
