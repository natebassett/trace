import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverRepository } from "../../../src/indexer/discover.js";

async function withDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "trace-discover-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Git discovery respects ignore rules and excludes generated folders", async () => {
  await withDirectory(async (root) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, ".gitignore"), "ignored.js\n");
    await writeFile(join(root, "main.ts"), "export const x = 1;\n");
    await writeFile(join(root, "ignored.js"), "ignored\n");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "output.js"), "output\n");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "module.tsx"), "module\n");

    const progress: number[] = [];
    const result = await discoverRepository(root, {
      onProgress: (value) => progress.push(value.examined),
    });

    assert.equal(result.gitIgnoreApplied, true);
    assert.deepEqual(result.files.map((file) => file.path), [".gitignore", "main.ts", "src/module.tsx"]);
    assert.ok(result.skipped.some((entry) => entry.path === "ignored.js" && entry.reason === "gitignored"));
    assert.ok(result.skipped.some((entry) => entry.path.startsWith("dist/") && entry.reason === "generated-directory"));
    assert.ok(progress.length > 0);
    assert.equal(progress.at(-1), result.files.length + result.skipped.length);
  });
});

test("plain directory discovery warns that Git ignore rules are unavailable", async () => {
  await withDirectory(async (root) => {
    await writeFile(join(root, "main.py"), "pass\n");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "dependency.js"), "ignored\n");
    const result = await discoverRepository(root);
    assert.deepEqual(result.files.map((file) => file.path), ["main.py"]);
    assert.equal(result.gitIgnoreApplied, false);
    assert.match(result.diagnostics[0] ?? "", /Git ignore rules were unavailable/);
    assert.ok(result.skipped.some((entry) => entry.path === "node_modules"));
  });
});

test("discovery stops when cancelled", async () => {
  await withDirectory(async (root) => {
    await writeFile(join(root, "main.py"), "pass\n");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(discoverRepository(root, { signal: controller.signal }), { name: "AbortError" });
  });
});
