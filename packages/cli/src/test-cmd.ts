import { AppGraph, TraceStore, validateSpec as validateSpecRust } from "rayuela-core";
import { getClient, shutdownAll } from "@rayuela/lsp";
import { detectPlugins } from "./plugins.js";
import { loadSpec } from "./spec-loader.js";
import { formatTestResults } from "./formatters/text.js";
import { linkApiCalls } from "./linker.js";
import { ensureDependencies } from "./deps.js";
import type { GraphNode, GraphEdge, AnalyzerContext } from "@rayuela/sdk";

export async function runTest(sourceDirs: string[], specPath: string): Promise<boolean> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();
  const traceStore = new TraceStore();

  try {
    for (const sourceDir of sourceDirs) {
      const context: AnalyzerContext = { traceStore };

      const plugins = await detectPlugins(sourceDir);
      if (plugins.length === 0) continue;

      try {
        const deps = await ensureDependencies(sourceDir);
        const lang = plugins.some((p) => p.name === "fastapi") ? "python" : "typescript";
        const lsp = await getClient(lang as "python" | "typescript", sourceDir, {
          venvPath: deps.venvPath,
          nodeModulesPath: deps.nodeModulesPath,
        });
        if (lsp) context.lspClient = lsp;
      } catch {}

      for (const plugin of plugins) {
        detectedNames.add(plugin.name);
        const result = await plugin.analyze(sourceDir, context);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
      }
    }

    if (detectedNames.size === 0) {
      console.log("  No supported frameworks detected.");
      return false;
    }

    const linkedEdges = linkApiCalls(allNodes, allEdges);
    const graph = new AppGraph();
    for (const node of allNodes) {
      graph.addNode({
        nodeType: node.type, id: node.id,
        file: node.source.file, line: node.source.line,
        guards: node.guards, conditions: node.conditions,
      });
    }
    for (const edge of linkedEdges) {
      graph.addEdge({
        edgeType: edge.type, fromId: edge.from, toId: edge.to,
        file: edge.source.file, line: edge.source.line,
      });
    }

    const totalEndpoints = allNodes.filter((n) => n.type === "endpoint").length;
    const totalScreens = allNodes.filter((n) => n.type === "screen").length;
    console.log(`  Detected: ${[...detectedNames].join(", ")}`);
    console.log(`  Discovered: ${totalEndpoints} endpoints, ${totalScreens} screens, ${linkedEdges.length} edges`);
    console.log("");

    const specTests = await loadSpec(specPath);
    const results = validateSpecRust(graph, specTests);
    console.log(formatTestResults(results));
    return results.every((r) => r.passed);
  } finally {
    await shutdownAll();
  }
}
