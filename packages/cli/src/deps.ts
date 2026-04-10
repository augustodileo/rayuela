import { existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const CACHE_BASE = join(homedir(), ".cache", "rayuela");

interface DepResult {
  venvPath?: string;
  nodeModulesPath?: string;
}

/**
 * Auto-install project dependencies into a Rayuela cache directory.
 * Returns paths to the installed environments for LSP configuration.
 */
export async function ensureDependencies(sourceDir: string): Promise<DepResult> {
  const absDir = resolve(sourceDir);
  const result: DepResult = {};

  // Check for Python project
  const pyprojectPath = join(absDir, "pyproject.toml");
  const requirementsPath = join(absDir, "requirements.txt");

  if (existsSync(pyprojectPath)) {
    result.venvPath = await ensurePythonDeps(absDir, pyprojectPath);
  } else if (existsSync(requirementsPath)) {
    result.venvPath = await ensurePythonDepsFromRequirements(absDir, requirementsPath);
  }

  // Check for Node.js project
  const packageJsonPath = join(absDir, "package.json");
  if (existsSync(packageJsonPath)) {
    result.nodeModulesPath = await ensureNodeDeps(absDir);
  }

  return result;
}

/**
 * Get a cache directory for a project based on its lockfile hash.
 */
function getCacheDir(sourceDir: string, lockfileContent: string): string {
  const hash = createHash("sha256")
    .update(sourceDir)
    .update(lockfileContent)
    .digest("hex")
    .substring(0, 16);
  const cacheDir = join(CACHE_BASE, hash);
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

/**
 * Install Python dependencies via uv or pip.
 */
async function ensurePythonDeps(sourceDir: string, pyprojectPath: string): Promise<string | undefined> {
  const uvLockPath = join(sourceDir, "uv.lock");
  const hasUv = existsSync(uvLockPath) && isCommandAvailable("uv");

  if (hasUv) {
    const lockContent = readFileSync(uvLockPath, "utf-8");
    const cacheDir = getCacheDir(sourceDir, lockContent);
    const venvPath = join(cacheDir, ".venv");
    const markerFile = join(cacheDir, ".rayuela-installed");

    if (existsSync(markerFile)) {
      return venvPath;
    }

    console.log("  Installing Python dependencies (uv sync)...");
    try {
      execSync(`uv sync --frozen --directory "${sourceDir}" --python-preference system`, {
        cwd: sourceDir,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, UV_PROJECT_ENVIRONMENT: venvPath },
        timeout: 120000,
      });
      // Write marker so we skip next time
      writeFileSync(markerFile, new Date().toISOString());
      return venvPath;
    } catch (e: any) {
      console.log(`  WARN  uv sync failed: ${e.stderr?.toString().trim() || e.message}`);
      return undefined;
    }
  }

  // Fallback: check if venv already exists in project
  const existingVenv = join(sourceDir, ".venv");
  if (existsSync(join(existingVenv, "bin", "python"))) {
    return existingVenv;
  }

  return undefined;
}

/**
 * Install Python dependencies from requirements.txt via pip.
 */
async function ensurePythonDepsFromRequirements(sourceDir: string, requirementsPath: string): Promise<string | undefined> {
  const reqContent = readFileSync(requirementsPath, "utf-8");
  const cacheDir = getCacheDir(sourceDir, reqContent);
  const venvPath = join(cacheDir, ".venv");
  const markerFile = join(cacheDir, ".rayuela-installed");

  if (existsSync(markerFile)) {
    return venvPath;
  }

  if (!isCommandAvailable("python3")) return undefined;

  console.log("  Installing Python dependencies (pip)...");
  try {
    execSync(`python3 -m venv "${venvPath}"`, { stdio: "ignore", timeout: 30000 });
    execSync(`"${venvPath}/bin/pip" install -r "${requirementsPath}" -q`, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120000,
    });
    writeFileSync(markerFile, new Date().toISOString());
    return venvPath;
  } catch (e: any) {
    console.log(`  WARN  pip install failed: ${e.message}`);
    return undefined;
  }
}

/**
 * Install Node.js dependencies.
 */
async function ensureNodeDeps(sourceDir: string): Promise<string | undefined> {
  const nodeModules = join(sourceDir, "node_modules");
  if (existsSync(nodeModules)) {
    return nodeModules;
  }

  // Try installing into cache
  const lockFile = existsSync(join(sourceDir, "pnpm-lock.yaml"))
    ? join(sourceDir, "pnpm-lock.yaml")
    : existsSync(join(sourceDir, "package-lock.json"))
      ? join(sourceDir, "package-lock.json")
      : join(sourceDir, "package.json");

  const lockContent = readFileSync(lockFile, "utf-8");
  const cacheDir = getCacheDir(sourceDir, lockContent);
  const cachedModules = join(cacheDir, "node_modules");
  const markerFile = join(cacheDir, ".rayuela-installed");

  if (existsSync(markerFile)) {
    return cachedModules;
  }

  // Detect package manager and install
  const pm = existsSync(join(sourceDir, "pnpm-lock.yaml")) ? "pnpm"
    : existsSync(join(sourceDir, "package-lock.json")) ? "npm"
    : "npm";

  if (!isCommandAvailable(pm)) return undefined;

  console.log(`  Installing Node.js dependencies (${pm})...`);
  try {
    // Copy package files to cache dir for isolated install
    const pkg = readFileSync(join(sourceDir, "package.json"), "utf-8");
    writeFileSync(join(cacheDir, "package.json"), pkg);
    if (existsSync(lockFile) && lockFile !== join(sourceDir, "package.json")) {
      const lock = readFileSync(lockFile, "utf-8");
      writeFileSync(join(cacheDir, basename(lockFile)), lock);
    }

    execSync(`${pm} install --ignore-scripts`, {
      cwd: cacheDir,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120000,
    });
    writeFileSync(markerFile, new Date().toISOString());
    return cachedModules;
  } catch (e: any) {
    console.log(`  WARN  ${pm} install failed: ${e.message}`);
    return undefined;
  }
}

function isCommandAvailable(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
