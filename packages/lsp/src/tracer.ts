import type { CallHierarchyItem } from "vscode-languageserver-protocol";
import { LspClient } from "./client.js";
import { type SourcePosition, type CallTreeNode, type DefinitionResult, toLspPosition, fromUri } from "./types.js";

/**
 * Build a call tree from a function at the given source position.
 * Uses LSP callHierarchy/outgoingCalls recursively.
 */
export async function buildCallTree(
  client: LspClient,
  position: SourcePosition,
  maxDepth: number = 5,
): Promise<CallTreeNode | null> {
  const lsp = toLspPosition(position);

  // Prepare call hierarchy at the function position
  const items = await client.prepareCallHierarchy(position.file, lsp.line, lsp.character);
  if (!items || items.length === 0) return null;

  const rootItem = items[0];
  return buildNode(client, rootItem, maxDepth, new Set());
}

async function buildNode(
  client: LspClient,
  item: CallHierarchyItem,
  depth: number,
  visited: Set<string>,
): Promise<CallTreeNode> {
  const key = `${item.uri}:${item.range.start.line}:${item.name}`;
  const node: CallTreeNode = {
    name: item.name,
    detail: item.detail,
    file: fromUri(item.uri),
    line: item.range.start.line + 1, // LSP 0-indexed → 1-indexed
    children: [],
  };

  if (depth <= 0 || visited.has(key)) return node;
  visited.add(key);

  try {
    const outgoing = await client.outgoingCalls(item);
    for (const call of outgoing) {
      const child = await buildNode(client, call.to, depth - 1, visited);
      node.children.push(child);
    }
  } catch {
    // Call hierarchy not available for this item — leaf node
  }

  return node;
}

/**
 * Resolve the definition of a symbol at the given source position.
 * Uses LSP textDocument/definition.
 */
export async function resolveDefinition(
  client: LspClient,
  position: SourcePosition,
): Promise<DefinitionResult | null> {
  const lsp = toLspPosition(position);
  const locations = await client.definition(position.file, lsp.line, lsp.character);
  if (!locations || locations.length === 0) return null;

  const loc = locations[0];
  return {
    file: fromUri(loc.uri),
    line: loc.range.start.line + 1, // LSP 0-indexed → 1-indexed
    col: loc.range.start.character,
  };
}

/**
 * Search a call tree for nodes matching a predicate.
 * Returns true if any node in the tree matches.
 */
export function callTreeContains(
  tree: CallTreeNode,
  predicate: (node: CallTreeNode) => boolean,
): boolean {
  if (predicate(tree)) return true;
  return tree.children.some((child) => callTreeContains(child, predicate));
}

/**
 * Flatten a call tree into a list of all nodes (BFS).
 */
export function flattenCallTree(tree: CallTreeNode): CallTreeNode[] {
  const result: CallTreeNode[] = [];
  const queue = [tree];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    queue.push(...node.children);
  }
  return result;
}
