/** Position in source code — bridge between tree-sitter and LSP */
export interface SourcePosition {
  file: string;
  /** 1-indexed line number (matches tree-sitter CaptureInfo.startLine) */
  line: number;
  /** 0-indexed column (matches tree-sitter CaptureInfo.startCol) */
  col: number;
}

/** A node in a call hierarchy tree */
export interface CallTreeNode {
  name: string;
  detail?: string;
  file: string;
  line: number;
  children: CallTreeNode[];
}

/** Result of resolving a symbol to its definition */
export interface DefinitionResult {
  file: string;
  line: number;
  col: number;
}

/** Convert tree-sitter position to LSP position (0-indexed line) */
export function toLspPosition(pos: SourcePosition): { line: number; character: number } {
  return { line: pos.line - 1, character: pos.col };
}

/** Convert a file path to LSP URI */
export function toUri(filePath: string): string {
  const resolved = filePath.startsWith("/") ? filePath : require("path").resolve(filePath);
  return `file://${resolved}`;
}

/** Convert LSP URI to file path */
export function fromUri(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}
