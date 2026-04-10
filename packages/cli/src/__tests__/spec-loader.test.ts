import { describe, it, expect } from "vitest";
import { loadSpec } from "../spec-loader.js";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Spec Loader", () => {
  const tmpSpec = path.join(os.tmpdir(), "rayuela-test-spec.yml");

  it("parses a path test", async () => {
    await writeFile(
      tmpSpec,
      `
version: 1
tests:
  - name: "Upload flow exists"
    path:
      from: { screen: UploadScreen }
      through:
        - { endpoint: "POST /api/items" }
      to: { screen: DetailScreen }
    expect:
      reachable: true
      guards: [authenticated]
`
    );

    const tests = await loadSpec(tmpSpec);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe("Upload flow exists");
    expect(tests[0].testType).toBe("path");
    expect(tests[0].fromId).toBe("UploadScreen");
    expect(tests[0].throughIds).toEqual(["POST /api/items"]);
    expect(tests[0].toId).toBe("DetailScreen");
    expect(tests[0].expectReachable).toBe(true);
    expect(tests[0].expectGuards).toEqual(["authenticated"]);

    await unlink(tmpSpec);
  });

  it("parses a match test", async () => {
    await writeFile(
      tmpSpec,
      `
version: 1
tests:
  - name: "No debug endpoints"
    match: { endpoint: "/debug/*" }
    expect:
      reachable: false
`
    );

    const tests = await loadSpec(tmpSpec);
    expect(tests).toHaveLength(1);
    expect(tests[0].testType).toBe("match");
    expect(tests[0].matchType).toBe("endpoint");
    expect(tests[0].matchPattern).toBe("/debug/*");
    expect(tests[0].expectReachable).toBe(false);

    await unlink(tmpSpec);
  });
});
