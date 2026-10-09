import { spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgeId, createNodeId } from "../../core/ids.js";
import type { GraphDiagnostic, GraphEdge, GraphNode, SourceSpan } from "../../core/graph.js";
import type { AdapterInput, AdapterResult, LanguageAdapter, SourceFile } from "../adapter.js";

interface PythonDefinition {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: "class" | "function" | "method";
  readonly parentKey: string | null;
  readonly span: SourceSpan;
}

interface PythonGlobal {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly span: SourceSpan;
}

interface PythonCall {
  readonly path: string;
  readonly callerKey: string | null;
  readonly targetKey: string | null;
  readonly status: "resolved" | "possible" | "unresolved";
  readonly expression: string;
  readonly span: SourceSpan;
}

interface PythonFacts {
  readonly definitions: readonly PythonDefinition[];
  readonly globals: readonly PythonGlobal[];
  readonly calls: readonly PythonCall[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error("Python analysis cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function validPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !/^[a-zA-Z]:/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function parseWith(executable: string, files: readonly SourceFile[], signal: AbortSignal): Promise<PythonFacts> {
  const script = fileURLToPath(new URL("./parse.py", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-I", "-S", "-B", script], {
      stdio: ["pipe", "pipe", "pipe"], signal, windowsHide: true,
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    const maxOutputBytes = 64 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal.aborted) {
        const error = new Error("Python analysis cancelled");
        error.name = "AbortError";
        reject(error);
        return;
      }
      if (outputBytes > maxOutputBytes) {
        reject(new Error("Python parser output exceeded 64 MiB"));
      } else if (code !== 0) {
        reject(new Error("Python parser failed: " + Buffer.concat(errors).toString("utf8").trim()));
      } else {
        try {
          resolve(JSON.parse(Buffer.concat(output).toString("utf8")) as PythonFacts);
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.on("error", () => { /* Process errors are reported by close or error. */ });
    child.stdin.end(JSON.stringify({ files }));
  });
}

async function parsePython(files: readonly SourceFile[], signal: AbortSignal): Promise<PythonFacts> {
  const candidates = process.env.TRACE_PYTHON
    ? [process.env.TRACE_PYTHON]
    : process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const executable of candidates) {
    abortIfNeeded(signal);
    try {
      return await parseWith(executable, files, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Python 3.10 or newer is required for .py analysis; set TRACE_PYTHON to its executable path");
}

/** Python AST analysis; the scanned project is never imported or executed. */
export class PythonAdapter implements LanguageAdapter {
  readonly id = "python";
  readonly version = "3";
  readonly languageIds = ["python"] as const;

  supports(path: string): boolean {
    return path.endsWith(".py");
  }

  async analyze(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    abortIfNeeded(signal);
    const files = input.files.filter((file) => this.supports(file.path));
    const paths = new Set<string>();
    for (const file of files) {
      if (!validPath(file.path)) throw new Error("Invalid repository-relative Python path: " + file.path);
      if (paths.has(file.path)) throw new Error("Duplicate Python path: " + file.path);
      paths.add(file.path);
    }
    if (files.length === 0) return { nodes: [], edges: [], diagnostics: [] };

    const facts = await parsePython(files, signal);
    abortIfNeeded(signal);
    const nodes: GraphNode[] = files.map((file) => ({
      id: createNodeId(input.repositoryId, "module", file.path),
      kind: "module",
      label: basename(file.path),
      parentId: input.repositoryId,
      path: file.path,
      languageId: "python",
    }));
    const definitionIds = new Map(facts.definitions.map((definition) => [
      definition.key, createNodeId(input.repositoryId, "symbol", definition.key),
    ]));
    for (const definition of facts.definitions) {
      nodes.push({
        id: definitionIds.get(definition.key)!,
        kind: "symbol",
        label: definition.name,
        parentId: definition.parentKey
          ? definitionIds.get(definition.parentKey)!
          : createNodeId(input.repositoryId, "module", definition.path),
        qualifiedName: definition.qualifiedName,
        symbolKind: definition.kind,
        location: definition.span,
      });
    }

    for (const global of facts.globals) {
      nodes.push({
        id: createNodeId(input.repositoryId, "state", global.key),
        kind: "state",
        label: global.name,
        parentId: createNodeId(input.repositoryId, "module", global.path),
        stateKind: "global",
        location: global.span,
      });
    }

    const edges: GraphEdge[] = [];
    const diagnostics: GraphDiagnostic[] = [...facts.diagnostics];
    for (const call of facts.calls) {
      const from = call.callerKey
        ? definitionIds.get(call.callerKey)!
        : createNodeId(input.repositoryId, "module", call.path);
      const knownTarget = call.targetKey ? definitionIds.get(call.targetKey) : undefined;
      const status = knownTarget ? call.status : "unresolved";
      const to = knownTarget ?? createNodeId(
        input.repositoryId, "boundary",
        `${call.path}::call@${call.span.start.line}:${call.span.start.column}-${call.span.end.line}:${call.span.end.column}`,
      );
      if (!knownTarget) {
        nodes.push({
          id: to, kind: "boundary", label: call.expression + " target",
          parentId: createNodeId(input.repositoryId, "module", call.path),
          boundaryKind: "unresolved", location: call.span,
        });
        diagnostics.push({
          code: "UNRESOLVED_CALL", severity: "warning",
          message: "Python call target cannot be established from the supplied source: " + call.expression,
          location: call.span,
        });
      }
      edges.push({
        id: createEdgeId(input.repositoryId, "calls", from, to, call.span),
        from, to, kind: "calls", status,
        evidence: {
          span: call.span, adapterId: this.id,
          method: status === "resolved" ? "python-name" : status === "possible" ? "python-possible-call" : "python-unresolved",
        },
      });
    }
    return { nodes, edges, diagnostics };
  }
}
