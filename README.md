# Trace

Trace is a local tool for exploring how code connects. It will map function calls, shared state, and other relationships into a navigable graph, with links back to the source that supports each connection.

The project is in its initial setup stage. The first working version will provide a command-line launcher and a VS Code-compatible viewer. Relationships that cannot be resolved with certainty will be shown as possible or unresolved.

## Try the current foundation

Install [Node.js 20.18 or newer](https://nodejs.org/) and run these commands in the repository:

```sh
npm ci
npm test
node dist/src/cli/main.js --help
```

The CLI currently shows help and reports unsupported commands. Repository scanning and the interactive viewer will arrive in later feature branches. `npm run check` runs the TypeScript type check without producing build files.

## Repository layout

Source code lives in `src/`, checks and sample projects in `tests/`, and documentation in `docs/`. See the [repository layout](docs/REPOSITORY_LAYOUT.md) for the planned modules and dependency direction, and the [graph contract](docs/GRAPH_CONTRACT.md) for how connections are represented.

## Branches

`main` holds stable releases. Development work is integrated on `dev` through short `feature/*` and `fix/*` branches. See the [development guide](docs/DEVELOPMENT.md) for the day-to-day workflow.
