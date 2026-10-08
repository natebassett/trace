import type {
  GraphDiagnostic,
  GraphEdge,
  GraphNode,
  NodeId,
} from "../core/graph.js";

/** The indexer supplies file contents; adapters never need to run repository code. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface AdapterInput {
  readonly repositoryId: NodeId;
  readonly files: readonly SourceFile[];
}

export interface AdapterResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

/** A language adapter emits graph facts without depending on a viewer or IDE. */
export interface LanguageAdapter {
  readonly id: string;
  readonly version: string;
  readonly languageIds: readonly string[];
  supports(path: string): boolean;
  analyze(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult>;
}
