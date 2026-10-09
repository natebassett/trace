import { getNeighborhood, searchSymbols } from "/query/graph-query.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const elements = Object.fromEntries([
  "repository", "summary", "search", "search-count", "results",
  "focus-heading", "show-unresolved", "graph", "graph-empty",
  "detail-title", "detail-description", "edge-list", "source-panel",
  "source-location", "source-code", "vscode-link", "error",
].map((id) => [id, document.getElementById(id)]));

let root = "";
let graph;
let focusId = null;
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
  const matches = searchSymbols(graph, elements.search.value, 50);
  elements.results.replaceChildren();
  elements["search-count"].textContent = matches.length === 50
    ? "Showing first 50 matches"
    : matches.length + (matches.length === 1 ? " symbol" : " symbols");
  for (const node of matches) {
    const button = html("button", "result" + (node.id === focusId ? " active" : ""));
    button.type = "button";

    button.title = nodeName(node) + " · " + nodePath(node);
    button.append(html("span", "result-name", nodeName(node)));
    button.append(html("span", "result-path", nodePath(node) + ":" + node.location.start.line));
    button.addEventListener("click", () => selectFocus(node.id));
    elements.results.append(button);
  }
}

function drawNode(node, x, y, width, height, focus = false) {
  const group = svg("g", { class: "node-group", tabindex: "0", role: "button", "aria-label": "Focus " + nodeName(node) });
  group.append(svg("rect", { x, y, width, height, rx: 10, class: "node-card" + (focus ? " focus" : "") }));
  const title = svg("title");
  title.textContent = nodeName(node) + (nodePath(node) ? " · " + nodePath(node) : "");
  group.append(title);
  const label = svg("text", { x: x + 13, y: y + (focus ? 34 : 20), class: "graph-label" });
  label.textContent = short(nodeName(node), focus ? 20 : 26);
  group.append(label);
  if (focus) {
    const sub = svg("text", { x: x + 13, y: y + 53, class: "graph-sub" });
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

function drawEdge(edge, x1, y1, x2, y2) {
  const line = svg("path", {
    d: "M " + x1 + " " + y1 + " C " + ((x1 + x2) / 2) + " " + y1 + ", " + ((x1 + x2) / 2) + " " + y2 + ", " + x2 + " " + y2,
    class: "edge-line " + edge.status,
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

function renderGraph() {
  if (!focusId) return;
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
  elements["show-unresolved"].addEventListener("change", () => {
    selectedEdgeId = null;
    sourceRequest += 1;
    elements["source-panel"].hidden = true;
    renderGraph();
  });
  const saved = location.hash.startsWith("#symbol=") ? decodeURIComponent(location.hash.slice(8)) : null;
  const firstConnected = graph.edges.find((edge) => edge.status !== "unresolved" && graph.nodes.some((node) => node.id === edge.from && node.kind === "symbol"));
  const firstSymbol = searchSymbols(graph, "", 1)[0];
  const initial = graph.nodes.some((node) => node.id === saved) ? saved : firstConnected?.from ?? firstSymbol?.id;
  if (initial) selectFocus(initial);
  else renderSearch();
}

main().catch((error) => showError(error.message));
