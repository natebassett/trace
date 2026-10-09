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

export interface CallFlowLink {
  readonly from: GraphNode;
  readonly to: GraphNode;
  readonly calls: readonly GraphEdge[];
  readonly status: GraphEdge["status"];
}

export interface CallFlow {
  readonly start: GraphNode;
  readonly levels: readonly (readonly GraphNode[])[];
  readonly links: readonly CallFlowLink[];
  readonly omittedNodes: number;
  readonly omittedLinks: number;
}

export interface CallFlowOptions {
  readonly depth?: number;
  readonly maxNodes?: number;
  readonly maxLinks?: number;
  readonly includeUnresolved?: boolean;
}

/** Search callable symbols and modules that can be chosen as a flow start. */
export function searchStartPoints(graph: GraphSnapshot, query: string, limit = 50): GraphNode[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const term = query.trim().toLocaleLowerCase();
  return graph.nodes
    .filter((node) => (node.kind === "symbol" || node.kind === "module") && (
      !term || node.label.toLocaleLowerCase().includes(term)
      || (node.kind === "symbol" && node.qualifiedName.toLocaleLowerCase().includes(term))
      || (node.kind === "symbol" ? node.location.path : node.path).toLocaleLowerCase().includes(term)
    ))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Heuristic candidates only; the user chooses the actual start. */
export function suggestStartPoints(graph: GraphSnapshot, limit = 8): GraphNode[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const outgoing = new Set(graph.edges.filter((edge) => edge.kind === "calls").map((edge) => edge.from));
  const incoming = new Set(graph.edges.filter((edge) => edge.kind === "calls" && edge.status !== "unresolved").map((edge) => edge.to));
  function priority(node: GraphNode): number {
    if (node.kind === "module" && /(^|\/)(main|__main__|app|index)\.(py|js|jsx|ts|tsx)$/i.test(node.path)) return 0;
    if (node.kind === "symbol" && /(^|\.)(main|run|start)$/i.test(node.qualifiedName)) return 1;
    if (node.kind === "module") return 3;
    return incoming.has(node.id) ? 4 : 2;
  }
  return graph.nodes
    .filter((node) => (node.kind === "symbol" || node.kind === "module") && outgoing.has(node.id))
    .sort((a, b) => priority(a) - priority(b) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Bounded downstream call flow from a user-chosen start, with cycles folded into links. */
export function getCallFlow(
  graph: GraphSnapshot,
  startId: NodeId,
  options: CallFlowOptions = {},
): CallFlow {
  const depth = options.depth ?? 3;
  const maxNodes = options.maxNodes ?? 28;
  const maxLinks = options.maxLinks ?? 60;
  for (const [name, value] of [["depth", depth], ["maxNodes", maxNodes], ["maxLinks", maxLinks]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + " must be a positive integer");
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = byId.get(startId);
  if (!start) throw new Error("Unknown graph node: " + startId);
  const adjacency = new Map<NodeId, Map<NodeId, GraphEdge[]>>();
  for (const edge of graph.edges) {
    if (edge.kind !== "calls" || (!options.includeUnresolved && edge.status === "unresolved")) continue;
    const targets = adjacency.get(edge.from) ?? new Map<NodeId, GraphEdge[]>();
    const calls = targets.get(edge.to) ?? [];
    calls.push(edge);
    targets.set(edge.to, calls);
    adjacency.set(edge.from, targets);
  }
  const levels: GraphNode[][] = [[start]];
  const visited = new Map<NodeId, number>([[startId, 0]]);
  const queue: NodeId[] = [startId];
  const links: CallFlowLink[] = [];
  const omittedNodeIds = new Set<NodeId>();
  let omittedLinks = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const fromId = queue[cursor]!;
    const currentDepth = visited.get(fromId)!;
    if (currentDepth >= depth) continue;
    const targets = [...(adjacency.get(fromId)?.entries() ?? [])]
      .filter(([toId]) => byId.has(toId))
      .sort(([aId, aCalls], [bId, bCalls]) =>
        rank(aCalls[0]!) - rank(bCalls[0]!)
        || byId.get(aId)!.label.localeCompare(byId.get(bId)!.label)
        || aId.localeCompare(bId));
    for (const [toId, calls] of targets) {
      if (links.length >= maxLinks) {
        omittedLinks += 1;
        continue;
      }
      if (!visited.has(toId)) {
        if (visited.size >= maxNodes) {
          omittedNodeIds.add(toId);
          continue;
        }
        const nextDepth = currentDepth + 1;
        visited.set(toId, nextDepth);
        (levels[nextDepth] ??= []).push(byId.get(toId)!);
        queue.push(toId);
      }
      calls.sort((a, b) => rank(a) - rank(b)
        || a.evidence.span.path.localeCompare(b.evidence.span.path)
        || a.evidence.span.start.line - b.evidence.span.start.line);
      links.push({ from: byId.get(fromId)!, to: byId.get(toId)!, calls, status: calls[0]!.status });
    }
  }
  return { start, levels, links, omittedNodes: omittedNodeIds.size, omittedLinks };
}
