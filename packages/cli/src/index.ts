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
  .command("discover <source-dir>")
  .description("Scan source code and output all discovered paths")
  .option("--format <format>", "Output format: text, json, yaml", "text")
  .action(async (sourceDir: string) => {
    const resolved = path.resolve(sourceDir);
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved} ...\n`);
    await runDiscover(resolved);
  });

program
  .command("test <source-dir>")
  .description("Validate source code against a behavior spec")
  .option("--spec <file>", "Path to spec file", "rayuela.test.yml")
  .option("--format <format>", "Output format: text, json, junit", "text")
  .action(async (sourceDir: string, options: { spec: string }) => {
    const resolved = path.resolve(sourceDir);
    const specPath = path.resolve(options.spec);
    console.log(`\n  rayuela v0.1.0\n`);
    console.log(`  Scanning ${resolved} ...\n`);
    const allPassed = await runTest(resolved, specPath);
    process.exit(allPassed ? 0 : 1);
  });

program.parse();
