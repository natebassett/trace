import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { GraphSnapshot } from "../../../src/core/graph.js";
import { validateGraph } from "../../../src/core/validate.js";

const fixture = JSON.parse(
  readFileSync(resolve("tests/fixtures/graph-contract/branching.json"), "utf8"),
) as GraphSnapshot;

test("branching fixture keeps two known callees and one unresolved call", () => {
  assert.deepEqual(validateGraph(fixture), []);
  assert.deepEqual(
    fixture.edges.filter((edge) => edge.from === "start").map((edge) => [edge.to, edge.status]),
    [["load", "resolved"], ["save", "resolved"], ["dynamic", "unresolved"]],
  );
});

test("missing targets and unsupported certainty are reported", () => {
  const broken: GraphSnapshot = {
    ...fixture,
    edges: [
      { ...fixture.edges[0]!, to: "missing" },
      { ...fixture.edges[2]!, to: "load" },
    ],
  };
  const codes = validateGraph(broken).map((issue) => issue.code);

  assert.ok(codes.includes("MISSING_ENDPOINT"));
  assert.ok(codes.includes("INVALID_UNRESOLVED_TARGET"));
});

test("duplicate IDs, parent cycles, and invalid source locations are reported", () => {
  const broken: GraphSnapshot = {
    ...fixture,
    nodes: [
      ...fixture.nodes,
      { id: "start", kind: "repository", label: "duplicate" },
      { id: "cycle-a", kind: "package", label: "A", parentId: "cycle-b", path: "a" },
      { id: "cycle-b", kind: "package", label: "B", parentId: "cycle-a", path: "b" },
    ],
    edges: [
      ...fixture.edges,
      { ...fixture.edges[0]!, id: "bad-span", evidence: {
        ...fixture.edges[0]!.evidence,
        span: {
          path: "../outside.ts",
          start: { line: 0, column: 1 },
          end: { line: 0, column: 1 },
        },
      } },
    ],
  };
  const codes = validateGraph(broken).map((issue) => issue.code);

  assert.ok(codes.includes("DUPLICATE_NODE_ID"));
  assert.ok(codes.includes("PARENT_CYCLE"));
  assert.ok(codes.includes("INVALID_EVIDENCE"));
});

test("observed relationships identify the run that recorded them", () => {
  const observed: GraphSnapshot = {
    ...fixture,
    edges: [
      {
        ...fixture.edges[0]!,
        id: "observed-load",
        status: "observed",
        runId: "",
      },
    ],
  };

  assert.ok(validateGraph(observed).some((issue) => issue.code === "INVALID_OBSERVATION"));
});

test("missing source locations and unknown statuses are rejected", () => {
  const malformed = {
    ...fixture,
    nodes: fixture.nodes.map((node) =>
      node.id === "start" ? { ...node, location: undefined } : node
    ),
    edges: [{ ...fixture.edges[0]!, status: "certain" }],
  } as unknown as GraphSnapshot;
  const codes = validateGraph(malformed).map((issue) => issue.code);

  assert.ok(codes.includes("INVALID_SPAN"));
  assert.ok(codes.includes("INVALID_STATUS"));
});
