import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { GraphSnapshot } from "../../../src/core/graph.js";
import { getCallFlow, getNeighborhood, searchStartPoints, searchSymbols, suggestStartPoints } from "../../../src/query/graph-query.js";

const graph = JSON.parse(
  readFileSync(resolve("tests/fixtures/graph-contract/branching.json"), "utf8"),
) as GraphSnapshot;

test("symbol search includes names and paths", () => {
  assert.deepEqual(searchSymbols(graph, "helpers.ts").map((node) => node.label), ["load", "save"]);
  assert.deepEqual(searchSymbols(graph, "START").map((node) => node.label), ["start"]);
  assert.deepEqual(searchSymbols(graph, "", 1).map((node) => node.label), ["load"]);
  assert.throws(() => searchSymbols(graph, "", 0), /positive integer/);
});

test("neighborhood keeps direct calls bounded and separates uncertainty", () => {
  const defaultView = getNeighborhood(graph, "start");
  assert.deepEqual(defaultView.outgoing.map((entry) => entry.neighbor.id), ["load", "save"]);
  assert.equal(defaultView.incoming.length, 0);
  assert.equal(defaultView.omittedOutgoing, 0);

  const withUnknown = getNeighborhood(graph, "start", { includeUnresolved: true, perDirectionLimit: 2 });
  assert.deepEqual(withUnknown.outgoing.map((entry) => entry.neighbor.id), ["load", "save"]);
  assert.equal(withUnknown.omittedOutgoing, 1);

  assert.deepEqual(getNeighborhood(graph, "load").incoming.map((entry) => entry.neighbor.id), ["start"]);
  assert.throws(() => getNeighborhood(graph, "missing"), /Unknown graph node/);
  assert.throws(() => getNeighborhood(graph, "start", { perDirectionLimit: 0 }), /positive integer/);
});

test("flow search includes modules and suggests connected starts", () => {
  assert.deepEqual(searchStartPoints(graph, "main.ts").map((node) => node.id), ["main", "start"]);
  assert.deepEqual(suggestStartPoints(graph).map((node) => node.id), ["start"]);
  assert.throws(() => searchStartPoints(graph, "", 0), /positive integer/);
});

test("call flow follows multiple steps, folds cycles, and keeps uncertainty visible", () => {
  const source = graph.edges[0]!;
  const extended: GraphSnapshot = {
    ...graph,
    edges: [
      ...graph.edges,
      { ...source, id: "load-save-1", from: "load", to: "save" },
      { ...source, id: "load-save-2", from: "load", to: "save" },
      { ...source, id: "save-start", from: "save", to: "start" },
    ],
  };
  const flow = getCallFlow(extended, "start", { depth: 3 });
  assert.deepEqual(flow.levels.map((level) => level.map((node) => node.id)), [["start"], ["load", "save"]]);
  assert.equal(flow.links.length, 4);
  assert.equal(flow.links.find((link) => link.from.id === "load" && link.to.id === "save")?.calls.length, 2);
  assert.equal(flow.links.find((link) => link.from.id === "save" && link.to.id === "start")?.status, "resolved");
  assert.equal(flow.links.some((link) => link.to.id === "dynamic"), false);
  assert.equal(getCallFlow(extended, "start", { includeUnresolved: true }).links.some((link) => link.to.id === "dynamic"), true);
  assert.deepEqual(getCallFlow(extended, "start", { depth: 1 }).levels.map((level) => level.length), [1, 2]);
  assert.equal(getCallFlow(extended, "start", { maxNodes: 2 }).omittedNodes, 1);
  assert.ok(getCallFlow(extended, "start", { maxLinks: 1 }).omittedLinks > 0);
  assert.throws(() => getCallFlow(extended, "missing"), /Unknown graph node/);
  assert.throws(() => getCallFlow(extended, "start", { depth: 0 }), /positive integer/);
});
