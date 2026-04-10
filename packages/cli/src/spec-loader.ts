import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { SpecTest } from "rayuela-core";

interface RawSpec {
  version: number;
  tests: RawSpecTest[];
}

interface RawSpecTest {
  name: string;
  path?: {
    from?: { screen?: string; endpoint?: string };
    through?: Array<{ screen?: string; endpoint?: string }>;
    to?: { screen?: string; endpoint?: string };
  };
  match?: {
    type?: string;
    pattern?: string;
    endpoint?: string;
    screen?: string;
    exclude?: string;
  };
  expect: {
    reachable?: boolean;
    guards?: string[];
    called_by?: { type: string; min: number };
  };
}

function resolveId(ref: { screen?: string; endpoint?: string } | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.screen || ref.endpoint;
}

export async function loadSpec(specPath: string): Promise<SpecTest[]> {
  const content = await readFile(specPath, "utf-8");
  const raw: RawSpec = YAML.parse(content);

  if (raw.version !== 1) {
    throw new Error(`Unsupported spec version: ${raw.version}`);
  }

  return raw.tests.map((t): SpecTest => {
    const isPathTest = !!t.path;
    const isMatchTest = !!t.match;

    if (isPathTest) {
      return {
        name: t.name,
        testType: "path",
        fromId: resolveId(t.path?.from) ?? null,
        throughIds: t.path?.through?.map((r) => resolveId(r)!).filter(Boolean) ?? null,
        toId: resolveId(t.path?.to) ?? null,
        matchType: null,
        matchPattern: null,
        excludePattern: null,
        expectReachable: t.expect.reachable ?? null,
        expectGuards: t.expect.guards ?? null,
        expectMinCallers: null,
      };
    }

    if (isMatchTest) {
      const matchType = t.match!.type || (t.match!.endpoint ? "endpoint" : "screen");
      const matchPattern = t.match!.pattern || t.match!.endpoint || t.match!.screen || "*";

      return {
        name: t.name,
        testType: "match",
        fromId: null,
        throughIds: null,
        toId: null,
        matchType,
        matchPattern,
        excludePattern: t.match!.exclude ?? null,
        expectReachable: t.expect.reachable ?? null,
        expectGuards: t.expect.guards ?? null,
        expectMinCallers: t.expect.called_by?.min ?? null,
      };
    }

    throw new Error(`Test "${t.name}" must have either "path" or "match"`);
  });
}
