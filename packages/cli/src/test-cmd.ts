import { AppGraph, validateSpec as validateSpecRust } from "rayuela-core";
import { shutdownAll } from "@rayuela/lsp";
import { loadSpec } from "./spec-loader.js";
import { formatTestResults } from "./formatters/text.js";
import { scanProject } from "./scan.js";

export async function runTest(sourceDirs: string[], specPath: string): Promise<boolean> {
  try {
    const { nodes, edges, detectedFrameworks } = await scanProject(sourceDirs);

    if (detectedFrameworks.length === 0) {
      console.log("  No supported frameworks detected.");
      return false;
    }

    // Build graph for spec validation
    const graph = new AppGraph();
    for (const node of nodes) {
      graph.addNode({
        nodeType: node.type, id: node.id,
        file: node.source.file, line: node.source.line,
        guards: node.guards, conditions: node.conditions,
      });
    }
    for (const edge of edges) {
      graph.addEdge({
        edgeType: edge.type, fromId: edge.from, toId: edge.to,
        file: edge.source.file, line: edge.source.line,
      });
    }

    const totalEndpoints = nodes.filter((n) => n.type === "endpoint").length;
    const totalScreens = nodes.filter((n) => n.type === "screen").length;
    console.log(`  Detected: ${detectedFrameworks.join(", ")}`);
    console.log(`  Discovered: ${totalEndpoints} endpoints, ${totalScreens} screens, ${edges.length} edges`);
    console.log("");

    const specTests = await loadSpec(specPath);
    const results = validateSpecRust(graph, specTests);
    console.log(formatTestResults(results));
    return results.every((r) => r.passed);
  } finally {
    await shutdownAll();
  }
}
