import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { GraphSnapshot } from "../../../src/core/graph.js";
import { getNeighborhood, searchSymbols } from "../../../src/query/graph-query.js";

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
