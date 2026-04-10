#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { runDiscover } from "./discover.js";
import { runTest } from "./test-cmd.js";

const program = new Command();

program
  .name("rayuela")
  .description("Static analysis framework for discovering and validating app behavior paths")
  .version("0.1.0");

program
  .command("discover")
  .description("Scan source code and output all discovered paths")
  .argument("<sourceDirs...>", "One or more source directories to scan")
  .option("--format <format>", "Output format: text, json, yaml", "text")
  .option("--no-lsp", "Disable LSP integration (use tree-sitter + Stack Graphs only)")
  .action(async (sourceDirs: string[], options: { lsp: boolean }) => {
    const resolved = sourceDirs.map((d) => path.resolve(d));
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved.join(", ")} ...\n`);
    await runDiscover(resolved, options.lsp);
  });

program
  .command("test")
  .description("Validate source code against a behavior spec")
  .argument("<sourceDirs...>", "One or more source directories to scan")
  .option("--spec <file>", "Path to spec file", "rayuela.test.yml")
  .option("--format <format>", "Output format: text, json, junit", "text")
  .option("--no-lsp", "Disable LSP integration (use tree-sitter + Stack Graphs only)")
  .action(async (sourceDirs: string[], options: { spec: string; lsp: boolean }) => {
    const resolved = sourceDirs.map((d) => path.resolve(d));
    const specPath = path.resolve(options.spec);
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved.join(", ")} ...\n`);
    const allPassed = await runTest(resolved, specPath, options.lsp);
    process.exit(allPassed ? 0 : 1);
  });

program.parse();
