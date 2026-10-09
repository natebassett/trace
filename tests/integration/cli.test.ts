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
    assert.match(human.stdout, /File inventory only/);

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
