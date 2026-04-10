import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { LspClient } from "./client.js";

type Language = "python" | "typescript" | "tsx";

const SERVER_COMMANDS: Record<Language, { cmd: string; args: string[] }> = {
  python: { cmd: "pyright-langserver", args: ["--stdio"] },
  typescript: { cmd: "typescript-language-server", args: ["--stdio"] },
  tsx: { cmd: "typescript-language-server", args: ["--stdio"] },
};

/** Cache of running language server clients, keyed by "language:sourceDir" */
const clientCache = new Map<string, LspClient>();

/**
 * Check if a language server command is available in PATH.
 */
function isCommandAvailable(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore", env: process.env });
    return true;
  } catch {
    return false;
  }
}

export interface LspClientOptions {
  venvPath?: string;
  nodeModulesPath?: string;
}

/**
 * Get or create an LSP client for a given language and source directory.
 * Returns null if the language server is not available.
 */
export async function getClient(
  language: Language,
  sourceDir: string,
  options?: LspClientOptions,
): Promise<LspClient | null> {
  const absDir = resolve(sourceDir);
  const key = `${language}:${absDir}`;

  // Return cached client if available
  if (clientCache.has(key)) {
    return clientCache.get(key)!;
  }

  const serverConfig = SERVER_COMMANDS[language];
  if (!serverConfig) return null;

  // Check if server is available
  if (!isCommandAvailable(serverConfig.cmd)) {
    return null;
  }

  // Build environment with venv/node_modules paths if provided
  const env = { ...process.env };
  if (options?.venvPath && language === "python") {
    // Tell Pyright where the Python interpreter is
    env.VIRTUAL_ENV = options.venvPath;
    env.PATH = `${options.venvPath}/bin:${env.PATH}`;
  }
  if (options?.nodeModulesPath && (language === "typescript" || language === "tsx")) {
    env.NODE_PATH = options.nodeModulesPath;
  }

  // Spawn the language server process
  const proc = spawn(serverConfig.cmd, serverConfig.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: absDir,
    env,
  });

  const client = new LspClient(proc);

  // Handle process errors
  proc.on("error", (err) => {
    console.error(`LSP server error: ${err.message}`);
  });

  // Initialize with the source directory as root
  try {
    const initResult = await Promise.race([
      client.initialize(absDir),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LSP initialize timed out")), 10000)
      ),
    ]);
  } catch (e) {
    proc.kill();
    return null;
  }

  clientCache.set(key, client);
  return client;
}

/**
 * Detect the language for a file.
 */
export function detectLanguage(filePath: string): Language | null {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".tsx")) return "tsx";
  return null;
}

/**
 * Shutdown all cached language servers. Call this before process exit.
 */
export async function shutdownAll(): Promise<void> {
  const shutdowns = Array.from(clientCache.values()).map((c) => c.shutdown());
  await Promise.allSettled(shutdowns);
  clientCache.clear();
}
