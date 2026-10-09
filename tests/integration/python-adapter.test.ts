import assert from "node:assert/strict";
import { test } from "node:test";
import { PythonAdapter } from "../../src/adapters/python/adapter.js";
import { GRAPH_SCHEMA_VERSION, type GraphSnapshot } from "../../src/core/graph.js";
import { createNodeId } from "../../src/core/ids.js";
import { validateGraph } from "../../src/core/validate.js";

const repositoryId = createNodeId("python-fixture", "repository", ".");
const adapter = new PythonAdapter();

test("Python functions and imports produce source-backed resolved and unresolved calls", async () => {
  const files = [
    { path: "helpers.py", content: "def load():\n    pass\n\ndef save():\n    pass\n" },
    { path: "main.py", content: [
      "from helpers import load, save",
      "def start(callback):",
      "    load()",
      "    save()",
      "    callback()",
    ].join("\n") },
  ];
  const result = await adapter.analyze({ repositoryId, files }, new AbortController().signal);
  const graph: GraphSnapshot = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    repositoryId,
    nodes: [{ id: repositoryId, kind: "repository", label: "sample" }, ...result.nodes],
    edges: result.edges,
    diagnostics: result.diagnostics,
  };

  assert.deepEqual(validateGraph(graph), []);
  assert.deepEqual(result.edges.map((edge) => edge.status), ["resolved", "resolved", "unresolved"]);
  assert.deepEqual(result.edges.map((edge) => result.nodes.find((node) => node.id === edge.to)?.label), [
    "load", "save", "callback target",
  ]);
  assert.deepEqual(result.edges.map((edge) => edge.evidence.span.start.line), [3, 4, 5]);
  assert.ok(result.edges.every((edge) => edge.evidence.adapterId === adapter.id));
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["UNRESOLVED_CALL"]);

  const again = await adapter.analyze({ repositoryId, files }, new AbortController().signal);
  assert.deepEqual(again, result);
});

test("Python methods show dynamic dispatch as possible and reassignment as unresolved", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "app.py",
      content: [
        "def helper(): pass",
        "def other(): pass",
        "helper = other",
        "class Worker:",
        "    def run(self):",
        "        self.save()",
        "        helper()",
        "    def save(self): pass",
      ].join("\n"),
    }],
  }, new AbortController().signal);

  assert.deepEqual(result.edges.map((edge) => edge.status), ["possible", "unresolved"]);
  assert.ok(result.nodes.some((node) => node.kind === "symbol" && node.symbolKind === "method"));
  assert.ok(result.nodes.some((node) => node.kind === "symbol" && node.symbolKind === "class"));
});

test("decorated and conditional definitions do not create certain call targets", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "dynamic.py",
      content: [
        "def decorator(fn): return fn",
        "@decorator",
        "def wrapped(): pass",
        "def start(flag, values):",
        "    if flag:",
        "        def conditional(): pass",
        "    wrapped()",
        "    conditional()",
        "    [wrapped() for wrapped in values]",
      ].join("\n"),
    }],
  }, new AbortController().signal);

  assert.deepEqual(result.edges.map((edge) => edge.status), ["unresolved", "unresolved"]);
});

test("star imports prevent certain name resolution", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "wildcard.py",
      content: "def helper(): pass\nfrom other import *\ndef start(): helper()\n",
    }],
  }, new AbortController().signal);
  assert.equal(result.edges[0]?.status, "unresolved");
});

test("Python syntax errors, unsupported files, and cancellation are handled", async () => {
  assert.equal(adapter.supports("src/main.py"), true);
  assert.equal(adapter.supports("src/main.ts"), false);
  const broken = await adapter.analyze({
    repositoryId,
    files: [{ path: "broken.py", content: "def broken(:\n" }],
  }, new AbortController().signal);
  assert.ok(broken.diagnostics.some((diagnostic) => diagnostic.code === "PYTHON_SYNTAX_ERROR"));
  assert.equal(broken.edges.length, 0);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.analyze({
    repositoryId,
    files: [{ path: "main.py", content: "def main(): pass" }],
  }, controller.signal), { name: "AbortError" });
});

test("Python class construction and assigned instance methods extend possible flow", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [
      { path: "service.py", content: [
        "class Worker:",
        "    def __init__(self):",
        "        self.helper = Helper()",
        "    def start(self):",
        "        self.helper.run()",
        "class Helper:",
        "    def __init__(self): pass",
        "    def run(self): pass",
      ].join("\n") },
      { path: "main.py", content: [
        "from service import Worker",
        "def main():",
        "    worker = Worker()",
        "    worker.start()",
        "def changed():",
        "    worker = Worker()",
        "    worker = unknown()",
        "    worker.start()",
      ].join("\n") },
    ],
  }, new AbortController().signal);
  const symbols = result.nodes.filter((node) => node.kind === "symbol");
  const calls = result.edges.map((edge) => ({
    from: symbols.find((node) => node.id === edge.from)?.qualifiedName,
    to: symbols.find((node) => node.id === edge.to)?.qualifiedName,
    status: edge.status,
  }));
  assert.ok(calls.some((call) => call.from === "main" && call.to === "Worker.__init__" && call.status === "possible"));
  assert.ok(calls.some((call) => call.from === "Worker.__init__" && call.to === "Helper.__init__" && call.status === "possible"));
  assert.ok(calls.some((call) => call.from === "Worker.start" && call.to === "Helper.run" && call.status === "possible"));
  assert.ok(calls.some((call) => call.from === "main" && call.to === "Worker.start" && call.status === "possible"));
  assert.equal(calls.filter((call) => call.from === "changed" && call.to === "Worker.start").length, 0);
});

test("Python instance-field reassignment does not claim a method target", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [{ path: "main.py", content: [
      "class Helper:",
      "    def run(self): pass",
      "class Worker:",
      "    def __init__(self):",
      "        self.helper = Helper()",
      "        self.helper = unknown()",
      "    def start(self): self.helper.run()",
    ].join("\n") }],
  }, new AbortController().signal);
  const runCall = result.edges.find((edge) => edge.evidence.span.start.line === 7);
  assert.equal(runCall?.status, "unresolved");
});

test("module assignments appear as file globals without local variables", async () => {
  const result = await adapter.analyze({
    repositoryId,
    files: [{
      path: "settings.py",
      content: [
        "LIMIT = 3",
        "name: str = 'mavis'",
        "LIMIT = 4",
        "def run():",
        "    local = 1",
      ].join("\n"),
    }],
  }, new AbortController().signal);
  const globals = result.nodes.filter((node) => node.kind === "state" && node.stateKind === "global");
  assert.deepEqual(globals.map((node) => [node.label, node.kind === "state" ? node.location.start.line : -1]), [["LIMIT", 1], ["name", 2]]);
});
