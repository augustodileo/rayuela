import { describe, it, expect } from "vitest";
import { linkApiCalls } from "../linker.js";
import type { GraphNode, GraphEdge } from "@rayuela/sdk";

const endpoints: GraphNode[] = [
  { type: "endpoint", id: "GET /api/v1/items", source: { file: "items.py", line: 1 }, guards: [], conditions: [], metadata: {} },
  { type: "endpoint", id: "GET /api/v1/items/{item_id}", source: { file: "items.py", line: 5 }, guards: [], conditions: [], metadata: {} },
  { type: "endpoint", id: "POST /api/v1/items", source: { file: "items.py", line: 10 }, guards: [], conditions: [], metadata: {} },
  { type: "endpoint", id: "POST /api/v1/auth/signup", source: { file: "auth.py", line: 1 }, guards: [], conditions: [], metadata: {} },
  { type: "endpoint", id: "POST /api/v1/auth/login", source: { file: "auth.py", line: 5 }, guards: [], conditions: [], metadata: {} },
];

const screens: GraphNode[] = [
  { type: "screen", id: "HomeScreen", source: { file: "home.tsx", line: 1 }, guards: [], conditions: [], metadata: {} },
];

const allNodes = [...endpoints, ...screens];

describe("linkApiCalls", () => {
  it("links api.items.list to GET /api/v1/items (collection)", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "api.items.list", source: { file: "home.tsx", line: 5 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("GET /api/v1/items");
  });

  it("links api.items.get to GET /api/v1/items/{item_id} (parameterized)", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "api.items.get", source: { file: "home.tsx", line: 6 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("GET /api/v1/items/{item_id}");
  });

  it("links api.items.create to POST /api/v1/items", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "api.items.create", source: { file: "home.tsx", line: 7 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("POST /api/v1/items");
  });

  it("links api.auth.login to POST /api/v1/auth/login", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "api.auth.login", source: { file: "home.tsx", line: 8 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("POST /api/v1/auth/login");
  });

  it("leaves non-api edges unchanged", () => {
    const edges: GraphEdge[] = [
      { type: "navigates", from: "HomeScreen", to: "ProfileScreen", source: { file: "home.tsx", line: 10 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("ProfileScreen");
  });

  it("leaves unresolvable api edges unchanged", () => {
    const edges: GraphEdge[] = [
      { type: "calls", from: "HomeScreen", to: "api.unknown.action", source: { file: "home.tsx", line: 11 }, conditions: [] },
    ];
    const result = linkApiCalls(allNodes, edges);
    expect(result[0].to).toBe("api.unknown.action");
  });
});
