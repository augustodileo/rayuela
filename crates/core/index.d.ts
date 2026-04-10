/* auto-generated napi type definitions */

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
