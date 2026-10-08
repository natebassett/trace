/**
 * Versioned, language-neutral facts passed between analysis, queries, and viewers.
 * Source positions are 1-based; end positions are exclusive.
 * All paths are repository-relative and use forward slashes.
 */
export const GRAPH_SCHEMA_VERSION = 1 as const;

export type NodeId = string;
export type EdgeId = string;

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly path: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

interface NodeBase {
  readonly id: NodeId;
  readonly label: string;
}

export type GraphNode =
  | (NodeBase & { readonly kind: "repository" })
  | (NodeBase & {
      readonly kind: "package";
      readonly parentId: NodeId;
      readonly path: string;
    })
  | (NodeBase & {
      readonly kind: "module";
      readonly parentId: NodeId;
      readonly path: string;
      readonly languageId: string;
    })
  | (NodeBase & {
      readonly kind: "symbol";
      readonly parentId: NodeId;
      readonly qualifiedName: string;
      readonly symbolKind: "function" | "method" | "class" | "variable" | "export";
      readonly location: SourceSpan;
    })
  | (NodeBase & {
      readonly kind: "state";
      readonly parentId: NodeId;
      readonly stateKind: "module" | "global" | "field" | "store" | "environment";
      readonly location: SourceSpan;
    })
  | (NodeBase & {
      readonly kind: "boundary";
      readonly parentId?: NodeId;
      readonly boundaryKind: "external" | "unresolved" | "unsupported";
      readonly location?: SourceSpan;
    });

export type RelationshipKind =
  | "calls"
  | "imports"
  | "exports"
  | "reads"
  | "writes"
  | "registers"
  | "triggers"
  | "handles"
  | "external-effect";

export interface SourceEvidence {
  readonly span: SourceSpan;
  readonly adapterId: string;
  readonly method: string;
  readonly condition?: {
    readonly kind: "branch" | "loop" | "exception";
    readonly span: SourceSpan;
  };
}

interface EdgeBase {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: RelationshipKind;
  readonly evidence: SourceEvidence;
}

export type GraphEdge = EdgeBase &
  (
    | {
        readonly status: "resolved" | "possible" | "unresolved";
        readonly runId?: never;
      }
    | {
        readonly status: "observed";
        readonly runId: string;
      }
  );

export interface GraphDiagnostic {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly location?: SourceSpan;
}

export interface GraphSnapshot {
  readonly schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  readonly repositoryId: NodeId;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly diagnostics: readonly GraphDiagnostic[];
}
