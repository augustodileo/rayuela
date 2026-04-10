import { detectPlugins } from "./plugins.js";
import { formatDiscovery } from "./formatters/text.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

export async function runDiscover(sourceDir: string): Promise<void> {
  const plugins = await detectPlugins(sourceDir);

  if (plugins.length === 0) {
    console.log("  No supported frameworks detected.");
    return;
  }

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  for (const plugin of plugins) {
    const result = await plugin.analyze(sourceDir);
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    for (const warning of result.warnings) {
      console.log(`  WARN  ${warning.message} (${warning.source.file}:${warning.source.line})`);
    }
  }

  console.log(
    formatDiscovery(
      allNodes,
      plugins.map((p) => p.name)
    )
  );

  const endpointCount = allNodes.filter((n) => n.type === "endpoint").length;
  const screenCount = allNodes.filter((n) => n.type === "screen").length;
  console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${allEdges.length} edges`);
}
