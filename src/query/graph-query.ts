import type { GraphEdge, GraphNode, GraphSnapshot, NodeId } from "../core/graph.js";

export interface NeighborEdge {
  readonly edge: GraphEdge;
  readonly neighbor: GraphNode;
}

export interface Neighborhood {
  readonly focus: GraphNode;
  readonly incoming: readonly NeighborEdge[];
  readonly outgoing: readonly NeighborEdge[];
  readonly omittedIncoming: number;
  readonly omittedOutgoing: number;
}

export interface NeighborhoodOptions {
  readonly includeUnresolved?: boolean;
  readonly perDirectionLimit?: number;
}

function rank(edge: GraphEdge): number {
  return edge.status === "resolved" || edge.status === "observed" ? 0
    : edge.status === "possible" ? 1 : 2;
}

function orderEdges(a: NeighborEdge, b: NeighborEdge): number {
  return rank(a.edge) - rank(b.edge)
    || a.neighbor.label.localeCompare(b.neighbor.label)
    || a.edge.evidence.span.path.localeCompare(b.edge.evidence.span.path)
    || a.edge.evidence.span.start.line - b.edge.evidence.span.start.line
    || a.edge.id.localeCompare(b.edge.id);
}

/** Find source symbols by name or file path, with a predictable result limit. */
export function searchSymbols(graph: GraphSnapshot, query: string, limit = 50): GraphNode[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const term = query.trim().toLocaleLowerCase();
  return graph.nodes
    .filter((node) => node.kind === "symbol" && (
      !term || node.qualifiedName.toLocaleLowerCase().includes(term)
      || node.location.path.toLocaleLowerCase().includes(term)
    ))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Direct callers and callees only; the cap keeps large repositories navigable. */
export function getNeighborhood(
  graph: GraphSnapshot,
  focusId: NodeId,
  options: NeighborhoodOptions = {},
): Neighborhood {
  const limit = options.perDirectionLimit ?? 12;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("perDirectionLimit must be a positive integer");
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const focus = byId.get(focusId);
  if (!focus) throw new Error("Unknown graph node: " + focusId);
  const visible = (edge: GraphEdge): boolean => options.includeUnresolved || edge.status !== "unresolved";
  const incoming: NeighborEdge[] = [];
  const outgoing: NeighborEdge[] = [];
  for (const edge of graph.edges) {
    if (!visible(edge)) continue;
    if (edge.to === focusId && edge.from !== focusId) {
      const neighbor = byId.get(edge.from);
      if (neighbor) incoming.push({ edge, neighbor });
    }
    if (edge.from === focusId) {
      const neighbor = byId.get(edge.to);
      if (neighbor) outgoing.push({ edge, neighbor });
    }
  }
  incoming.sort(orderEdges);
  outgoing.sort(orderEdges);
  return {
    focus,
    incoming: incoming.slice(0, limit),
    outgoing: outgoing.slice(0, limit),
    omittedIncoming: Math.max(0, incoming.length - limit),
    omittedOutgoing: Math.max(0, outgoing.length - limit),
  };
}
