import { shutdownAll } from "@rayuela/lsp";
import { formatDiscovery } from "./formatters/text.js";
import { scanProject } from "./scan.js";

export async function runDiscover(sourceDirs: string[]): Promise<void> {
  try {
    const { nodes, edges, detectedFrameworks, traceStore } = await scanProject(sourceDirs);

    if (detectedFrameworks.length === 0) {
      console.log("  No supported frameworks detected.");
      return;
    }

    console.log(formatDiscovery(nodes, detectedFrameworks));

    const endpointCount = nodes.filter((n) => n.type === "endpoint").length;
    const screenCount = nodes.filter((n) => n.type === "screen").length;
    const linkedCount = edges.filter((e) => !e.to.match(/^\w+\.\w+$/)).length;
    console.log(`  Discovered: ${endpointCount} endpoints, ${screenCount} screens, ${edges.length} edges (${linkedCount} linked)`);

    if (traceStore.len() > 0) {
      console.log(`  Traces: ${traceStore.len()} unique, ${traceStore.rootCount()} roots`);
    }
  } finally {
    await shutdownAll();
  }
}
