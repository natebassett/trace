import type { RelationshipKind, SourceSpan } from "./graph.js";

function makeId(prefix: string, parts: readonly string[]): string {
  if (parts.some((part) => part.length === 0)) {
    throw new Error("Graph ID parts must not be empty");
  }

  return `${prefix}:${parts.map(encodeURIComponent).join("/")}`;
}

/**
 * The caller supplies a deterministic repository key and local key.
 * A symbol key must distinguish namesakes and overloads within a repository.
 */
export function createNodeId(
  repositoryKey: string,
  kind: string,
  localKey: string,
): string {
  return makeId("node", [repositoryKey, kind, localKey]);
}

/**
 * Static edges with the same source site and target share an ID across scans.
 * A runtime observation can use its run ID as the discriminator.
 */
export function createEdgeId(
  repositoryKey: string,
  kind: RelationshipKind,
  from: string,
  to: string,
  span: SourceSpan,
  discriminator = "static",
): string {
  return makeId("edge", [
    repositoryKey,
    kind,
    from,
    to,
    span.path,
    String(span.start.line),
    String(span.start.column),
    String(span.end.line),
    String(span.end.column),
    discriminator,
  ]);
}
