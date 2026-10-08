import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

test("the CLI explains how to start", () => {
  const result = spawnSync(process.execPath, [cliPath, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Trace is a local code relationship explorer/);
  assert.match(result.stdout, /trace --help/);
  assert.equal(result.stderr, "");
});

test("the CLI rejects unsupported commands clearly", () => {
  const result = spawnSync(process.execPath, [cliPath, "scan"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: scan/);
  assert.equal(result.stdout, "");
});
