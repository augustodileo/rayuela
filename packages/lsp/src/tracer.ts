import { LspClient } from "./client.js";
import { type SourcePosition, type CallTreeNode, type DefinitionResult, toLspPosition, fromUri } from "./types.js";

// === Python call-site queries ===

const PY_METHOD_CALL = `
(await
  (call
    function: (attribute
      attribute: (identifier) @call_method)))
`;

const PY_FUNC_CALL = `
(await
  (call
    function: (identifier) @call_func))
`;

// === TypeScript/JavaScript call-site queries ===

/** method.call() — e.g., rolls.list(), api.items.get() */
const TS_METHOD_CALL = `
(call_expression
  function: (member_expression
    property: (property_identifier) @call_method))
`;

/** func() — e.g., useRolls(), useAuthStore() */
const TS_FUNC_CALL = `
(call_expression
  function: (identifier) @call_func)
`;

/**
 * Build a call tree using definition resolution + tree-sitter.
 * Works with ANY LSP server (only needs textDocument/definition).
 *
 * Approach:
 * 1. Parse file, find await calls near the target position
 * 2. For each call, resolve via LSP definition
 * 3. Recurse into resolved definitions within the project
 */
export async function buildCallTreeViaDefinitions(
  client: LspClient,
  position: SourcePosition,
  sourceDir: string,
  maxDepth: number = 4,
): Promise<CallTreeNode | null> {
  const { parseFile, queryTree } = await import("rayuela-core");

  let tree;
  try { tree = parseFile(position.file); } catch { return null; }

  // Find the function at this position (Python or TypeScript)
  const isPython = position.file.endsWith(".py");
  const fnQuery = isPython
    ? `(function_definition name: (identifier) @fn_name)`
    : `[(function_declaration name: (identifier) @fn_name)
       (export_default_declaration (function_declaration name: (identifier) @fn_name))]`;
  const fns = queryTree(tree, fnQuery);
  const fn = fns.reduce((best: typeof fns[0] | null, m) => {
    const line = m.captures["fn_name"]?.startLine;
    if (!line) return best;
    const dist = Math.abs(line - position.line);
    const bestDist = best ? Math.abs(best.captures["fn_name"]?.startLine - position.line) : Infinity;
    return dist < bestDist ? m : best;
  }, null);

  const fnName = fn?.captures["fn_name"]?.text || "unknown";
  const fnLine = fn?.captures["fn_name"]?.startLine || position.line;

  // The match only covers the captures, not the full function body.
  // Find the next function to determine this function's end line.
  const allFnLines = fns
    .map((m: any) => m.captures["fn_name"]?.startLine)
    .filter((l: any): l is number => !!l)
    .sort((a: number, b: number) => a - b);
  const fnIdx = allFnLines.indexOf(fnLine);
  const fnEndLine = fnIdx >= 0 && fnIdx < allFnLines.length - 1
    ? allFnLines[fnIdx + 1] - 1
    : fnLine + 100;

  const rootNode: CallTreeNode = {
    name: fnName, file: position.file, line: position.line, children: [],
  };

  if (maxDepth <= 0) return rootNode;

  await client.openFile(position.file, position.file.endsWith(".py") ? "python" : "typescript");

  const visited = new Set<string>();
  visited.add(`${position.file}:${position.line}`);

  // Select queries based on file type (isPython declared earlier)
  const methodQuery = isPython ? PY_METHOD_CALL : TS_METHOD_CALL;
  const funcQuery = isPython ? PY_FUNC_CALL : TS_FUNC_CALL;

  // Find method calls in this function's range
  const methodCalls = queryTree(tree, methodQuery)
    .filter((m: any) => {
      const line = m.captures["call_method"]?.startLine;
      return line && line >= fnLine && line <= fnEndLine;
    });

  for (const call of methodCalls) {
    const name = call.captures["call_method"]?.text;
    const line = call.captures["call_method"]?.startLine;
    const col = call.captures["call_method"]?.startCol;
    if (!name || !line || col === undefined) continue;

    const child = await resolveAndRecurse(
      client, position.file, line, col, name,
      sourceDir, maxDepth - 1, visited, parseFile, queryTree,
    );
    if (child) rootNode.children.push(child);
  }

  // Find direct function calls
  const funcCalls = queryTree(tree, funcQuery)
    .filter((m: any) => {
      const line = m.captures["call_func"]?.startLine;
      return line && line >= fnLine && line <= fnEndLine;
    });

  for (const call of funcCalls) {
    const name = call.captures["call_func"]?.text;
    const line = call.captures["call_func"]?.startLine;
    const col = call.captures["call_func"]?.startCol;
    if (!name || !line || col === undefined) continue;

    const child = await resolveAndRecurse(
      client, position.file, line, col, name,
      sourceDir, maxDepth - 1, visited, parseFile, queryTree,
    );
    if (child) rootNode.children.push(child);
  }

  return rootNode;
}

async function resolveAndRecurse(
  client: LspClient,
  file: string,
  line: number,
  col: number,
  name: string,
  sourceDir: string,
  depth: number,
  visited: Set<string>,
  parseFile: any,
  queryTree: any,
): Promise<CallTreeNode | null> {
  const def = await resolveDefinition(client, { file, line, col });
  if (!def) return { name, file, line, children: [] };

  // Only recurse into project files
  if (!def.file.startsWith(sourceDir)) {
    return { name, file: def.file, line: def.line, children: [] };
  }

  const key = `${def.file}:${def.line}`;
  if (visited.has(key) || depth <= 0) {
    return { name, file: def.file, line: def.line, children: [] };
  }
  visited.add(key);

  const child = await buildCallTreeViaDefinitions(
    client, { file: def.file, line: def.line, col: 0 }, sourceDir, depth,
  );
  return child || { name, file: def.file, line: def.line, children: [] };
}

// --- Utilities ---

export async function resolveDefinition(
  client: LspClient, position: SourcePosition,
): Promise<DefinitionResult | null> {
  const lsp = toLspPosition(position);
  const locs = await client.definition(position.file, lsp.line, lsp.character);
  if (!locs || locs.length === 0) return null;
  return { file: fromUri(locs[0].uri), line: locs[0].range.start.line + 1, col: locs[0].range.start.character };
}

export function flattenCallTree(tree: CallTreeNode): CallTreeNode[] {
  const result: CallTreeNode[] = [];
  const queue = [tree];
  while (queue.length > 0) { const n = queue.shift()!; result.push(n); queue.push(...n.children); }
  return result;
}
