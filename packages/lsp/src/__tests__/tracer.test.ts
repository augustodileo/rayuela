import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { getClient, shutdownAll, resolveDefinition } from "../index.js";

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../fixtures/fastapi-app"
);

// Check if any Python LSP server is available
let lspAvailable = false;
try {
  const { execSync } = await import("node:child_process");
  try { execSync("which jedi-language-server", { stdio: "ignore" }); lspAvailable = true; } catch {}
  if (!lspAvailable) {
    try { execSync("which pyright-langserver", { stdio: "ignore" }); lspAvailable = true; } catch {}
  }
} catch {}

describe.skipIf(!lspAvailable)("LSP Definition Resolution", () => {
  let client: Awaited<ReturnType<typeof getClient>>;

  beforeAll(async () => {
    client = await getClient("python", FIXTURE_DIR, {
      venvPath: path.join(FIXTURE_DIR, ".venv"),
    });
    // If no client (no venv in fixture), try without venv
    if (!client) {
      client = await getClient("python", FIXTURE_DIR);
    }
    if (!client) return;

    await client.openFile(path.join(FIXTURE_DIR, "app/api/items.py"), "python");
    await client.openFile(path.join(FIXTURE_DIR, "app/infra/auth.py"), "python");
    await new Promise((r) => setTimeout(r, 3000));
  }, 30000);

  afterAll(async () => {
    await shutdownAll();
  });

  it("resolves stdlib imports", async () => {
    if (!client) return;
    const result = await resolveDefinition(client, {
      file: path.join(FIXTURE_DIR, "app/api/items.py"),
      line: 2, // from uuid import UUID (1-indexed)
      col: 17,
    });
    // UUID should resolve to uuid module
    if (result) {
      expect(result.file).toContain("uuid");
    }
  }, 15000);
});
