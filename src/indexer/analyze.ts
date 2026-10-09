import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { JavaScriptTypeScriptAdapter } from "../adapters/javascript-typescript/adapter.js";
import { PythonAdapter } from "../adapters/python/adapter.js";
import type { LanguageAdapter, SourceFile } from "../adapters/adapter.js";
import { GRAPH_SCHEMA_VERSION, type GraphDiagnostic, type GraphSnapshot } from "../core/graph.js";
import { createNodeId } from "../core/ids.js";
import { validateGraph } from "../core/validate.js";
import { discoverRepository, type DiscoveryResult } from "./discover.js";

const defaultMaxFileBytes = 1024 * 1024;
const defaultMaxTotalBytes = 32 * 1024 * 1024;

export interface AnalysisOptions {
  readonly signal?: AbortSignal;
  readonly adapters?: readonly LanguageAdapter[];
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface AnalysisResult {
  readonly graph: GraphSnapshot;
  readonly discovery: DiscoveryResult;
  readonly analyzedFiles: number;
  readonly unsupportedFiles: number;
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Repository analysis cancelled");
    error.name = "AbortError";
    throw error;
  }
}

/** Discover source, dispatch by language, and validate the assembled graph. */
export async function analyzeRepository(directory: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  checkAbort(options.signal);
  const adapters = options.adapters ?? [new JavaScriptTypeScriptAdapter(), new PythonAdapter()];
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const maxTotalBytes = options.maxTotalBytes ?? defaultMaxTotalBytes;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive integer");
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) throw new Error("maxTotalBytes must be a positive integer");

  const discovery = await discoverRepository(directory, options.signal ? { signal: options.signal } : {});
  const repositoryId = createNodeId(discovery.root, "repository", ".");
  const inputs = new Map<LanguageAdapter, SourceFile[]>(adapters.map((adapter) => [adapter, []]));
  const diagnostics: GraphDiagnostic[] = discovery.diagnostics.map((message) => ({
    code: "DISCOVERY_NOTE", severity: "warning", message,
  }));
  let unsupportedFiles = 0;
  let readBytes = 0;

  for (const file of discovery.files) {
    checkAbort(options.signal);
    const adapter = adapters.find((candidate) => candidate.supports(file.path));
    if (!adapter) {
      unsupportedFiles += 1;
      continue;
    }
    const absolutePath = resolve(discovery.root, file.path);
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        diagnostics.push({ code: "SOURCE_CHANGED", severity: "warning", message: `Skipped changed source path: ${file.path}` });
        continue;
      }
      if (stat.size > maxFileBytes) {
        diagnostics.push({ code: "SOURCE_TOO_LARGE", severity: "warning", message: `Skipped ${file.path}: exceeds ${maxFileBytes} bytes` });
        continue;
      }
      if (readBytes + stat.size > maxTotalBytes) {
        diagnostics.push({ code: "SOURCE_LIMIT_REACHED", severity: "warning", message: `Skipped ${file.path}: analysis input exceeds ${maxTotalBytes} bytes` });
        continue;
      }
      const content = await readFile(absolutePath, { encoding: "utf8", signal: options.signal });
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > maxFileBytes) {
        diagnostics.push({ code: "SOURCE_TOO_LARGE", severity: "warning", message: `Skipped ${file.path}: grew beyond ${maxFileBytes} bytes` });
        continue;
      }
      if (readBytes + bytes > maxTotalBytes) {
        diagnostics.push({ code: "SOURCE_LIMIT_REACHED", severity: "warning", message: `Skipped ${file.path}: analysis input exceeds ${maxTotalBytes} bytes` });
        continue;
      }
      readBytes += bytes;
      inputs.get(adapter)!.push({ path: file.path, content });
    } catch (error) {
      checkAbort(options.signal);
      diagnostics.push({
        code: "SOURCE_READ_FAILED", severity: "warning",
        message: `Could not read ${file.path}: ${(error as Error).message}`,
      });
    }
  }

  const nodes: GraphSnapshot["nodes"][number][] = [{
    id: repositoryId, kind: "repository", label: basename(discovery.root),
  }];
  const edges: GraphSnapshot["edges"][number][] = [];
  let analyzedFiles = 0;
  for (const adapter of adapters) {
    checkAbort(options.signal);
    const files = inputs.get(adapter)!;
    if (files.length === 0) continue;
    const result = await adapter.analyze({ repositoryId, files }, options.signal ?? new AbortController().signal);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
    diagnostics.push(...result.diagnostics);
    analyzedFiles += files.length;
  }
  const graph: GraphSnapshot = { schemaVersion: GRAPH_SCHEMA_VERSION, repositoryId, nodes, edges, diagnostics };
  const issues = validateGraph(graph);
  if (issues.length > 0) throw new Error("Adapter graph failed validation: " + issues.map((issue) => issue.message).join("; "));
  return { graph, discovery, analyzedFiles, unsupportedFiles };
}
