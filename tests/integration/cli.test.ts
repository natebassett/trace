import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

test("the CLI explains how to start", () => {
  const result = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Trace is a local code relationship explorer/);
  assert.match(result.stdout, /trace scan/);
  assert.equal(result.stderr, "");
});

test("the CLI rejects unsupported commands clearly", () => {
  const result = spawnSync(process.execPath, [cliPath, "unknown"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: unknown/);
  assert.equal(result.stdout, "");
});

test("scan reports languages and provides a complete JSON inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "trace-cli-"));
  try {
    await writeFile(join(root, "main.ts"), "export const answer = 42;\n");
    await writeFile(join(root, "README.md"), "# Example\n");

    const human = spawnSync(process.execPath, [cliPath, "scan", root], { encoding: "utf8" });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /TypeScript 1/);
    assert.match(human.stdout, /main.ts \(TypeScript\)/);
    assert.match(human.stdout, /Scan inventories files/);

    const json = spawnSync(process.execPath, [cliPath, "scan", root, "--json"], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    const parsed = JSON.parse(json.stdout) as {
      summary: { totalFiles: number; sourceFiles: number };
      files: Array<{ path: string; language: string | null }>;
    };
    assert.equal(parsed.summary.totalFiles, 2);
    assert.equal(parsed.summary.sourceFiles, 1);
    assert.deepEqual(parsed.files.map((file) => file.path), ["main.ts", "README.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scan reports an invalid directory without a stack trace", () => {
  const result = spawnSync(process.execPath, [cliPath, "scan", join(tmpdir(), "trace-missing-directory-for-test")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scan failed:/);
  assert.equal(result.stdout, "");
});

test("analyze exposes a validated JavaScript/TypeScript graph through the CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "trace-analyze-"));
  try {
    await writeFile(join(root, "helpers.ts"), "export function load() {}\n");
    await writeFile(join(root, "main.ts"), [
      'import { load } from "./helpers.js";',
      "export function start(callback: () => void) { load(); callback(); }",
    ].join("\n"));

    const result = spawnSync(process.execPath, [cliPath, "analyze", root, "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      summary: { analyzedFiles: number; calls: { resolved: number; unresolved: number } };
      graph: { nodes: Array<{ kind: string; label: string }>; edges: Array<{ status: string; evidence: { span: { path: string } } }> };
    };
    assert.equal(parsed.summary.analyzedFiles, 2);
    assert.deepEqual(parsed.summary.calls, { resolved: 1, possible: 0, unresolved: 1 });
    assert.ok(parsed.graph.nodes.some((node) => node.kind === "symbol" && node.label === "start"));
    assert.deepEqual(parsed.graph.edges.map((edge) => edge.evidence.span.path), ["main.ts", "main.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyze runs Python source through the CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "trace-python-cli-"));
  try {
    await writeFile(join(root, "helpers.py"), "def load():\n    pass\n");
    await writeFile(join(root, "main.py"), [
      "from helpers import load",
      "def start(callback):",
      "    load()",
      "    callback()",
    ].join("\n"));
    const result = spawnSync(process.execPath, [cliPath, "analyze", root, "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      summary: { analyzedFiles: number; calls: { resolved: number; possible: number; unresolved: number } };
      graph: { nodes: Array<{ kind: string; languageId?: string }> };
    };
    assert.equal(parsed.summary.analyzedFiles, 2);
    assert.deepEqual(parsed.summary.calls, { resolved: 1, possible: 0, unresolved: 1 });
    assert.ok(parsed.graph.nodes.some((node) => node.kind === "module" && node.languageId === "python"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
