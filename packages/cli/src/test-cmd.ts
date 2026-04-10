import { AppGraph, validateSpec as validateSpecRust } from "rayuela-core";
import { detectPlugins } from "./plugins.js";
import { loadSpec } from "./spec-loader.js";
import { formatTestResults } from "./formatters/text.js";
import { linkApiCalls } from "./linker.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

export async function runTest(sourceDirs: string[], specPath: string): Promise<boolean> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();

  // Collect all nodes and edges from all source dirs
  for (const sourceDir of sourceDirs) {
    const plugins = await detectPlugins(sourceDir);
    for (const plugin of plugins) {
      detectedNames.add(plugin.name);
      const result = await plugin.analyze(sourceDir);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
    }
  }

  if (detectedNames.size === 0) {
    console.log("  No supported frameworks detected.");
    return false;
  }

  // Link frontend API calls to backend endpoints
  const linkedEdges = linkApiCalls(allNodes, allEdges);

  // Build graph
  const graph = new AppGraph();
  for (const node of allNodes) {
    graph.addNode({
      nodeType: node.type,
      id: node.id,
      file: node.source.file,
      line: node.source.line,
      guards: node.guards,
      conditions: node.conditions,
    });
  }
  for (const edge of linkedEdges) {
    graph.addEdge({
      edgeType: edge.type,
      fromId: edge.from,
      toId: edge.to,
      file: edge.source.file,
      line: edge.source.line,
    });
  }

  const totalEndpoints = allNodes.filter((n) => n.type === "endpoint").length;
  const totalScreens = allNodes.filter((n) => n.type === "screen").length;
  console.log(`  Detected: ${[...detectedNames].join(", ")}`);
  console.log(`  Discovered: ${totalEndpoints} endpoints, ${totalScreens} screens, ${linkedEdges.length} edges`);
  console.log("");

  // Load spec and validate
  const specTests = await loadSpec(specPath);
  const results = validateSpecRust(graph, specTests);

  console.log(formatTestResults(results));

  return results.every((r) => r.passed);
}
