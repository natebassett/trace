# Local graph viewer

Build Trace, then run `view` from the Trace repository:

```powershell
npm run build
node dist/src/cli/main.js view "C:/path/to/project"
```

Trace prints a `http://127.0.0.1:.../` address. Open it in a browser. Keep the terminal running while using the viewer; Ctrl+C stops the local server. The page shows the repository-wide file, symbol, and call counts.

Choose a suggested start or search for a module, function, method, or class. **Flow from start** follows calls downstream across several function levels. The green node is the selected start; each next column is one call step. Change **Depth** to show two through five steps. Click a connection or its entry in **Source evidence** to inspect the call status, source location, and nearby code. The **Open in VS Code** link asks the browser to open that line in VS Code. Suggested starts are name-based candidates, so choose the one that matches the program path you want to follow.

**Nearby calls** shows the direct callers and callees of the selected node. Click a connected node to focus it. It shows at most 12 calls in each direction. Flow view shows at most 28 nodes and 60 connections and tells you when it omits more. Repeated call sites between the same two functions share one visual connection but remain individually inspectable in the evidence list. Cycles link back to the existing node.

Resolved calls have a source-backed name target. Possible calls include Python instance and method inference where runtime dispatch could change the target. Unresolved calls are hidden initially; enable **Show unresolved calls** to include them. The graph is a static source analysis, so it does not establish a single runtime path or execution order. Use `node dist/src/cli/main.js analyze [directory] --json` to get every graph node, edge, and diagnostic.

The viewer analyzes the repository once when it starts. Restart `view` after source changes. It reads supported source files locally and serves the graph and source evidence only on the loopback address; it does not execute the analyzed project or upload its source. The browser viewer is the first host for the shared graph UI. A VS Code extension tab and deeper graph navigation are later features.
