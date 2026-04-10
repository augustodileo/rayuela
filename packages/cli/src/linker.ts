import type { GraphNode, GraphEdge } from "@rayuela/sdk";

/**
 * Fallback linker: attempts to resolve any remaining api.X.Y edges
 * that weren't resolved by the analyzer's API client parser.
 *
 * This is a best-effort heuristic and should rarely be needed — the
 * Expo Router analyzer parses the API client file directly for
 * deterministic resolution.
 */
export function linkApiCalls(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphEdge[] {
  const endpoints = nodes.filter((n) => n.type === "endpoint");
  if (endpoints.length === 0) return edges;

  return edges.map((edge) => {
    // Only process unresolved api.X.Y edges
    if (edge.type !== "calls" || !edge.to.startsWith("api.")) return edge;

    const match = edge.to.match(/^api\.(\w+)\.(\w+)$/);
    if (!match) return edge;

    const [, module] = match;

    // Simple fallback: find any endpoint with the module name in its path
    const target = endpoints.find((ep) => {
      const epPath = ep.id.split(" ", 2)[1];
      return epPath && epPath.includes(`/${module}`);
    });

    if (target) return { ...edge, to: target.id };
    return edge;
  });
}
