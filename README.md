# Trace

Trace is a local tool for exploring how code connects. It will map function calls, shared state, and other relationships into a navigable graph, with links back to the source that supports each connection.

Trace can inventory a repository and produce a source-backed call graph for Python, JavaScript, and TypeScript. It shows calls it cannot establish as unresolved, and Python method dispatch as possible. The interactive viewer is still to come.

## Try repository analysis

Install [Node.js 20.18 or newer](https://nodejs.org/) and run these commands in the repository:

~~~sh
npm ci
npm test
node dist/src/cli/main.js scan .
node dist/src/cli/main.js analyze .
~~~

Use another path to inspect a different project. Add `--json` to `scan` for the file inventory or to `analyze` for graph nodes, call edges, diagnostics, and source locations. Python analysis requires Python 3.10 or newer on the machine running Trace; set `TRACE_PYTHON` to a specific interpreter path if needed. See the [scanning guide](docs/SCANNING.md), [Python analysis guide](docs/PYTHON_ANALYSIS.md), and [JavaScript/TypeScript adapter guide](docs/JAVASCRIPT_TYPESCRIPT_ADAPTER.md) for current coverage. `npm run check` checks TypeScript types without producing build files.

## Repository layout

Source code lives in src/, checks and sample projects in tests/, and documentation in docs/. See the [repository layout](docs/REPOSITORY_LAYOUT.md) for the planned modules and dependency direction, and the [graph contract](docs/GRAPH_CONTRACT.md) for how connections are represented.

## Branches

main holds stable releases. Development work is integrated on dev through short feature/* and fix/* branches. See the [development guide](docs/DEVELOPMENT.md) for the day-to-day workflow.
