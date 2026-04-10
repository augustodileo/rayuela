import type { TestResult } from "rayuela-core";
import type { GraphNode } from "@rayuela/sdk";

export function formatDiscovery(
  nodes: GraphNode[],
  detectedFrameworks: string[]
): string {
  const lines: string[] = [];

  lines.push(`  Detected: ${detectedFrameworks.join(", ")}`);
  lines.push("");

  const endpoints = nodes.filter((n) => n.type === "endpoint");
  const screens = nodes.filter((n) => n.type === "screen");

  if (endpoints.length > 0) {
    lines.push(`  -- Endpoints (${endpoints.length}) --`);
    for (const ep of endpoints) {
      const guards = ep.guards.length > 0 ? `guards: [${ep.guards.join(", ")}]` : "guards: none";
      const loc = `${ep.source.file.split("/").pop()}:${ep.source.line}`;
      lines.push(`  ${ep.id.padEnd(45)} ${guards.padEnd(30)} ${loc}`);
    }
    lines.push("");
  }

  if (screens.length > 0) {
    lines.push(`  -- Screens (${screens.length}) --`);
    for (const sc of screens) {
      const guards = sc.guards.length > 0 ? `guards: [${sc.guards.join(", ")}]` : "guards: none";
      const route = (sc.metadata as Record<string, string>)?.route || "";
      lines.push(`  ${sc.id.padEnd(30)} route: ${route.padEnd(20)} ${guards}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatTestResults(results: TestResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    lines.push(`  ${icon}  ${r.name}`);

    if (!r.passed) {
      for (const f of r.failures) {
        const loc = f.file ? ` (${f.file.split("/").pop()}:${f.line})` : "";
        lines.push(`        -> ${f.nodeId}: ${f.reason}${loc}`);
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  lines.push("");
  lines.push(`  ${passed} passed, ${failed} failed`);

  return lines.join("\n");
}
