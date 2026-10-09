# Local graph viewer

Build Trace, then run `view` from the Trace repository:

```powershell
npm run build
node dist/src/cli/main.js view "C:/path/to/project"
```

Trace prints a `http://127.0.0.1:.../` address. Open it in a browser. Keep the terminal running while using the viewer; Ctrl+C stops the local server. The page shows the repository-wide file, symbol, and call counts.

The **Files** list contains every discovered repository file. Expand a file to see all its analyzed symbols, then choose **View file interactions**. **File map** puts the selected file's functions and methods in one box, with module-level variables listed beneath the filename. Other boxes show files that call into it or receive calls from it. Calls between functions in the selected file appear inside its box. Each connection names the caller, target, status, and call-site line. Click **Focus this file** in a connected box to navigate there. Files without supported source analysis remain listed but have no function relationships.

Choose a suggested start or search for a module, function, method, or class. **Flow from start** follows calls downstream across several function levels. It groups reached functions inside file boxes and draws call arrows within and between those files. Module-level variables appear beneath each filename. The green card is the selected start; each next column shows the first step at which a file is reached. Change **Depth** to show two through five steps. Clicking a function in this view inspects it while keeping the chosen start. Use **Trace from here** to make that function the new start. Suggested starts are name-based candidates, so choose the one that matches the program path you want to follow.

Click a function to preview its source. In **Flow from start**, choose **+ expand code** or double-click its card to show the complete definition inside the graph; scroll within the card for longer functions. Right-click a card for expand, full-source, and trace actions. The source panel also has **Expand full function** to open a larger code view. Modules have **Expand full file**. Clicking a connection shows the caller, call site, target, and why Trace assigned its status. **Full caller code** and **Full target code** open either side of that connection. The **Open in VS Code** link asks the browser to open the source line in VS Code.

**Nearby calls** shows the direct callers and callees of the selected node. Click a connected node to focus it. It shows at most 12 calls in each direction. Flow view shows at most 28 nodes and 60 connections and tells you when it omits more. Repeated call sites between the same two functions share one visual connection but remain individually inspectable in the evidence list. Cycles link back to the existing node.

Resolved calls have a source-backed name target. Possible calls include Python instance and method inference where runtime dispatch could change the target. Unresolved calls are hidden initially; enable **Show unresolved calls** to include them. Global variables shown here are module-level bindings from Python assignments and JavaScript/TypeScript variable declarations; Trace does not currently draw data-read or data-write connections to them. The graph is a static source analysis, so it does not establish a single runtime path or execution order. Use `node dist/src/cli/main.js analyze [directory] --json` to get every graph node, edge, and diagnostic.

The viewer analyzes the repository once when it starts. Restart `view` after source changes. It reads supported source files locally and serves the graph and source evidence only on the loopback address; it does not execute the analyzed project or upload its source. The browser viewer is the first host for the shared graph UI. A VS Code extension tab and deeper graph navigation are later features.
