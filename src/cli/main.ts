#!/usr/bin/env node
import { resolve } from "node:path";
import { analyzeRepository } from "../indexer/analyze.js";
import { discoverRepository } from "../indexer/discover.js";
import { languageForPath, summarizeDiscovery } from "../indexer/inventory.js";
import { startViewer } from "./view.js";

const usage = [
  "Trace is a local code relationship explorer.",
  "",
  "Usage:",
  "  trace --help",
  "  trace scan [directory] [--json]",
  "  trace analyze [directory] [--json]",
  "  trace view [directory]",
  "",
  "scan inventories files; analyze builds a source-backed call graph for supported languages.",
  "view serves a local browser graph explorer. Press Ctrl+C to stop it.",
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

  const command = args[0];
  if (command !== "scan" && command !== "analyze" && command !== "view") {
    writeError("Unknown command: " + args.join(" ") + "\nRun trace --help for usage.");
    return 2;
  }

  const options = args.slice(1);
  const json = options.includes("--json");
  const paths = options.filter((option) => option !== "--json");
  if (paths.length > 1 || paths.some((path) => path.startsWith("-")) || (command === "view" && json)) {
    writeError(command === "view" ? "Usage: trace view [directory]" : `Usage: trace ${command} [directory] [--json]`);
    return 2;
  }

  const directory = resolve(paths[0] ?? ".");
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    if (command === "view") {
      const result = await analyzeRepository(directory, { signal: controller.signal });
      const viewer = await startViewer(result);
      writeOut("Graph viewer: " + viewer.url + "\nOpen this address in a browser. Press Ctrl+C to stop.");
      await new Promise<void>((done) => {
        if (controller.signal.aborted) done();
        else controller.signal.addEventListener("abort", () => done(), { once: true });
      });
      await viewer.close();
      return 0;
    }

    if (command === "analyze") {
      const result = await analyzeRepository(directory, { signal: controller.signal });
      const { graph } = result;
      const resolved = graph.edges.filter((edge) => edge.status === "resolved").length;
      const possible = graph.edges.filter((edge) => edge.status === "possible").length;
      const unresolved = graph.edges.filter((edge) => edge.status === "unresolved").length;
      const summary = {
        root: result.discovery.root,
        analyzedFiles: result.analyzedFiles,
        unsupportedFiles: result.unsupportedFiles,
        symbols: graph.nodes.filter((node) => node.kind === "symbol").length,
        calls: { resolved, possible, unresolved },
        diagnostics: graph.diagnostics.length,
      };
      if (json) {
        writeOut(JSON.stringify({ summary, graph }, null, 2));
      } else {
        writeOut([
          "Repository: " + summary.root,
          "Files analyzed: " + summary.analyzedFiles + " (" + summary.unsupportedFiles + " unsupported files)",
          "Symbols: " + summary.symbols,
          "Calls: " + resolved + " resolved, " + possible + " possible, " + unresolved + " unresolved",
          "Diagnostics: " + summary.diagnostics,
          "Use --json for graph nodes, edges, and source evidence.",
        ].join("\n"));
      }
      return 0;
    }

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
    lines.push("", "Scan inventories files. Use trace analyze for supported call relationships.");
    writeOut(lines.join("\n"));
    return 0;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      writeError(command === "scan" ? "Scan cancelled." : "Analysis cancelled.");
      return 130;
    }
    writeError((command === "scan" ? "Scan failed: " : command === "view" ? "Viewer failed: " : "Analysis failed: ") + (error as Error).message);
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

process.exitCode = await runCli(process.argv.slice(2));
