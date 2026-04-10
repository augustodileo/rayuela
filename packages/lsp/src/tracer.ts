import type { CallHierarchyItem } from "vscode-languageserver-protocol";
import { LspClient } from "./client.js";
import { type SourcePosition, type CallTreeNode, type DefinitionResult, toLspPosition, fromUri } from "./types.js";

/** Tree-sitter query: find all await method calls */
const AWAIT_METHOD_CALL_QUERY = `
(await
  (call
    function: (attribute
      attribute: (identifier) @call_method)))
`;

/** Tree-sitter query: find all await direct function calls */
const AWAIT_FUNC_CALL_QUERY = `
(await
  (call
    function: (identifier) @call_func))
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

  // Find the function at this position
  const fnQuery = `(function_definition name: (identifier) @fn_name)`;
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
    .map(m => m.captures["fn_name"]?.startLine)
    .filter((l): l is number => !!l)
    .sort((a, b) => a - b);
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

  // Find await method calls in this function's range
  const methodCalls = queryTree(tree, AWAIT_METHOD_CALL_QUERY)
    .filter(m => {
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

  // Find await direct function calls
  const funcCalls = queryTree(tree, AWAIT_FUNC_CALL_QUERY)
    .filter(m => {
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
  parseFile: (f: string) => unknown,
  queryTree: (tree: unknown, q: string) => Array<{ captures: Record<string, { text: string; startLine: number; startCol: number }>; startLine: number; endLine: number }>,
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

// --- Legacy callHierarchy approach (for servers that support it) ---

export async function buildCallTree(
  client: LspClient,
  position: SourcePosition,
  maxDepth: number = 5,
): Promise<CallTreeNode | null> {
  const lsp = toLspPosition(position);
  const items = await client.prepareCallHierarchy(position.file, lsp.line, lsp.character);
  if (!items || items.length === 0) return null;
  return buildNode(client, items[0], maxDepth, new Set());
}

async function buildNode(
  client: LspClient, item: CallHierarchyItem, depth: number, visited: Set<string>,
): Promise<CallTreeNode> {
  const key = `${item.uri}:${item.range.start.line}:${item.name}`;
  const node: CallTreeNode = {
    name: item.name, detail: item.detail, file: fromUri(item.uri),
    line: item.range.start.line + 1, children: [],
  };
  if (depth <= 0 || visited.has(key)) return node;
  visited.add(key);
  try {
    for (const call of await client.outgoingCalls(item)) {
      node.children.push(await buildNode(client, call.to, depth - 1, visited));
    }
  } catch { /* not supported */ }
  return node;
}

// --- Shared ---

export async function resolveDefinition(
  client: LspClient, position: SourcePosition,
): Promise<DefinitionResult | null> {
  const lsp = toLspPosition(position);
  const locs = await client.definition(position.file, lsp.line, lsp.character);
  if (!locs || locs.length === 0) return null;
  return { file: fromUri(locs[0].uri), line: locs[0].range.start.line + 1, col: locs[0].range.start.character };
}

export function callTreeContains(tree: CallTreeNode, pred: (n: CallTreeNode) => boolean): boolean {
  if (pred(tree)) return true;
  return tree.children.some(c => callTreeContains(c, pred));
}

export function flattenCallTree(tree: CallTreeNode): CallTreeNode[] {
  const result: CallTreeNode[] = [];
  const queue = [tree];
  while (queue.length > 0) { const n = queue.shift()!; result.push(n); queue.push(...n.children); }
  return result;
}
