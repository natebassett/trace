# Trace

Trace is a local tool for exploring how code connects. It will map function calls, shared state, and other relationships into a navigable graph, with links back to the source that supports each connection.

Trace currently has a read-only repository inventory and a JavaScript/TypeScript analysis adapter. The adapter identifies named functions and source-backed direct calls, including calls it cannot safely resolve. The CLI still reports only the file inventory; graph output and the interactive viewer are later features.

## Try the repository scan

Install [Node.js 20.18 or newer](https://nodejs.org/) and run these commands in the repository:

~~~sh
npm ci
npm test
node dist/src/cli/main.js scan .
~~~

Use another path to scan a different project. Add --json to obtain all included files, their likely languages, and skipped paths. See the [scanning guide](docs/SCANNING.md) for the current CLI rules and the [JavaScript/TypeScript adapter guide](docs/JAVASCRIPT_TYPESCRIPT_ADAPTER.md) for current analysis coverage. The npm run check command checks TypeScript types without producing build files.

## Repository layout

Source code lives in src/, checks and sample projects in tests/, and documentation in docs/. See the [repository layout](docs/REPOSITORY_LAYOUT.md) for the planned modules and dependency direction, and the [graph contract](docs/GRAPH_CONTRACT.md) for how connections are represented.

## Branches

main holds stable releases. Development work is integrated on dev through short feature/* and fix/* branches. See the [development guide](docs/DEVELOPMENT.md) for the day-to-day workflow.
