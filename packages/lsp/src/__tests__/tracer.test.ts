import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { getClient, shutdownAll, buildCallTree, resolveDefinition, callTreeContains } from "../index.js";
import type { LspClient } from "../client.js";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../fixtures/fastapi-app"
);

// Check if pyright-langserver is available
let pyrightAvailable = false;
try {
  const { execSync } = await import("node:child_process");
  execSync("which pyright-langserver", { stdio: "ignore" });
  pyrightAvailable = true;
} catch {}

describe.skipIf(!pyrightAvailable)("LSP Tracer (Pyright)", () => {
  let client: Awaited<ReturnType<typeof getClient>>;

  beforeAll(async () => {
    client = await getClient("python", FIXTURE_DIR);
    expect(client).not.toBeNull();

    // Open key files for Pyright to analyze
    await client!.openFile(path.join(FIXTURE_DIR, "app/api/items.py"), "python");
    await client!.openFile(path.join(FIXTURE_DIR, "app/infra/auth.py"), "python");
    await new Promise((r) => setTimeout(r, 3000));
  }, 30000);

  afterAll(async () => {
    await shutdownAll();
  });

  it("prepares call hierarchy for get_current_user_id", async () => {
    const authFile = path.join(FIXTURE_DIR, "app/infra/auth.py");
    // Line 9 (1-indexed) = line 8 (0-indexed), col 10 = inside function name
    const items = await client!.prepareCallHierarchy(authFile, 8, 10);

    expect(items).not.toBeNull();
    expect(items!.length).toBeGreaterThan(0);
    expect(items![0].name).toBe("get_current_user_id");
  }, 15000);

  it("gets outgoing calls from get_current_user_id", async () => {
    const authFile = path.join(FIXTURE_DIR, "app/infra/auth.py");
    const items = await client!.prepareCallHierarchy(authFile, 8, 10);
    expect(items).not.toBeNull();

    const outgoing = await client!.outgoingCalls(items![0]);
    // Should find at least UUID call (jwt.decode may not resolve without venv)
    expect(outgoing.length).toBeGreaterThan(0);

    const callNames = outgoing.map((c) => c.to.name);
    console.log("Outgoing calls from get_current_user_id:", callNames);
  }, 15000);

  it("builds call tree from function", async () => {
    const authFile = path.join(FIXTURE_DIR, "app/infra/auth.py");
    const tree = await buildCallTree(client!, {
      file: authFile,
      line: 9, // 1-indexed
      col: 10,
    });

    expect(tree).not.toBeNull();
    expect(tree!.name).toBe("get_current_user_id");
    expect(tree!.children.length).toBeGreaterThan(0);
    console.log("Call tree:", JSON.stringify(tree, null, 2));
  }, 15000);
});
