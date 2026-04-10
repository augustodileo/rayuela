import type { Analyzer } from "@rayuela/sdk";

// Built-in analyzers — imported directly
import { fastapiAnalyzer } from "@rayuela/analyzer-fastapi";
import { expoRouterAnalyzer } from "@rayuela/analyzer-expo-router";

const BUILTIN_ANALYZERS: Analyzer[] = [fastapiAnalyzer, expoRouterAnalyzer];

export async function detectPlugins(sourceDir: string): Promise<Analyzer[]> {
  const detected: Analyzer[] = [];

  for (const analyzer of BUILTIN_ANALYZERS) {
    if (await analyzer.detect(sourceDir)) {
      detected.push(analyzer);
    }
  }

  return detected;
}
