/* napi type definitions for rayuela-core */

export interface CaptureInfo {
  text: string
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export interface QueryMatch {
  captures: Record<string, CaptureInfo>
  startLine: number
  endLine: number
}

export interface GraphNodeData {
  nodeType: string
  id: string
  file: string
  line: number
  guards: string[]
  conditions: string[]
}

export interface GraphEdgeData {
  edgeType: string
  fromId: string
  toId: string
  file: string
  line: number
}

export interface SpecTest {
  name: string
  testType: string
  fromId?: string
  throughIds?: string[]
  toId?: string
  matchType?: string
  matchPattern?: string
  excludePattern?: string
  expectReachable?: boolean
  expectGuards?: string[]
  expectMinCallers?: number
}

export interface TestResult {
  name: string
  passed: boolean
  message: string | null
  failures: TestFailure[]
}

export interface TestFailure {
  nodeId: string
  reason: string
  file: string
  line: number
}

export interface SymbolLocation {
  file: string
  line: number
  symbol: string
}

export class ParseResult {}

export function parseFile(filePath: string): ParseResult
export function parseSource(source: string, language: string): ParseResult
export function queryTree(parseResult: ParseResult, pattern: string): QueryMatch[]
export function getLanguageName(parseResult: ParseResult): string

export class AppGraph {
  constructor()
  addNode(node: GraphNodeData): void
  addEdge(edge: GraphEdgeData): void
  isReachable(fromId: string, toId: string): boolean
  findNodes(nodeType: string, pattern: string): GraphNodeData[]
  findOrphans(nodeType: string, edgeType: string): GraphNodeData[]
  getAllNodes(): GraphNodeData[]
  getAllEdges(): GraphEdgeData[]
  getNode(id: string): GraphNodeData | null
  countNodes(nodeType: string): number
  pathExists(nodeIds: string[]): boolean
}

export function validateSpec(graph: AppGraph, tests: SpecTest[]): TestResult[]

export class NameResolver {
  static build(sourceDir: string): NameResolver
  findDefinition(symbol: string, file: string, line: number): SymbolLocation | null
  findReferences(symbol: string, file: string): SymbolLocation[]
}

// Trace identity model

export const enum TraceKind {
  Endpoint = 'Endpoint',
  Screen = 'Screen',
  Guard = 'Guard',
  Service = 'Service',
  Repository = 'Repository',
  External = 'External',
  Function = 'Function',
}

export interface Trace {
  hash: string
  symbol: string
  file: string
  line: number
  kind: TraceKind
  parameters: string[]
  children: string[]
}

export interface TraceTree {
  hash: string
  symbol: string
  file: string
  line: number
  kind: TraceKind
  parameters: string[]
  children: TraceTree[]
}

export class TraceStore {
  constructor()
  insertLeaf(symbol: string, file: string, line: number, kind: TraceKind, parameters: string[]): string
  insert(symbol: string, file: string, line: number, kind: TraceKind, parameters: string[], childrenHashes: string[]): string
  addRoot(hash: string): void
  get(hash: string): Trace | null
  getRoots(): Trace[]
  findBySymbol(symbol: string): Trace[]
  findRootsContaining(symbol: string): Trace[]
  findRootsMissingGuard(guardName: string): Trace[]
  expand(hash: string): TraceTree | null
  len(): number
  rootCount(): number
}
