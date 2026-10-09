import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startViewer } from "../../src/cli/view.js";
import { analyzeRepository } from "../../src/indexer/analyze.js";

test("local viewer serves the graph, assets, and only analyzed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "trace-viewer-"));
  await writeFile(join(root, "main.ts"), "export function start() { helper(); }\nfunction helper() {}\n");
  await writeFile(join(root, "README.md"), "# Example\n");
  const result = await analyzeRepository(root);
  const viewer = await startViewer(result);
  try {
    const page = await fetch(viewer.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Graph explorer/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);

    const asset = await fetch(viewer.url + "assets/app.js");
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /getNeighborhood/);

    const graphResponse = await fetch(viewer.url + "api/graph");
    assert.equal(graphResponse.status, 200);
    const payload = await graphResponse.json() as {
      analyzedFiles: number;
      files: string[];
      graph: { edges: Array<{ status: string }> };
    };
    assert.equal(payload.analyzedFiles, 1);
    assert.deepEqual(payload.files, ["main.ts", "README.md"]);
    assert.equal(payload.graph.edges[0]?.status, "resolved");

    const source = await fetch(viewer.url + "api/source?path=main.ts");
    assert.equal(source.status, 200);
    assert.match(await source.text(), /function start/);
    const unsupported = await fetch(viewer.url + "api/source?path=README.md");
    assert.equal(unsupported.status, 404);
    const denied = await fetch(viewer.url + "api/source?path=..%2Fsecret.txt");
    assert.equal(denied.status, 404);
  } finally {
    await viewer.close();
    await rm(root, { recursive: true, force: true });
  }
});
