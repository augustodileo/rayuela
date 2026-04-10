export interface SourceLocation {
  file: string;
  line: number;
}

export interface GraphNode {
  type: "endpoint" | "screen" | "store";
  id: string;
  source: SourceLocation;
  guards: string[];
  conditions: string[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  type: "calls" | "navigates" | "flows";
  from: string;
  to: string;
  source: SourceLocation;
  conditions: string[];
}

export interface AnalysisWarning {
  message: string;
  source: SourceLocation;
}

export interface AnalysisResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: AnalysisWarning[];
}

export interface AnalyzerContext {
  lspClient?: unknown;
  traceStore?: unknown;
}

export interface Analyzer {
  name: string;
  detect(sourceDir: string): Promise<boolean>;
  analyze(sourceDir: string, context?: AnalyzerContext): Promise<AnalysisResult>;
}
