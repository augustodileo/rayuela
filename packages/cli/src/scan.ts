import { TraceStore } from "rayuela-core";
import { getClient, shutdownAll } from "@rayuela/lsp";
import { detectPlugins } from "./plugins.js";
import { linkApiCalls } from "./linker.js";
import { ensureDependencies } from "./deps.js";
import type { GraphNode, GraphEdge, AnalyzerContext } from "@rayuela/sdk";

export interface ScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  detectedFrameworks: string[];
  traceStore: InstanceType<typeof TraceStore>;
}

/**
 * Scan one or more source directories: detect frameworks, install deps,
 * spawn LSP, run analyzers, link cross-layer edges.
 */
export async function scanProject(sourceDirs: string[]): Promise<ScanResult> {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const detectedNames = new Set<string>();
  const traceStore = new TraceStore();

  for (const sourceDir of sourceDirs) {
    const context: AnalyzerContext = { traceStore };

    const plugins = await detectPlugins(sourceDir);
    if (plugins.length === 0) continue;

    // Install deps + spawn LSP
    try {
      const deps = await ensureDependencies(sourceDir);
      const lang = plugins.some((p) => p.name === "fastapi") ? "python" : "typescript";
      const lsp = await getClient(lang as "python" | "typescript", sourceDir, {
        venvPath: deps.venvPath,
        nodeModulesPath: deps.nodeModulesPath,
      });
      if (lsp) context.lspClient = lsp;
    } catch { /* LSP not available */ }

    // Run analyzers
    for (const plugin of plugins) {
      detectedNames.add(plugin.name);
      const result = await plugin.analyze(sourceDir, context);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
      for (const w of result.warnings) {
        console.log(`  WARN  ${w.message} (${w.source.file}:${w.source.line})`);
      }
    }
  }

  // Link cross-layer edges (frontend API calls → backend endpoints)
  const linkedEdges = linkApiCalls(allNodes, allEdges);

  return {
    nodes: allNodes,
    edges: linkedEdges,
    detectedFrameworks: [...detectedNames],
    traceStore,
  };
}
