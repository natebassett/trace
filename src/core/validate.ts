import {
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
  type GraphSnapshot,
  type SourcePosition,
  type SourceSpan,
} from "./graph.js";

export type GraphValidationCode =
  | "INVALID_VERSION"
  | "MISSING_REPOSITORY"
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_EDGE_ID"
  | "INVALID_NODE"
  | "INVALID_PARENT"
  | "PARENT_CYCLE"
  | "INVALID_PATH"
  | "INVALID_SPAN"
  | "MISSING_ENDPOINT"
  | "INVALID_EVIDENCE"
  | "INVALID_UNRESOLVED_TARGET"
  | "INVALID_OBSERVATION"
  | "INVALID_STATUS"
  | "INVALID_RELATIONSHIP";

export interface GraphValidationIssue {
  readonly code: GraphValidationCode;
  readonly message: string;
  readonly entityId?: string;
}

function isRepositoryPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function isPosition(value: SourcePosition): boolean {
  return (
    Number.isInteger(value?.line) &&
    value.line > 0 &&
    Number.isInteger(value?.column) &&
    value.column > 0
  );
}

function isSpan(value: SourceSpan): boolean {
  if (
    !value ||
    typeof value.path !== "string" ||
    !isRepositoryPath(value.path) ||
    !isPosition(value.start) ||
    !isPosition(value.end)
  ) {
    return false;
  }

  return (
    value.end.line > value.start.line ||
    (value.end.line === value.start.line && value.end.column > value.start.column)
  );
}

function parentIdOf(node: GraphNode): string | undefined {
  return "parentId" in node ? node.parentId : undefined;
}

/** Check an adapter-produced graph before indexing, caching, or displaying it. */
export function validateGraph(graph: GraphSnapshot): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const add = (code: GraphValidationCode, message: string, entityId?: string) => {
    issues.push(entityId === undefined ? { code, message } : { code, message, entityId });
  };

  if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    add("INVALID_VERSION", `Expected graph schema version ${GRAPH_SCHEMA_VERSION}`);
  }

  const nodeKinds = new Set(["repository", "package", "module", "symbol", "state", "boundary"]);
  const relationshipKinds = new Set([
    "calls", "imports", "exports", "reads", "writes",
    "registers", "triggers", "handles", "external-effect",
  ]);
  const statuses = new Set(["resolved", "possible", "observed", "unresolved"]);

  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (!node.id || !node.label.trim() || !nodeKinds.has(node.kind)) {
      add("INVALID_NODE", "Node ID and label must be nonempty", node.id);
    }
    if (nodesById.has(node.id)) {
      add("DUPLICATE_NODE_ID", `Duplicate node ID: ${node.id}`, node.id);
    } else {
      nodesById.set(node.id, node);
    }

    if ("path" in node && node.path !== "." && !isRepositoryPath(node.path)) {
      add("INVALID_PATH", `Invalid repository-relative path: ${node.path}`, node.id);
    }
    if (
      ((node.kind === "symbol" || node.kind === "state") && !isSpan(node.location)) ||
      ("location" in node && node.location !== undefined && !isSpan(node.location))
    ) {
      add("INVALID_SPAN", "Node location must be a valid source span", node.id);
    }
  }

  if (nodesById.get(graph.repositoryId)?.kind !== "repository") {
    add("MISSING_REPOSITORY", "repositoryId must identify a repository node", graph.repositoryId);
  }

  for (const node of graph.nodes) {
    const parentId = parentIdOf(node);
    if (
      node.kind !== "repository" &&
      node.kind !== "boundary" &&
      parentId === undefined
    ) {
      add("INVALID_PARENT", "Node requires a parent", node.id);
    }
    if (parentId !== undefined && !nodesById.has(parentId)) {
      add("INVALID_PARENT", `Missing parent node: ${parentId}`, node.id);
    }
  }

  const checked = new Set<string>();
  for (const node of graph.nodes) {
    if (checked.has(node.id)) continue;
    const path = new Set<string>();
    let current: GraphNode | undefined = node;
    while (current && !checked.has(current.id)) {
      if (path.has(current.id)) {
        add("PARENT_CYCLE", `Containment cycle includes ${current.id}`, current.id);
        break;
      }
      path.add(current.id);
      const parentId = parentIdOf(current);
      current = parentId === undefined ? undefined : nodesById.get(parentId);
    }
    for (const id of path) checked.add(id);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id)) {
      add("DUPLICATE_EDGE_ID", `Missing or duplicate edge ID: ${edge.id}`, edge.id);
    }
    edgeIds.add(edge.id);

    if (!relationshipKinds.has(edge.kind)) {
      add("INVALID_RELATIONSHIP", "Unknown relationship kind", edge.id);
    }
    if (!statuses.has(edge.status)) {
      add("INVALID_STATUS", "Unknown relationship status", edge.id);
    }
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      add("MISSING_ENDPOINT", "Edge must connect existing nodes", edge.id);
    }
    if (
      !edge.evidence ||
      !isSpan(edge.evidence.span) ||
      !edge.evidence.adapterId.trim() ||
      !edge.evidence.method.trim()
    ) {
      add("INVALID_EVIDENCE", "Edge needs a source span, adapter, and method", edge.id);
    }
    if (edge.evidence?.condition && !isSpan(edge.evidence.condition.span)) {
      add("INVALID_SPAN", "Condition needs a valid source span", edge.id);
    }
    if (edge.status === "unresolved") {
      const target = nodesById.get(edge.to);
      if (
        target?.kind !== "boundary" ||
        !["unresolved", "unsupported"].includes(target.boundaryKind)
      ) {
        add(
          "INVALID_UNRESOLVED_TARGET",
          "Unresolved edges must point to an unresolved or unsupported boundary",
          edge.id,
        );
      }
    }
    if (edge.status === "observed" && !edge.runId.trim()) {
      add("INVALID_OBSERVATION", "Observed edges need a run ID", edge.id);
    }
  }

  for (const diagnostic of graph.diagnostics) {
    if (diagnostic.location && !isSpan(diagnostic.location)) {
      add("INVALID_SPAN", `Diagnostic ${diagnostic.code} has an invalid source span`);
    }
  }

  return issues;
}
