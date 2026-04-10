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
        fromId: resolveId(t.path?.from) ?? undefined,
        throughIds: t.path?.through?.map((r) => resolveId(r)!).filter(Boolean) ?? undefined,
        toId: resolveId(t.path?.to) ?? undefined,
        matchType: undefined,
        matchPattern: undefined,
        excludePattern: undefined,
        expectReachable: t.expect.reachable ?? undefined,
        expectGuards: t.expect.guards ?? undefined,
        expectMinCallers: undefined,
      };
    }

    if (isMatchTest) {
      const matchType = t.match!.type || (t.match!.endpoint ? "endpoint" : "screen");
      const matchPattern = t.match!.pattern || t.match!.endpoint || t.match!.screen || "*";

      return {
        name: t.name,
        testType: "match",
        fromId: undefined,
        throughIds: undefined,
        toId: undefined,
        matchType,
        matchPattern,
        excludePattern: t.match!.exclude ?? undefined,
        expectReachable: t.expect.reachable ?? undefined,
        expectGuards: t.expect.guards ?? undefined,
        expectMinCallers: t.expect.called_by?.min ?? undefined,
      };
    }

    throw new Error(`Test "${t.name}" must have either "path" or "match"`);
  });
}
