import { glob } from "glob";
import path from "node:path";

export interface DiscoveredScreen {
  name: string;
  route: string;
  file: string;
}

/** Convert Expo Router file path to route path and screen name */
export function fileToRoute(filePath: string, appDir: string): { route: string; name: string } {
  let relative = path.relative(appDir, filePath);
  // Remove extension
  relative = relative.replace(/\.(tsx?|jsx?)$/, "");
  // index files map to parent route
  relative = relative.replace(/\/index$/, "");
  // [param] → :param
  relative = relative.replace(/\[([^\]]+)\]/g, ":$1");
  // _layout files are not screens
  if (relative.endsWith("_layout") || relative === "_layout") {
    return { route: "", name: "" };
  }

  const route = "/" + relative;

  // Generate screen name from file name
  const baseName = path.basename(filePath, path.extname(filePath));
  const screenName =
    baseName === "index"
      ? dirToScreenName(relative || ".")
      : baseName.replace(/^\[/, "").replace(/\]$/, "") + "Screen";

  // PascalCase
  const name = screenName
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  return { route, name: name.endsWith("Screen") ? name : name + "Screen" };
}

function dirToScreenName(dir: string): string {
  if (!dir || dir === ".") return "HomeScreen";
  // Strip (group) parentheses
  const cleaned = dir.replace(/\(([^)]+)\)/g, "$1");
  const parts = cleaned.split("/");
  return parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1) + "Screen";
}

export async function discoverScreens(sourceDir: string): Promise<DiscoveredScreen[]> {
  const appDir = path.join(sourceDir, "app");
  const files = await glob("**/*.{tsx,ts,jsx,js}", {
    cwd: appDir,
    absolute: true,
    ignore: ["**/_layout.*", "**/*.test.*", "**/*.spec.*"],
  });

  const screens: DiscoveredScreen[] = [];
  for (const file of files) {
    const { route, name } = fileToRoute(file, appDir);
    if (name) {
      screens.push({ name, route, file });
    }
  }
  return screens;
}
