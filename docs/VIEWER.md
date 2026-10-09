# Local graph viewer

Build Trace, then run `view` from the Trace repository:

```powershell
npm run build
node dist/src/cli/main.js view "C:/path/to/project"
```

Trace prints a `http://127.0.0.1:.../` address. Open it in a browser. Keep the terminal running while using the viewer; Ctrl+C stops the local server. The page shows the repository-wide file, symbol, and call counts.

Search for a function, method, or class by name or source path, then select it. The graph shows direct callers on the left and direct callees on the right. Click a connected node to focus it. Click a call or its entry in the right panel to see its status, source location, and nearby source lines. The **Open in VS Code** link asks the browser to open that line in VS Code.

Each view shows at most 12 calls in each direction. The remaining count appears below the column. Unresolved calls are hidden initially; enable **Show unresolved calls** to include them. This keeps larger repositories usable while preserving uncertainty. Use `node dist/src/cli/main.js analyze [directory] --json` to get every graph node, edge, and diagnostic.

The viewer analyzes the repository once when it starts. Restart `view` after source changes. It reads supported source files locally and serves the graph and source evidence only on the loopback address; it does not execute the analyzed project or upload its source. The browser viewer is the first host for the shared graph UI. A VS Code extension tab and deeper graph navigation are later features.
