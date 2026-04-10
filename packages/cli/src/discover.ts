import { NameResolver, TraceStore, TraceKind } from "rayuela-core";
import { getClient, shutdownAll } from "@rayuela/lsp";
import { detectPlugins } from "./plugins.js";
import { formatDiscovery } from "./formatters/text.js";
import { linkApiCalls } from "./linker.js";
import { ensureDependencies } from "./deps.js";
import type { GraphNode, GraphEdge, AnalyzerContext } from "@rayuela/sdk";

export async function runDiscover(sourceDirs: string[], useLsp = true): Promise<void> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();
  const traceStore = new TraceStore();

  try {
    for (const sourceDir of sourceDirs) {
      const context: AnalyzerContext = { traceStore };

      // Stack Graphs resolver
      try {
        context.resolver = NameResolver.build(sourceDir);
      } catch {
        // Stack Graphs not available for this dir
      }

      if (useLsp) {
        // Auto-install dependencies for LSP
        const deps = await ensureDependencies(sourceDir);

        const plugins = await detectPlugins(sourceDir);
        const lang = plugins.some((p) => p.name === "fastapi") ? "python" : "typescript";
        try {
          const lsp = await getClient(lang as "python" | "typescript", sourceDir, {
            venvPath: deps.venvPath,
            nodeModulesPath: deps.nodeModulesPath,
          });
          if (lsp) context.lspClient = lsp;
        } catch {
          // LSP not available
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

    const linkedEdges = linkApiCalls(allNodes, allEdges);

    console.log(formatDiscovery(allNodes, [...detectedNames]));

    const endpointCount = allNodes.filter((n) => n.type === "endpoint").length;
    const screenCount = allNodes.filter((n) => n.type === "screen").length;
    const linkedCount = linkedEdges.filter((e) => !e.to.match(/^\w+\.\w+$/)).length;
    console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${linkedEdges.length} edges (${linkedCount} linked)`);

    if (traceStore.len() > 0) {
      console.log(`  Traces: ${traceStore.len()} unique, ${traceStore.rootCount()} roots`);
    }
  } finally {
    await shutdownAll();
  }
}
