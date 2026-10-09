import { getCallFlow, getNeighborhood, searchStartPoints, suggestStartPoints } from "/query/graph-query.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const elements = Object.fromEntries([
  "repository", "summary", "search", "search-count", "results",
  "focus-heading", "show-unresolved", "graph", "graph-empty",
  "flow-mode", "direct-mode", "flow-depth", "depth-control",
  "suggestions", "suggestions-wrap", "legend-note",
  "files-list", "file-count", "file-map", "file-mode",
  "detail-title", "detail-description", "detail-explanation", "detail-actions",
  "connection-path", "connection-from", "connection-site", "connection-to",
  "edge-list", "source-panel", "source-location", "source-code", "vscode-link",
  "expand-source", "code-dialog", "code-title", "code-location", "full-code", "close-code", "error",
].map((id) => [id, document.getElementById(id)]));

let root = "";
let graph;
let files = [];
let nodeById = new Map();
let symbolsByFile = new Map();
let focusId = null;
let selectedFilePath = null;
let mode = "flow";
let selectedNodeId = null;
let selectedEdge = null;
let selectedEdgeId = null;
let sourceRequest = 0;
const sourceCache = new Map();

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function html(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined) node.textContent = textValue;
  return node;
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function short(textValue, limit) {
  return textValue.length > limit ? textValue.slice(0, limit - 1) + "…" : textValue;
}

function nodePath(node) {
  return node.location?.path ?? node.path ?? "";
}

function nodeName(node) {
  return node.qualifiedName ?? node.label;
}

function statusName(edge) {
  return edge.status.charAt(0).toUpperCase() + edge.status.slice(1);
}

function renderSummary(payload) {
  root = payload.root;
  graph = payload.graph;
  files = payload.files ?? graph.nodes.filter((node) => node.kind === "module").map((node) => node.path);
  nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  symbolsByFile = new Map();
  for (const node of graph.nodes) {
    if (node.kind !== "symbol") continue;
    const entries = symbolsByFile.get(node.location.path) ?? [];
    entries.push(node);
    symbolsByFile.set(node.location.path, entries);
  }
  for (const entries of symbolsByFile.values()) {
    entries.sort((a, b) => a.location.start.line - b.location.start.line || nodeName(a).localeCompare(nodeName(b)));
  }
  elements.repository.textContent = root;
  elements.repository.title = root;
  const symbols = graph.nodes.filter((node) => node.kind === "symbol").length;
  const resolved = graph.edges.filter((edge) => edge.status === "resolved").length;
  const possible = graph.edges.filter((edge) => edge.status === "possible").length;
  const unresolved = graph.edges.filter((edge) => edge.status === "unresolved").length;
  const entries = [
    [files.length, "files"],
    [payload.analyzedFiles, "analyzed"],
    [symbols, "symbols"],
    [resolved, "resolved"],
    [possible, "possible"],
    [unresolved, "unresolved"],
  ];
  elements.summary.replaceChildren();
  for (const [count, label] of entries) {
    const item = html("span");
    item.append(html("strong", "", String(count)), document.createTextNode(" " + label));
    elements.summary.append(item);
  }
}

function symbolsForFile(path) {
  return symbolsByFile.get(path) ?? [];
}

function renderFileList() {
  const term = elements.search.value.trim().toLocaleLowerCase();
  elements["files-list"].replaceChildren();
  let shown = 0;
  for (const path of files) {
    const symbols = symbolsForFile(path);
    if (term && !path.toLocaleLowerCase().includes(term)
      && !symbols.some((node) => nodeName(node).toLocaleLowerCase().includes(term))) continue;
    shown += 1;
    const entry = html("details", "file-entry");
    if (path === selectedFilePath) entry.open = true;
    const summary = html("summary", "", path);
    summary.title = path;
    entry.append(summary);
    const body = html("div", "file-entry-body");
    const mapButton = html("button", "file-map-button", "View file interactions");
    mapButton.type = "button";
    mapButton.addEventListener("click", () => selectFile(path));
    body.append(mapButton);
    if (symbols.length === 0) body.append(html("p", "muted", "No analyzed functions"));
    for (const node of symbols) {
      const button = html("button", "file-symbol", nodeName(node));
      button.type = "button";
      button.title = nodeName(node) + " · line " + node.location.start.line;
      button.addEventListener("click", () => {
        mode = "flow";
        updateModeControls();
        selectFocus(node.id);
      });
      body.append(button);
    }
    entry.append(body);
    elements["files-list"].append(entry);
  }
  elements["file-count"].textContent = shown + " of " + files.length;
}

function renderSearch() {
  const term = elements.search.value.trim();
  const matches = term ? searchStartPoints(graph, term, 50).filter((node) => node.kind === "symbol") : [];
  elements["suggestions-wrap"].hidden = Boolean(term);
  elements.results.replaceChildren();
  elements["search-count"].textContent = term
    ? matches.length + (matches.length === 1 ? " symbol match" : " symbol matches")
    : "Search to find a function or file";
  for (const node of matches) {
    const button = html("button", "result" + (node.id === focusId ? " active" : ""));
    button.type = "button";
    button.title = nodeName(node) + " · " + nodePath(node);
    button.append(html("span", "result-name", nodeName(node)));
    button.append(html("span", "result-path", nodePath(node) + ":" + node.location.start.line));
    button.addEventListener("click", () => {
      mode = "flow";
      updateModeControls();
      selectFocus(node.id);
    });
    elements.results.append(button);
  }
  renderFileList();
}

function renderSuggestions() {
  elements.suggestions.replaceChildren();
  for (const node of suggestStartPoints(graph, 6)) {
    const button = html("button", "result" + (node.id === focusId ? " active" : ""));
    button.type = "button";
    button.title = "Start flow at " + nodeName(node);
    button.append(html("span", "result-name", nodeName(node)));
    button.append(html("span", "result-path", nodePath(node) + (node.kind === "module" ? " · module" : "")));
    button.addEventListener("click", () => {
      mode = "flow";
      updateModeControls();
      selectFocus(node.id);
    });
    elements.suggestions.append(button);
  }
}

function drawNode(node, x, y, width, height, focus = false) {
  const group = svg("g", { class: "node-group", tabindex: "0", role: "button", "aria-label": (mode === "flow" ? "Inspect " : "Focus ") + nodeName(node) });
  group.append(svg("rect", { x, y, width, height, rx: 10, class: "node-card" + (focus ? " focus" : "") + (node.id === selectedNodeId && !focus ? " selected" : "") }));
  const title = svg("title");
  title.textContent = nodeName(node) + (nodePath(node) ? " · " + nodePath(node) : "");
  group.append(title);
  const label = svg("text", { x: x + 13, y: y + (focus && height > 60 ? 34 : 20), class: "graph-label" });
  label.textContent = short(nodeName(node), focus ? 20 : 26);
  group.append(label);
  if (focus || height > 40) {
    const sub = svg("text", { x: x + 13, y: y + (focus && height > 60 ? 53 : 36), class: "graph-sub" });
    sub.textContent = short(nodePath(node), 24);
    group.append(sub);
  }
  const activate = () => mode === "flow" ? inspectNode(node.id) : selectFocus(node.id);
  group.addEventListener("click", activate);
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  return group;
}

function drawEdge(edge, x1, y1, x2, y2, extraClass = "") {
  const line = svg("path", {
    d: "M " + x1 + " " + y1 + " C " + ((x1 + x2) / 2) + " " + y1 + ", " + ((x1 + x2) / 2) + " " + y2 + ", " + x2 + " " + y2,
    class: "edge-line " + edge.status + " " + extraClass,
    tabindex: "0",
    role: "button",
    "aria-label": "Inspect " + statusName(edge) + " call at " + edge.evidence.span.path + ":" + edge.evidence.span.start.line,
  });
  const title = svg("title");
  title.textContent = statusName(edge) + " · " + edge.evidence.span.path + ":" + edge.evidence.span.start.line;
  line.append(title);
  line.addEventListener("click", () => selectEdge(edge));
  line.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectEdge(edge);
    }
  });
  return line;
}

function drawColumn(label, entries, x, incoming, omitted) {
  const heading = svg("text", { x, y: 42, class: "graph-column-label" });
  heading.textContent = label + " · " + (entries.length + omitted);
  elements.graph.append(heading);
  entries.forEach(({ edge, neighbor }, index) => {
    const y = 67 + index * 43;
    elements.graph.append(incoming
      ? drawEdge(edge, x + 220, y + 16, 420, 325)
      : drawEdge(edge, 580, 325, x, y + 16));
    elements.graph.append(drawNode(neighbor, x, y, 220, 32));
  });
  if (omitted) {
    const more = svg("text", { x, y: 67 + entries.length * 43 + 17, class: "graph-more" });
    more.textContent = "+" + omitted + " more calls · refine your search";
    elements.graph.append(more);
  }
}

function renderEdgeList(neighborhood) {
  elements["edge-list"].replaceChildren();
  const groups = [
    ["Called by", neighborhood.incoming],
    ["Calls", neighborhood.outgoing],
  ];
  for (const [heading, entries] of groups) {
    elements["edge-list"].append(html("span", "eyebrow", heading.toUpperCase()));
    if (!entries.length) {
      elements["edge-list"].append(html("p", "muted", "No visible " + heading.toLowerCase() + " connections."));
      continue;
    }
    for (const { edge, neighbor } of entries) {
      const button = html("button", "edge-item" + (edge.id === selectedEdgeId ? " active" : ""));
      button.type = "button";
      const status = html("span", "status " + edge.status, statusName(edge));
      const title = html("strong");
      title.append(status, document.createTextNode(nodeName(neighbor)));
      button.append(title);
      button.append(html("small", "", edge.evidence.span.path + ":" + edge.evidence.span.start.line));
      button.addEventListener("click", () => selectEdge(edge));
      elements["edge-list"].append(button);
    }
  }
}

function renderFlowEdgeList(flow) {
  elements["edge-list"].replaceChildren();
  elements["edge-list"].append(html("span", "eyebrow", "FLOW CONNECTIONS"));
  if (!flow.links.length) {
    elements["edge-list"].append(html("p", "muted", "No downstream calls are known from this start. Try Show unresolved calls or choose another start."));
    return;
  }
  for (const link of flow.links) {
    for (const edge of link.calls) {
      const button = html("button", "edge-item" + (edge.id === selectedEdgeId ? " active" : ""));
      button.type = "button";
      const title = html("strong");
      title.append(html("span", "status " + edge.status, statusName(edge)));
      title.append(document.createTextNode(nodeName(link.from) + " → " + nodeName(link.to)));
      button.append(title);
      button.append(html("small", "", edge.evidence.span.path + ":" + edge.evidence.span.start.line));
      button.addEventListener("click", () => selectEdge(edge));
      elements["edge-list"].append(button);
    }
  }
}

function fileForNode(node) {
  return node ? nodePath(node) : "";
}

function visibleCalls() {
  return graph.edges.filter((edge) => edge.kind === "calls"
    && (elements["show-unresolved"].checked || edge.status !== "unresolved"));
}

function makeFileCard(path, relationships = [], primary = false) {
  const card = html("article", "file-card" + (primary ? " primary" : ""));
  const heading = html("div", "file-card-heading");
  const name = path.split("/").pop();
  heading.append(html("h3", "", name));
  heading.append(html("small", "", path));
  if (!primary) {
    const navigate = html("button", "file-card-navigate", "Focus this file →");
    navigate.type = "button";
    navigate.addEventListener("click", () => selectFile(path));
    heading.append(navigate);
  }
  card.append(heading);
  const symbols = symbolsForFile(path);
  card.append(html("span", "file-card-count", symbols.length + (symbols.length === 1 ? " symbol" : " symbols")));
  const list = html("div", "file-card-functions");
  if (symbols.length === 0) list.append(html("p", "muted", "No analyzed functions in this file."));
  for (const node of symbols) {
    const button = html("button", "file-function" + (node.id === selectedNodeId ? " active" : ""));
    button.type = "button";
    button.append(html("strong", "", nodeName(node)));
    button.append(html("small", "", node.symbolKind + " · line " + node.location.start.line));
    button.addEventListener("click", () => inspectNode(node.id));
    list.append(button);
  }
  card.append(list);
  if (relationships.length > 0) {
    const connections = html("div", "file-card-calls");
    connections.append(html("span", "eyebrow", primary ? "CALLS WITHIN FILE" : "CONNECTIONS"));
    for (const edge of relationships) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const button = html("button", "file-call" + (edge.id === selectedEdgeId ? " active" : ""));
      button.type = "button";
      button.append(html("span", "status " + edge.status, statusName(edge)));
      button.append(document.createTextNode(nodeName(from) + " → " + nodeName(to)));
      button.append(html("small", "", edge.evidence.span.path + ":" + edge.evidence.span.start.line));
      button.addEventListener("click", () => selectEdge(edge));
      connections.append(button);
    }
    card.append(connections);
  }
  return card;
}

function renderFileMap() {
  const focusNode = nodeById.get(focusId);
  const path = selectedFilePath ?? fileForNode(focusNode);
  if (!path) return;
  elements.graph.setAttribute("hidden", "");
  elements["file-map"].hidden = false;
  elements["graph-empty"].hidden = true;
  elements["legend-note"].textContent = "Each box is a file; click a function or call to inspect it.";
  elements["focus-heading"].textContent = "File map · " + path;
  const incoming = new Map();
  const outgoing = new Map();
  const internal = [];
  for (const edge of visibleCalls()) {
    const fromPath = fileForNode(nodeById.get(edge.from));
    const toPath = fileForNode(nodeById.get(edge.to));
    if (fromPath === path && toPath === path) internal.push(edge);
    else if (fromPath === path && toPath) {
      const entries = outgoing.get(toPath) ?? [];
      entries.push(edge);
      outgoing.set(toPath, entries);
    } else if (toPath === path && fromPath) {
      const entries = incoming.get(fromPath) ?? [];
      entries.push(edge);
      incoming.set(fromPath, entries);
    }
  }
  const columns = html("div", "file-columns");
  function addColumn(title, groups, focus = false) {
    const column = html("section", "file-column");
    column.append(html("h3", "file-column-title", title));
    if (focus) column.append(makeFileCard(path, internal, true));
    else if (groups.size === 0) column.append(html("p", "muted", "No visible connected files."));
    else {
      const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      for (const [otherPath, edges] of ordered) column.append(makeFileCard(otherPath, edges));
    }
    columns.append(column);
  }
  addColumn("SELECTED FILE", new Map(), true);
  addColumn("CALLS INTO THIS FILE · " + incoming.size, incoming);
  addColumn("CALLS OUT TO · " + outgoing.size, outgoing);
  elements["file-map"].replaceChildren(columns);
  elements["detail-title"].textContent = path;
  const symbolCount = symbolsForFile(path).length;
  elements["detail-description"].textContent = symbolCount + (symbolCount === 1 ? " symbol" : " symbols")
    + " · " + incoming.size + (incoming.size === 1 ? " incoming file" : " incoming files")
    + " · " + outgoing.size + (outgoing.size === 1 ? " outgoing file" : " outgoing files");
  elements["edge-list"].replaceChildren();
}

function renderFlow() {
  const flow = getCallFlow(graph, focusId, {
    depth: Number(elements["flow-depth"].value),
    maxNodes: 28,
    maxLinks: 60,
    includeUnresolved: elements["show-unresolved"].checked,
  });
  const rows = Math.max(1, ...flow.levels.map((level) => level.length));
  const width = Math.max(820, flow.levels.length * 245 + 110);
  const height = Math.max(620, rows * 66 + 120);
  elements["focus-heading"].textContent = "Flow from " + nodeName(flow.start);
  elements["graph-empty"].hidden = true;
  elements["legend-note"].textContent = "Green marks the chosen start point.";
  elements.graph.classList.add("flow");
  elements.graph.parentElement.classList.add("flow");
  elements.graph.setAttribute("viewBox", "0 0 " + width + " " + height);
  elements.graph.style.width = width + "px";
  elements.graph.style.height = height + "px";
  elements.graph.replaceChildren();
  const positions = new Map();
  flow.levels.forEach((level, depth) => {
    const x = 55 + depth * 245;
    const heading = svg("text", { x, y: 39, class: "graph-column-label" + (depth === 0 ? " start-caption" : "") });
    heading.textContent = depth === 0 ? "START" : "STEP " + depth;
    elements.graph.append(heading);
    const top = Math.max(75, (height - level.length * 66) / 2);
    level.forEach((node, index) => positions.set(node.id, { x, y: top + index * 66, depth }));
  });
  for (const link of flow.links) {
    const from = positions.get(link.from.id);
    const to = positions.get(link.to.id);
    const backwards = to.depth <= from.depth;
    elements.graph.append(drawEdge(
      link.calls[0],
      backwards ? from.x : from.x + 190,
      from.y + 24,
      backwards ? to.x + 190 : to.x,
      to.y + 24,
      backwards ? "cycle" : "",
    ));
    if (link.calls.length > 1) {
      const count = svg("text", { x: (from.x + to.x + 190) / 2, y: (from.y + to.y) / 2 + 18, class: "flow-count" });
      count.textContent = "×" + link.calls.length;
      elements.graph.append(count);
    }
  }
  for (const level of flow.levels) {
    for (const node of level) {
      const position = positions.get(node.id);
      elements.graph.append(drawNode(node, position.x, position.y, 190, 48, node.id === flow.start.id));
    }
  }
  const nodeCount = flow.levels.reduce((total, level) => total + level.length, 0);
  elements["detail-title"].textContent = "Start: " + nodeName(flow.start);
  elements["detail-description"].textContent = nodeCount + " nodes · " + flow.links.length + " connections · " + flow.levels.length + " levels"
    + (flow.omittedNodes || flow.omittedLinks ? " · some hidden by view limits" : "");
  renderFlowEdgeList(flow);
}

function updateModeControls() {
  elements["flow-mode"].classList.toggle("active", mode === "flow");
  elements["direct-mode"].classList.toggle("active", mode === "nearby");
  elements["file-mode"].classList.toggle("active", mode === "files");
  elements["depth-control"].hidden = mode !== "flow";
}

function setMode(nextMode) {
  if (nextMode === "files") {
    selectFile(selectedFilePath ?? fileForNode(nodeById.get(focusId)));
    return;
  }
  mode = nextMode;
  selectedEdge = null;
  selectedEdgeId = null;
  if (!focusId) {
    const fallback = graph.nodes.find((node) => node.kind === "module" && node.path === selectedFilePath)
      ?? symbolsForFile(selectedFilePath)[0] ?? suggestStartPoints(graph, 1)[0];
    if (fallback) {
      updateModeControls();
      selectFocus(fallback.id);
      return;
    }
  }
  if (focusId) history.replaceState(null, "", "#symbol=" + encodeURIComponent(focusId));
  updateModeControls();
  renderGraph();
}

function renderGraph() {
  if (!focusId && mode !== "files") return;
  if (mode === "files") {
    elements.graph.parentElement.classList.remove("flow");
    renderFileMap();
    renderInspector();
    return;
  }
  elements.graph.removeAttribute("hidden");
  elements["file-map"].hidden = true;
  if (mode === "flow") {
    renderFlow();
    renderInspector();
    return;
  }
  elements.graph.classList.remove("flow");
  elements.graph.parentElement.classList.remove("flow");
  elements.graph.setAttribute("viewBox", "0 0 1000 650");
  elements.graph.style.width = "";
  elements.graph.style.height = "";
  elements["legend-note"].textContent = "Click a connected node to follow it.";
  const neighborhood = getNeighborhood(graph, focusId, {
    includeUnresolved: elements["show-unresolved"].checked,
    perDirectionLimit: 12,
  });
  const focus = neighborhood.focus;
  elements["focus-heading"].textContent = nodeName(focus);
  elements["graph-empty"].hidden = true;
  elements.graph.replaceChildren();
  drawColumn("CALLERS", neighborhood.incoming, 50, true, neighborhood.omittedIncoming);
  drawColumn("CALLEES", neighborhood.outgoing, 730, false, neighborhood.omittedOutgoing);
  elements.graph.append(drawNode(focus, 420, 287, 160, 76, true));
  if (neighborhood.incoming.length + neighborhood.outgoing.length === 0) {
    const empty = svg("text", { x: 500, y: 410, "text-anchor": "middle", class: "graph-more" });
    empty.textContent = "No visible calls. Try showing unresolved calls.";
    elements.graph.append(empty);
  }
  elements["detail-title"].textContent = nodeName(focus);
  elements["detail-description"].textContent = nodePath(focus) + (focus.location ? ":" + focus.location.start.line : "");
  renderEdgeList(neighborhood);
  renderInspector();
}

function selectFocus(id) {
  focusId = id;
  selectedFilePath = fileForNode(nodeById.get(id));
  selectedNodeId = id;
  selectedEdge = null;
  selectedEdgeId = null;
  history.replaceState(null, "", "#symbol=" + encodeURIComponent(id));
  renderSearch();
  renderSuggestions();
  renderGraph();
}

function selectFile(path) {
  selectedFilePath = path;
  history.replaceState(null, "", "#file=" + encodeURIComponent(path));
  selectedNodeId = null;
  selectedEdge = null;
  selectedEdgeId = null;
  mode = "files";
  updateModeControls();
  renderSearch();
  renderGraph();
}

function inspectNode(id) {
  selectedNodeId = id;
  selectedEdge = null;
  selectedEdgeId = null;
  renderGraph();
}

function selectEdge(edge) {
  selectedEdge = edge;
  selectedEdgeId = edge.id;
  selectedNodeId = null;
  renderGraph();
}

function setSourceLink(path, line, column = 1) {
  const absolutePath = root.replace(/[\\/]$/, "") + "/" + path;
  elements["vscode-link"].href = "vscode://file/" + encodeURI(absolutePath.replace(/\\/g, "/")) + ":" + line + ":" + column;
}

function sourceLines(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function formatLines(lines, start, end, highlight = null) {
  const width = String(end).length;
  return lines.slice(start - 1, end).map((line, index) => {
    const number = start + index;
    return (number === highlight ? "› " : "  ") + String(number).padStart(width) + "  " + line;
  }).join("\n");
}

function nodeRange(node, lineCount) {
  if (!node.location) return { start: 1, end: lineCount };
  const start = Math.max(1, Math.min(node.location.start.line, lineCount));
  const exclusiveEnd = node.location.end.line - (node.location.end.column === 1 ? 1 : 0);
  const end = Math.max(start, Math.min(exclusiveEnd, lineCount));
  return { start, end };
}

async function loadSource(path) {
  if (!sourceCache.has(path)) {
    const promise = fetch("/api/source?path=" + encodeURIComponent(path)).then(async (response) => {
      if (!response.ok) throw new Error("Source is no longer available (" + response.status + ")");
      return (await response.json()).content;
    });
    sourceCache.set(path, promise);
  }
  try {
    return await sourceCache.get(path);
  } catch (error) {
    sourceCache.delete(path);
    throw error;
  }
}

async function openFullCode(node) {
  const path = node && fileForNode(node);
  if (!path || (node.kind !== "symbol" && node.kind !== "module")) return;
  elements["code-title"].textContent = nodeName(node);
  elements["code-location"].textContent = path;
  elements["full-code"].textContent = "Loading source…";
  if (!elements["code-dialog"].open) elements["code-dialog"].showModal();
  try {
    const content = await loadSource(path);
    if (!elements["code-dialog"].open) return;
    const lines = sourceLines(content);
    const range = nodeRange(node, lines.length);
    elements["code-location"].textContent = path + " · lines " + range.start + "–" + range.end;
    elements["full-code"].textContent = formatLines(lines, range.start, range.end);
  } catch (error) {
    if (elements["code-dialog"].open) elements["full-code"].textContent = error.message;
  }
}

async function renderSourcePreview(path, line, column, request, fullNode = null) {
  elements["source-panel"].hidden = false;
  elements["source-location"].textContent = path + ":" + line;
  elements["source-code"].textContent = "Loading source…";
  setSourceLink(path, line, column);
  elements["expand-source"].hidden = !fullNode;
  elements["expand-source"].textContent = fullNode?.kind === "module" ? "Expand full file" : "Expand full function";
  elements["expand-source"].onclick = fullNode ? () => openFullCode(fullNode) : null;
  try {
    const content = await loadSource(path);
    if (request !== sourceRequest) return;
    const lines = sourceLines(content);
    const start = Math.max(1, line - 2);
    const end = Math.min(lines.length, line + 4);
    elements["source-code"].textContent = formatLines(lines, start, end, line);
  } catch (error) {
    if (request === sourceRequest) elements["source-code"].textContent = error.message;
  }
}

function addDetailAction(label, action) {
  const button = html("button", "", label);
  button.type = "button";
  button.addEventListener("click", action);
  elements["detail-actions"].append(button);
}

function renderInspector() {
  const request = ++sourceRequest;
  elements["detail-explanation"].hidden = true;
  elements["connection-path"].hidden = true;
  elements["detail-actions"].replaceChildren();
  elements["detail-actions"].hidden = true;
  elements["source-panel"].hidden = true;
  if (selectedEdge) {
    const edge = selectedEdge;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    const site = edge.evidence.span.path + ":" + edge.evidence.span.start.line + ":" + edge.evidence.span.start.column;
    elements["detail-title"].textContent = nodeName(from) + " → " + nodeName(to);
    elements["detail-description"].textContent = statusName(edge) + " call · " + site;
    const reason = edge.status === "resolved"
      ? "Trace matched this call to one source-backed definition. The call may run only on some program paths."
      : edge.status === "possible"
        ? "Trace found a source-backed candidate. Runtime dispatch or reassignment could change the actual target."
        : edge.status === "observed"
          ? "This connection was recorded during a program run."
          : "Trace found the call site but could not identify its target from the analyzed source.";
    elements["detail-explanation"].textContent = reason;
    elements["detail-explanation"].hidden = false;
    elements["connection-from"].textContent = nodeName(from) + " · " + fileForNode(from);
    elements["connection-site"].textContent = site;
    elements["connection-to"].textContent = nodeName(to) + " · " + fileForNode(to);
    elements["connection-path"].hidden = false;
    if (from.kind === "symbol" || from.kind === "module") addDetailAction("Full caller code", () => openFullCode(from));
    if (to.kind === "symbol" || to.kind === "module") addDetailAction("Full target code", () => openFullCode(to));
    elements["detail-actions"].hidden = elements["detail-actions"].children.length === 0;
    void renderSourcePreview(edge.evidence.span.path, edge.evidence.span.start.line,
      edge.evidence.span.start.column, request, from.kind === "symbol" || from.kind === "module" ? from : null);
    return;
  }
  const node = selectedNodeId ? nodeById.get(selectedNodeId) : null;
  if (!node) return;
  const path = fileForNode(node);
  const line = node.location?.start.line ?? 1;
  elements["detail-title"].textContent = nodeName(node);
  elements["detail-description"].textContent = path + (node.location ? ":" + line : " · file");
  const incoming = visibleCalls().filter((edge) => edge.to === node.id).length;
  const outgoing = visibleCalls().filter((edge) => edge.from === node.id).length;
  elements["detail-explanation"].textContent = outgoing + " calls from this node · " + incoming
    + " calls into it. Expand the source to read the complete " + (node.kind === "module" ? "file." : "definition.");
  elements["detail-explanation"].hidden = false;
  if (node.id !== focusId || mode === "files") {
    addDetailAction("Trace from here", () => {
      mode = "flow";
      updateModeControls();
      selectFocus(node.id);
    });
    elements["detail-actions"].hidden = false;
  }
  if (path && (node.kind === "symbol" || node.kind === "module")) {
    void renderSourcePreview(path, line, node.location?.start.column ?? 1, request, node);
  }
}

async function main() {
  const response = await fetch("/api/graph");
  if (!response.ok) throw new Error("Graph failed to load (" + response.status + ")");
  renderSummary(await response.json());
  elements.search.addEventListener("input", renderSearch);
  elements["flow-mode"].addEventListener("click", () => setMode("flow"));
  elements["direct-mode"].addEventListener("click", () => setMode("nearby"));
  elements["file-mode"].addEventListener("click", () => setMode("files"));
  elements["close-code"].addEventListener("click", () => elements["code-dialog"].close());
  elements["flow-depth"].addEventListener("change", renderGraph);
  elements["show-unresolved"].addEventListener("change", () => {
    selectedEdge = null;
    selectedEdgeId = null;
    renderGraph();
  });
  const saved = location.hash.startsWith("#symbol=") ? decodeURIComponent(location.hash.slice(8)) : null;
  const savedFile = location.hash.startsWith("#file=") ? decodeURIComponent(location.hash.slice(6)) : null;
  const firstConnected = graph.edges.find((edge) => edge.status !== "unresolved" && graph.nodes.some((node) => node.id === edge.from && node.kind === "symbol"));
  const suggested = suggestStartPoints(graph, 1)[0];
  const firstSymbol = searchStartPoints(graph, "", 1)[0];
  const initial = graph.nodes.some((node) => node.id === saved) ? saved : suggested?.id ?? firstConnected?.from ?? firstSymbol?.id;
  updateModeControls();
  if (savedFile && files.includes(savedFile)) selectFile(savedFile);
  else if (initial) selectFocus(initial);
  else if (files.length > 0) selectFile(files[0]);
  else {
    renderSearch();
    renderSuggestions();
  }
}

main().catch((error) => showError(error.message));
