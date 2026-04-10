import { NameResolver } from "rayuela-core";
import { getClient, detectLanguage, shutdownAll } from "@rayuela/lsp";
import { detectPlugins } from "./plugins.js";
import { formatDiscovery } from "./formatters/text.js";
import { linkApiCalls } from "./linker.js";
import type { GraphNode, GraphEdge, AnalyzerContext } from "@rayuela/sdk";

export async function runDiscover(sourceDirs: string[], useLsp = true): Promise<void> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();

  try {
    for (const sourceDir of sourceDirs) {
      // Build context: Stack Graphs resolver + optional LSP client
      const context: AnalyzerContext = {};

      try {
        context.resolver = NameResolver.build(sourceDir);
      } catch (e) {
        console.log(`  WARN  Failed to build name resolver for ${sourceDir}`);
      }

      if (useLsp) {
        // Detect primary language for this source dir
        const plugins = await detectPlugins(sourceDir);
        const lang = plugins.some((p) => p.name === "fastapi") ? "python" : "typescript";
        try {
          const lsp = await getClient(lang as "python" | "typescript", sourceDir);
          if (lsp) context.lspClient = lsp;
        } catch {
          // LSP not available — continue without it
        }
      }

      const plugins = await detectPlugins(sourceDir);
      for (const plugin of plugins) {
        detectedNames.add(plugin.name);
        const result = await plugin.analyze(sourceDir, context);
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

    // Link frontend API calls to backend endpoints (fallback for unresolved edges)
    const linkedEdges = linkApiCalls(allNodes, allEdges);

    console.log(formatDiscovery(allNodes, [...detectedNames]));

    const endpointCount = allNodes.filter((n) => n.type === "endpoint").length;
    const screenCount = allNodes.filter((n) => n.type === "screen").length;
    const linkedCount = linkedEdges.filter((e) => !e.to.startsWith("api.")).length;
    const totalEdgeCount = linkedEdges.length;
    console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${totalEdgeCount} edges (${linkedCount} linked)`);
  } finally {
    await shutdownAll();
  }
}
