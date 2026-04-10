import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { LspClient } from "./client.js";

type Language = "python" | "typescript" | "tsx";

/** Server commands per language */
const SERVERS: Record<Language, { cmd: string; args: string[] }> = {
  python: { cmd: "pyright-langserver", args: ["--stdio"] },
  typescript: { cmd: "typescript-language-server", args: ["--stdio"] },
  tsx: { cmd: "typescript-language-server", args: ["--stdio"] },
};

const clientCache = new Map<string, LspClient>();

export interface LspClientOptions {
  venvPath?: string;
  nodeModulesPath?: string;
}

/**
 * Get or create an LSP client for a language and source directory.
 *
 * Python: uses Pyright with PYTHONPATH=sourceDir and VIRTUAL_ENV=venvPath.
 * TypeScript: uses typescript-language-server.
 */
export async function getClient(
  language: Language,
  sourceDir: string,
  options?: LspClientOptions,
): Promise<LspClient | null> {
  const absDir = resolve(sourceDir);
  const key = `${language}:${absDir}`;

  if (clientCache.has(key)) return clientCache.get(key)!;

  const server = SERVERS[language];
  if (!server || !isAvailable(server.cmd)) return null;

  // Build environment
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  if (language === "python") {
    // PYTHONPATH lets Pyright resolve project-internal imports (from app.X import Y)
    env.PYTHONPATH = absDir;
    if (options?.venvPath) {
      // VIRTUAL_ENV lets Pyright find installed packages (fastapi, jwt, etc.)
      env.VIRTUAL_ENV = options.venvPath;
      env.PATH = `${options.venvPath}/bin:${env.PATH}`;
    }
  }

  if (options?.nodeModulesPath && (language === "typescript" || language === "tsx")) {
    env.NODE_PATH = options.nodeModulesPath;
  }

  const proc = spawn(server.cmd, server.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: absDir,
    env,
  });

  const client = new LspClient(proc);
  proc.on("error", () => {}); // Suppress spawn errors

  try {
    await Promise.race([
      client.initialize(absDir),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
    ]);
  } catch {
    proc.kill();
    return null;
  }

  clientCache.set(key, client);
  return client;
}

export function detectLanguage(filePath: string): Language | null {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".tsx")) return "tsx";
  return null;
}

export async function shutdownAll(): Promise<void> {
  await Promise.allSettled(Array.from(clientCache.values()).map(c => c.shutdown()));
  clientCache.clear();
}

function isAvailable(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; }
}
