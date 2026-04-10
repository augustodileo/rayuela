import { describe, it, expect } from "vitest";
import { fastapiAnalyzer } from "../index.js";
import path from "node:path";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../fixtures/fastapi-app"
);

describe("FastAPI Analyzer", () => {
  it("detects FastAPI from pyproject.toml", async () => {
    const detected = await fastapiAnalyzer.detect(FIXTURE_DIR);
    expect(detected).toBe(true);
  });

  it("does not detect in non-FastAPI project", async () => {
    const detected = await fastapiAnalyzer.detect("/tmp/nonexistent");
    expect(detected).toBe(false);
  });

  it("discovers all endpoints", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const endpointIds = result.nodes.map((n) => n.id).sort();
    expect(endpointIds).toContain("POST /api/v1/auth/signup");
    expect(endpointIds).toContain("POST /api/v1/auth/login");
    expect(endpointIds).toContain("POST /api/v1/items");
    expect(endpointIds).toContain("GET /api/v1/items");
    expect(endpointIds).toContain("GET /api/v1/items/{item_id}");
    expect(endpointIds).toContain("GET /health");
  });

  it("detects guards on protected endpoints", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const createItem = result.nodes.find((n) => n.id === "POST /api/v1/items");
    expect(createItem?.guards).toContain("authenticated");

    const listItems = result.nodes.find((n) => n.id === "GET /api/v1/items");
    expect(listItems?.guards).toContain("authenticated");
  });

  it("auth endpoints have no guards", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const signup = result.nodes.find((n) => n.id === "POST /api/v1/auth/signup");
    expect(signup?.guards).toHaveLength(0);

    const login = result.nodes.find((n) => n.id === "POST /api/v1/auth/login");
    expect(login?.guards).toHaveLength(0);
  });

  it("does not classify get_db as a guard", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    // create_item has both Depends(get_current_user_id) and Depends(get_db)
    const createItem = result.nodes.find((n) => n.id === "POST /api/v1/items");
    expect(createItem?.guards).toContain("authenticated");
    expect(createItem?.guards).not.toContain("get_db");
    expect(createItem?.guards).toHaveLength(1); // only "authenticated"
  });

  it("health endpoint has no guards", async () => {
    const result = await fastapiAnalyzer.analyze(FIXTURE_DIR);

    const health = result.nodes.find((n) => n.id === "GET /health");
    expect(health?.guards).toHaveLength(0);
  });
});
