import assert from "node:assert/strict";
import { test } from "node:test";
import { languageForPath, summarizeDiscovery } from "../../../src/indexer/inventory.js";

test("language inventory handles common source files and leaves unknown types unclassified", () => {
  assert.equal(languageForPath("src/main.tsx"), "TypeScript");
  assert.equal(languageForPath("Dockerfile"), "Dockerfile");
  assert.equal(languageForPath("src/query.py"), "Python");
  assert.equal(languageForPath("README.md"), null);

  const summary = summarizeDiscovery({
    root: "/example",
    files: [
      { path: "src/main.tsx" },
      { path: "src/helpers.ts" },
      { path: "src/query.py" },
      { path: "README.md" },
    ],
    skipped: [
      { path: "dist/", reason: "generated-directory" },
      { path: "secrets.py", reason: "gitignored" },
    ],
    diagnostics: [],
    gitIgnoreApplied: true,
  });

  assert.equal(summary.totalFiles, 4);
  assert.equal(summary.sourceFiles, 3);
  assert.equal(summary.unclassifiedFiles, 1);
  assert.deepEqual(summary.languages, [
    { language: "TypeScript", files: 2 },
    { language: "Python", files: 1 },
  ]);
  assert.equal(summary.skipped.gitignored, 1);
  assert.equal(summary.skipped["generated-directory"], 1);
});
