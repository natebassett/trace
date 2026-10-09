import { lstat, readFile, realpath } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AnalysisResult } from "../indexer/analyze.js";

export interface ViewerHandle {
  readonly url: string;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Viewer did not receive a TCP port"));
        return;
      }
      resolvePort(address.port);
    });
  });
}

/** Serve one validated graph and local source evidence on loopback only. */
export async function startViewer(result: AnalysisResult): Promise<ViewerHandle> {
  const assets = new Map<string, { type: string; body: string }>([
    ["/", { type: "text/html; charset=utf-8", body: await readFile(new URL("../viewer/index.html", import.meta.url), "utf8") }],
    ["/assets/app.js", { type: "text/javascript; charset=utf-8", body: await readFile(new URL("../viewer/app.js", import.meta.url), "utf8") }],
    ["/assets/style.css", { type: "text/css; charset=utf-8", body: await readFile(new URL("../viewer/style.css", import.meta.url), "utf8") }],
    ["/query/graph-query.js", { type: "text/javascript; charset=utf-8", body: await readFile(new URL("../query/graph-query.js", import.meta.url), "utf8") }],
  ]);
  const realRoot = await realpath(result.discovery.root);
  const graphBody = JSON.stringify({
    root: result.discovery.root,
    analyzedFiles: result.analyzedFiles,
    unsupportedFiles: result.unsupportedFiles,
    graph: result.graph,
  });
  const allowedSourcePaths = new Set(result.graph.nodes
    .filter((node) => node.kind === "module")
    .map((node) => node.path));
  let port = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "GET") {
      send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
      return;
    }
    if (request.headers.host !== "127.0.0.1:" + port) {
      send(response, 403, "text/plain; charset=utf-8", "Invalid host");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1:" + port);
    const asset = assets.get(url.pathname);
    if (asset) {
      send(response, 200, asset.type, asset.body);
      return;
    }
    if (url.pathname === "/api/graph") {
      send(response, 200, "application/json; charset=utf-8", graphBody);
      return;
    }
    if (url.pathname === "/api/source") {
      const path = url.searchParams.get("path");
      if (!path || !allowedSourcePaths.has(path)) {
        send(response, 404, "text/plain; charset=utf-8", "Source file was not analyzed");
        return;
      }
      try {
        const absolutePath = resolve(result.discovery.root, path);
        const realSource = await realpath(absolutePath);
        const relativeSource = relative(realRoot, realSource);
        if (relativeSource === ".." || relativeSource.startsWith(".." + sep) || isAbsolute(relativeSource)) {
          send(response, 403, "text/plain; charset=utf-8", "Source path escaped repository");
          return;
        }
        const stat = await lstat(absolutePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
          send(response, 409, "text/plain; charset=utf-8", "Source file changed after analysis");
          return;
        }
        const content = await readFile(absolutePath, "utf8");
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ path, content }));
      } catch {
        send(response, 404, "text/plain; charset=utf-8", "Source file is unavailable");
      }
      return;
    }
    send(response, 404, "text/plain; charset=utf-8", "Not found");
  });
  port = await listen(server);
  return {
    url: "http://127.0.0.1:" + port + "/",
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  };
}
