import { getCallFlow, getNeighborhood, searchStartPoints, suggestStartPoints } from "/query/graph-query.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const elements = Object.fromEntries([
  "repository", "summary", "search", "search-count", "results",
  "focus-heading", "show-unresolved", "graph", "graph-empty",
  "flow-mode", "direct-mode", "flow-depth", "depth-control",
  "suggestions", "suggestions-wrap", "legend-note",
  "detail-title", "detail-description", "edge-list", "source-panel",
  "source-location", "source-code", "vscode-link", "error",
].map((id) => [id, document.getElementById(id)]));

let root = "";
let graph;
let focusId = null;
let mode = "flow";
let selectedEdgeId = null;
let sourceRequest = 0;

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
  elements.repository.textContent = root;
  elements.repository.title = root;
  const symbols = graph.nodes.filter((node) => node.kind === "symbol").length;
  const resolved = graph.edges.filter((edge) => edge.status === "resolved").length;
  const possible = graph.edges.filter((edge) => edge.status === "possible").length;
  const unresolved = graph.edges.filter((edge) => edge.status === "unresolved").length;
  const entries = [
    [payload.analyzedFiles, "files"],
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

function renderSearch() {
  const matches = searchStartPoints(graph, elements.search.value, 50);
  elements["suggestions-wrap"].hidden = Boolean(elements.search.value.trim());
  elements.results.replaceChildren();
  elements["search-count"].textContent = matches.length === 50
    ? "Showing first 50 matches"
    : matches.length + (matches.length === 1 ? " match" : " matches");
  for (const node of matches) {
    const button = html("button", "result" + (node.id === focusId ? " active" : ""));
    button.type = "button";

    button.title = nodeName(node) + " · " + nodePath(node);
    button.append(html("span", "result-name", nodeName(node)));
    button.append(html("span", "result-path", nodePath(node) + (node.location ? ":" + node.location.start.line : " · module")));
    button.addEventListener("click", () => selectFocus(node.id));
    elements.results.append(button);
  }
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
  const group = svg("g", { class: "node-group", tabindex: "0", role: "button", "aria-label": "Focus " + nodeName(node) });
  group.append(svg("rect", { x, y, width, height, rx: 10, class: "node-card" + (focus ? " focus" : "") }));
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
  group.addEventListener("click", () => selectFocus(node.id));
  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFocus(node.id);
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
  elements["depth-control"].hidden = mode !== "flow";
}

function setMode(nextMode) {
  mode = nextMode;
  selectedEdgeId = null;
  sourceRequest += 1;
  elements["source-panel"].hidden = true;
  updateModeControls();
  renderGraph();
}

function renderGraph() {
  if (!focusId) return;
  if (mode === "flow") {
    renderFlow();
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
}

function selectFocus(id) {
  focusId = id;
  selectedEdgeId = null;
  sourceRequest += 1;
  elements["source-panel"].hidden = true;
  history.replaceState(null, "", "#symbol=" + encodeURIComponent(id));
  renderSearch();
  renderSuggestions();
  renderGraph();
}

async function selectEdge(edge) {
  selectedEdgeId = edge.id;
  const currentRequest = ++sourceRequest;
  renderGraph();
  const span = edge.evidence.span;
  elements["detail-title"].textContent = statusName(edge) + " call";
  elements["detail-description"].textContent = span.path + ":" + span.start.line + " · " + edge.evidence.method;
  elements["source-panel"].hidden = false;
  elements["source-location"].textContent = span.path + ":" + span.start.line;
  elements["source-code"].textContent = "Loading source…";
  const absolutePath = root.replace(/[\\/]$/, "") + "/" + span.path;
  elements["vscode-link"].href = "vscode://file/" + encodeURI(absolutePath.replace(/\\/g, "/")) + ":" + span.start.line + ":" + span.start.column;
  try {
    const response = await fetch("/api/source?path=" + encodeURIComponent(span.path));
    if (!response.ok) throw new Error("Source is no longer available (" + response.status + ")");
    const data = await response.json();
    if (currentRequest !== sourceRequest) return;
    const lines = data.content.split(/\r?\n/);
    const start = Math.max(1, span.start.line - 3);
    const end = Math.min(lines.length, span.start.line + 3);
    elements["source-code"].textContent = lines.slice(start - 1, end).map((line, index) => {
      const number = start + index;
      return (number === span.start.line ? "› " : "  ") + String(number).padStart(4) + "  " + line;
    }).join("\n");
  } catch (error) {
    if (currentRequest === sourceRequest) elements["source-code"].textContent = error.message;
  }
}

async function main() {
  const response = await fetch("/api/graph");
  if (!response.ok) throw new Error("Graph failed to load (" + response.status + ")");
  renderSummary(await response.json());
  elements.search.addEventListener("input", renderSearch);
  elements["flow-mode"].addEventListener("click", () => setMode("flow"));
  elements["direct-mode"].addEventListener("click", () => setMode("nearby"));
  elements["flow-depth"].addEventListener("change", renderGraph);
  elements["show-unresolved"].addEventListener("change", () => {
    selectedEdgeId = null;
    sourceRequest += 1;
    elements["source-panel"].hidden = true;
    renderGraph();
  });
  const saved = location.hash.startsWith("#symbol=") ? decodeURIComponent(location.hash.slice(8)) : null;
  const firstConnected = graph.edges.find((edge) => edge.status !== "unresolved" && graph.nodes.some((node) => node.id === edge.from && node.kind === "symbol"));
  const suggested = suggestStartPoints(graph, 1)[0];
  const firstSymbol = searchStartPoints(graph, "", 1)[0];
  const initial = graph.nodes.some((node) => node.id === saved) ? saved : suggested?.id ?? firstConnected?.from ?? firstSymbol?.id;
  updateModeControls();
  if (initial) selectFocus(initial);
  else {
    renderSearch();
    renderSuggestions();
  }
}

main().catch((error) => showError(error.message));
