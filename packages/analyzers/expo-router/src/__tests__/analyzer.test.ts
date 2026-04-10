import { describe, it, expect } from "vitest";
import { expoRouterAnalyzer } from "../index.js";
import { fileToRoute } from "../screens.js";
import path from "node:path";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../fixtures/expo-app"
);

describe("fileToRoute", () => {
  const appDir = path.join(FIXTURE_DIR, "app");

  it("converts index to home route", () => {
    const r = fileToRoute(path.join(appDir, "(tabs)/index.tsx"), appDir);
    expect(r.route).toBe("/(tabs)");
    expect(r.name).toBe("TabsScreen");
  });

  it("converts named file to route", () => {
    const r = fileToRoute(path.join(appDir, "(tabs)/profile.tsx"), appDir);
    expect(r.route).toBe("/(tabs)/profile");
    expect(r.name).toBe("ProfileScreen");
  });

  it("converts dynamic route", () => {
    const r = fileToRoute(path.join(appDir, "item/[id].tsx"), appDir);
    expect(r.route).toBe("/item/:id");
    expect(r.name).toBe("IdScreen");
  });

  it("converts auth screen", () => {
    const r = fileToRoute(path.join(appDir, "auth.tsx"), appDir);
    expect(r.route).toBe("/auth");
    expect(r.name).toBe("AuthScreen");
  });

  it("skips _layout files", () => {
    const r = fileToRoute(path.join(appDir, "_layout.tsx"), appDir);
    expect(r.name).toBe("");
  });
});

describe("Expo Router Analyzer", () => {
  it("detects Expo Router from package.json", async () => {
    const detected = await expoRouterAnalyzer.detect(FIXTURE_DIR);
    expect(detected).toBe(true);
  });

  it("discovers all screens", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);
    const screenNames = result.nodes.filter((n) => n.type === "screen").map((n) => n.id);

    expect(screenNames).toContain("AuthScreen");
    expect(screenNames).toContain("ProfileScreen");
    // Should not contain _layout
    expect(screenNames.every((n) => !n.includes("Layout"))).toBe(true);
  });

  it("detects auth guards from useAuthStore", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const profile = result.nodes.find((n) => n.id === "ProfileScreen");
    expect(profile?.guards).toContain("authenticated");

    const auth = result.nodes.find((n) => n.id === "AuthScreen");
    expect(auth?.guards).toContain("authenticated"); // AuthScreen also uses useAuthStore for login
  });

  it("resolves API calls to actual endpoint IDs via client parsing", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const apiCalls = result.edges.filter((e) => e.type === "calls");
    const targets = apiCalls.map((e) => e.to);

    // api.items.list is resolved to GET /api/v1/items by parsing lib/api.ts
    expect(targets).toContain("GET /api/v1/items");
  });

  it("resolves API calls with template URLs to parameterized endpoints", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const apiCalls = result.edges.filter((e) => e.type === "calls");
    const targets = apiCalls.map((e) => e.to);

    // api.items.get is resolved to GET /api/v1/items/{id} by parsing lib/api.ts
    expect(targets).toContain("GET /api/v1/items/{id}");
  });

  it("detects navigation edges", async () => {
    const result = await expoRouterAnalyzer.analyze(FIXTURE_DIR);

    const navEdges = result.edges.filter((e) => e.type === "navigates");
    expect(navEdges.length).toBeGreaterThan(0);
  });
});
