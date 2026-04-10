import { describe, it, expect } from "vitest";
import { linkApiCalls } from "../linker.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

const endpoints: GraphNode[] = [
  { type: "endpoint", id: "GET /api/v1/items", source: { file: "items.py", line: 1 }, guards: [], conditions: [], metadata: {} },
  { type: "endpoint", id: "POST /api/v1/auth/signup", source: { file: "auth.py", line: 1 }, guards: [], conditions: [], metadata: {} },
];

const screens: GraphNode[] = [
  { type: "screen", id: "HomeScreen", source: { file: "home.tsx", line: 1 }, guards: [], conditions: [], metadata: {} },
];

const allNodes = [...endpoints, ...screens];

describe("linkApiCalls (fallback)", () => {
  it("resolves unresolved module.method to matching endpoint", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "items.list", source: { file: "home.tsx", line: 5 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("GET /api/v1/items");
  });

  it("leaves already-resolved edges unchanged", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "GET /api/v1/items", source: { file: "home.tsx", line: 5 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("GET /api/v1/items");
  });

  it("leaves non-api edges unchanged", () => {
    const edges: GraphEdge[] = [
      { type: "navigates", from: "HomeScreen", to: "ProfileScreen", source: { file: "home.tsx", line: 10 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("ProfileScreen");
  });

  it("leaves unresolvable edges unchanged", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "unknown.action", source: { file: "home.tsx", line: 11 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("unknown.action");
  });
});
