#!/usr/bin/env node
import { resolve } from "node:path";
import { discoverRepository } from "../indexer/discover.js";
import { languageForPath, summarizeDiscovery } from "../indexer/inventory.js";

const usage = [
  "Trace is a local code relationship explorer.",
  "",
  "Usage:",
  "  trace --help",
  "  trace scan [directory] [--json]",
  "",
  "scan inventories repository files and likely languages. Function relationships",
  "and the interactive graph will be added in later features.",
].join("\n");

export async function runCli(
  args: readonly string[],
  writeOut: (message: string) => void = console.log,
  writeError: (message: string) => void = console.error,
): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    writeOut(usage);
    return 0;
  }

  if (args[0] !== "scan") {
    writeError("Unknown command: " + args.join(" ") + "\nRun trace --help for usage.");
    return 2;
  }

  const options = args.slice(1);
  const json = options.includes("--json");
  const paths = options.filter((option) => option !== "--json");
  if (paths.length > 1 || paths.some((path) => path.startsWith("-"))) {
    writeError("Usage: trace scan [directory] [--json]");
    return 2;
  }

  const directory = resolve(paths[0] ?? ".");
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    const discovery = await discoverRepository(directory, { signal: controller.signal });
    const summary = summarizeDiscovery(discovery);
    if (json) {
      writeOut(JSON.stringify({
        summary,
        files: discovery.files.map((file) => ({
          path: file.path,
          language: languageForPath(file.path),
        })),
        skipped: discovery.skipped,
      }, null, 2));
      return 0;
    }

    const lines = [
      "Repository: " + summary.root,
      "Files found: " + summary.totalFiles + " (" + summary.sourceFiles + " recognised source files, " + summary.unclassifiedFiles + " unclassified)",
      "Git ignore rules: " + (summary.gitIgnoreApplied ? "applied" : "unavailable"),
      "Languages: " + (summary.languages.length
        ? summary.languages.map((item) => item.language + " " + item.files).join(", ")
        : "none recognised"),
      "Skipped: " + discovery.skipped.length + " paths",
    ];
    for (const diagnostic of summary.diagnostics) lines.push("Note: " + diagnostic);
    const source = discovery.files.filter((file) => languageForPath(file.path) !== null);
    if (source.length > 0) {
      lines.push("", "Source files:");
      for (const file of source.slice(0, 20)) {
        lines.push("  " + file.path + " (" + languageForPath(file.path) + ")");
      }
      if (source.length > 20) lines.push("  ...and " + (source.length - 20) + " more (use --json for all paths)");
    }
    lines.push("", "File inventory only; function relationships are not analysed yet.");
    writeOut(lines.join("\n"));
    return 0;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      writeError("Scan cancelled.");
      return 130;
    }
    writeError("Scan failed: " + (error as Error).message);
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

process.exitCode = await runCli(process.argv.slice(2));
