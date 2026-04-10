import { detectPlugins } from "./plugins.js";
import { formatDiscovery } from "./formatters/text.js";
import { linkApiCalls } from "./linker.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

export async function runDiscover(sourceDirs: string[]): Promise<void> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();

  for (const sourceDir of sourceDirs) {
    const plugins = await detectPlugins(sourceDir);
    for (const plugin of plugins) {
      detectedNames.add(plugin.name);
      const result = await plugin.analyze(sourceDir);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);

      for (const warning of result.warnings) {
        console.log(`  WARN  ${warning.message} (${warning.source.file}:${warning.source.line})`);
      }
    }
  }

  if (detectedNames.size === 0) {
    console.log("  No supported frameworks detected.");
    return;
  }

  // Link frontend API calls to backend endpoints
  const linkedEdges = linkApiCalls(allNodes, allEdges);

  console.log(formatDiscovery(allNodes, [...detectedNames]));

  const endpointCount = allNodes.filter((n) => n.type === "endpoint").length;
  const screenCount = allNodes.filter((n) => n.type === "screen").length;
  const linkedCount = linkedEdges.filter((e) => !e.to.startsWith("api.")).length;
  const totalEdgeCount = linkedEdges.length;
  console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${totalEdgeCount} edges (${linkedCount} linked)`);
}
