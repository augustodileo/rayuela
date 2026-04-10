import type { GraphNode, GraphEdge } from "@rayuela/sdk";

/**
 * Fallback linker: attempts to resolve any remaining unresolved API call edges
 * that weren't resolved by the analyzer's API client parser.
 */
export function linkApiCalls(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphEdge[] {
  const endpoints = nodes.filter((n) => n.type === "endpoint");
  if (endpoints.length === 0) return edges;

  return edges.map((edge) => {
    if (edge.type !== "calls") return edge;
    // Skip already-resolved edges (those that look like "METHOD /path")
    if (edge.to.includes(" /")) return edge;

    // Parse module.method pattern (e.g., "items.list", "auth.signup")
    const match = edge.to.match(/^(\w+)\.(\w+)$/);
    if (!match) return edge;

    const [, module] = match;

    // Find any endpoint with the module name in its path
    const target = endpoints.find((ep) => {
      const epPath = ep.id.split(" ", 2)[1];
      return epPath && epPath.includes(`/${module}`);
    });

    if (target) return { ...edge, to: target.id };
    return edge;
  });
}
