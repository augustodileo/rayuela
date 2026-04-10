import { AppGraph, validateSpec as validateSpecRust } from "rayuela-core";
import { detectPlugins } from "./plugins.js";
import { loadSpec } from "./spec-loader.js";
import { formatTestResults } from "./formatters/text.js";

export async function runTest(sourceDirs: string[], specPath: string): Promise<boolean> {
  const graph = new AppGraph();
  let totalEndpoints = 0;
  let totalScreens = 0;
  let totalEdges = 0;
  const detectedNames = new Set<string>();

  for (const sourceDir of sourceDirs) {
    const plugins = await detectPlugins(sourceDir);
    for (const plugin of plugins) {
      detectedNames.add(plugin.name);
      const result = await plugin.analyze(sourceDir);
      for (const node of result.nodes) {
        graph.addNode({
          nodeType: node.type,
          id: node.id,
          file: node.source.file,
          line: node.source.line,
          guards: node.guards,
          conditions: node.conditions,
        });
        if (node.type === "endpoint") totalEndpoints++;
        if (node.type === "screen") totalScreens++;
      }
      for (const edge of result.edges) {
        graph.addEdge({
          edgeType: edge.type,
          fromId: edge.from,
          toId: edge.to,
          file: edge.source.file,
          line: edge.source.line,
        });
        totalEdges++;
      }
    }
  }

  if (detectedNames.size === 0) {
    console.log("  No supported frameworks detected.");
    return false;
  }

  console.log(`  Detected: ${[...detectedNames].join(", ")}`);
  console.log(`  Discovered: ${totalEndpoints} endpoints, ${totalScreens} screens, ${totalEdges} edges`);
  console.log("");

  // Load spec and validate
  const specTests = await loadSpec(specPath);
  const results = validateSpecRust(graph, specTests);

  console.log(formatTestResults(results));

  return results.every((r) => r.passed);
}
