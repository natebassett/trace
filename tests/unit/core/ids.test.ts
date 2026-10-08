import assert from "node:assert/strict";
import { test } from "node:test";
import { createEdgeId, createNodeId } from "../../../src/core/ids.js";
import type { SourceSpan } from "../../../src/core/graph.js";

const callSite: SourceSpan = {
  path: "src/start.ts",
  start: { line: 8, column: 3 },
  end: { line: 8, column: 10 },
};

test("node IDs distinguish repositories, kinds, and namesakes", () => {
  const first = createNodeId("repo-a", "symbol", "src/a.ts::start");
  assert.equal(first, createNodeId("repo-a", "symbol", "src/a.ts::start"));
  assert.notEqual(first, createNodeId("repo-b", "symbol", "src/a.ts::start"));
  assert.notEqual(first, createNodeId("repo-a", "symbol", "src/b.ts::start"));
  assert.notEqual(first, createNodeId("repo-a", "state", "src/a.ts::start"));
});

test("edge IDs distinguish call sites, targets, and runtime observations", () => {
  const from = createNodeId("repo", "symbol", "start");
  const to = createNodeId("repo", "symbol", "finish");
  const first = createEdgeId("repo", "calls", from, to, callSite);

  assert.equal(first, createEdgeId("repo", "calls", from, to, callSite));
  assert.notEqual(
    first,
    createEdgeId("repo", "calls", from, to, {
      ...callSite,
      start: { line: 9, column: 3 },
    }),
  );
  assert.notEqual(
    first,
    createEdgeId("repo", "calls", from, createNodeId("repo", "symbol", "other"), callSite),
  );
  assert.notEqual(first, createEdgeId("repo", "calls", from, to, callSite, "run-1"));
});

test("IDs reject missing identity components", () => {
  assert.throws(() => createNodeId("repo", "symbol", ""), /must not be empty/);
  assert.throws(() => createEdgeId("repo", "calls", "from", "to", {
    ...callSite,
    path: "",
  }), /must not be empty/);
});
