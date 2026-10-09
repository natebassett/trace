import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { JavaScriptTypeScriptAdapter } from "../../src/adapters/javascript-typescript/adapter.js";
import { GRAPH_SCHEMA_VERSION, type GraphSnapshot, type SourceSpan } from "../../src/core/graph.js";
import { createNodeId } from "../../src/core/ids.js";
import { validateGraph } from "../../src/core/validate.js";

const repositoryId = createNodeId("adapter-fixture", "repository", ".");
const fixtureRoot = resolve("tests/fixtures/graph-contract/sample");
const files = ["src/main.ts", "src/helpers.ts"].map((path) => ({
  path,
  content: readFileSync(resolve(fixtureRoot, path), "utf8"),
}));

function excerpt(source: string, location: SourceSpan): string {
  assert.equal(location.start.line, location.end.line);
  const line = source.split(/\r?\n/)[location.start.line - 1]!;
  return line.slice(location.start.column - 1, location.end.column - 1);
}

test("the adapter turns the branching fixture into validated, source-backed calls", async () => {
  const adapter = new JavaScriptTypeScriptAdapter();
  const result = await adapter.analyze({ repositoryId, files }, new AbortController().signal);
  const graph: GraphSnapshot = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repositoryId,
    nodes: [{ id: repositoryId, kind: "repository", label: "sample" }, ...result.nodes],
    edges: result.edges,
    diagnostics: result.diagnostics,
  };

  assert.deepEqual(validateGraph(graph), []);
  const start = result.nodes.find((node) => node.kind === "symbol" && node.label === "start");
  assert.ok(start);
  const calls = result.edges.filter((edge) => edge.from === start.id);
  assert.deepEqual(calls.map((edge) => edge.status), ["resolved", "resolved", "unresolved"]);
  assert.deepEqual(calls.map((edge) => result.nodes.find((node) => node.id === edge.to)?.label), [
    "load", "save", "handler target",
  ]);
  assert.deepEqual(calls.map((edge) => excerpt(files[0]!.content, edge.evidence.span)), [
    "load()", "save()", "handler()",
  ]);
  assert.ok(calls.every((edge) => edge.evidence.adapterId === adapter.id));
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["UNRESOLVED_CALL"]);

  const again = await adapter.analyze({ repositoryId, files }, new AbortController().signal);
  assert.deepEqual(again, result);
});

test("shadowed and reassigned names are not reported as resolved calls", async () => {
  const adapter = new JavaScriptTypeScriptAdapter();
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "src/flow.ts",
      content: [
        "function helper() {}",
        "function replacement() {}",
        "function shadowed(helper: () => void) { helper(); }",
        "function changed() { helper = replacement; helper(); }",
        "function skipped() { const callback = () => helper(); }",
      ].join("\n"),
    }],
  }, new AbortController().signal);

  assert.equal(result.edges.length, 2);
  assert.ok(result.edges.every((edge) => edge.status === "unresolved"));
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "UNRESOLVED_CALL", "UNRESOLVED_CALL",
  ]);
});

test("nested calls and duplicate function declarations preserve graph validity", async () => {
  const adapter = new JavaScriptTypeScriptAdapter();
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "src/nested.js",
      content: [
        "function make() { return () => {}; }",
        "function same() {}",
        "function same() {}",
        "function start() { make()(); same(); }",
      ].join("\n"),
    }],
  }, new AbortController().signal);
  const graph: GraphSnapshot = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repositoryId,
    nodes: [{ id: repositoryId, kind: "repository", label: "sample" }, ...result.nodes],
    edges: result.edges,
    diagnostics: result.diagnostics,
  };

  assert.deepEqual(validateGraph(graph), []);
  assert.deepEqual(result.edges.map((edge) => edge.status), ["unresolved", "resolved", "unresolved"]);
  assert.equal(new Set(result.nodes.map((node) => node.id)).size, result.nodes.length);
});

test("a syntax error is reported without treating its recovered AST as certain", async () => {
  const result = await new JavaScriptTypeScriptAdapter().analyze({
    repositoryId,
    files: [{ path: "src/broken.ts", content: "function start( { helper();" }],
  }, new AbortController().signal);

  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SYNTAX_ERROR"));
  assert.equal(result.edges.length, 0);
  assert.equal(result.nodes.filter((node) => node.kind === "symbol").length, 0);
});

test("the adapter supports the first four source extensions and rejects bad input paths", async () => {
  const adapter = new JavaScriptTypeScriptAdapter();
  for (const path of ["a.ts", "a.tsx", "a.js", "a.jsx"]) assert.equal(adapter.supports(path), true);
  for (const path of ["a.json", "a.py", "a.mts"]) assert.equal(adapter.supports(path), false);

  await assert.rejects(adapter.analyze({
    repositoryId,
    files: [{ path: "../outside.ts", content: "function a() {}" }],
  }, new AbortController().signal), /Invalid repository-relative source path/);
  await assert.rejects(adapter.analyze({
    repositoryId,
    files: [files[0]!, files[0]!],
  }, new AbortController().signal), /Duplicate source path/);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.analyze({ repositoryId, files }, controller.signal), { name: "AbortError" });
});

test("top-level declarations appear as file globals without function locals", async () => {
  const adapter = new JavaScriptTypeScriptAdapter();
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "src/settings.ts",
      content: [
        "export const limit = 3;",
        "let first = 1, second = 2;",
        "const { name } = { name: 'Trace' };",
        "function run() { const local = 1; }",
      ].join("\n"),
    }],
  }, new AbortController().signal);
  const globals = result.nodes.filter((node) => node.kind === "state" && node.stateKind === "global");
  assert.deepEqual(globals.map((node) => node.label), ["limit", "first", "second", "name"]);
  assert.deepEqual(globals.map((node) => node.kind === "state" ? node.location.start.line : -1), [1, 2, 2, 3]);
});
