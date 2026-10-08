# Trace

Trace is a local tool for exploring how code connects. It will map function calls, shared state, and other relationships into a navigable graph, with links back to the source that supports each connection.

The project is in its initial setup stage. The first working version will provide a command-line launcher and a VS Code-compatible viewer. Relationships that cannot be resolved with certainty will be shown as possible or unresolved.

## Repository layout

Source code will live in `src/`, checks and sample projects in `tests/`, and detailed documentation in `docs/`. See the [repository layout](docs/REPOSITORY_LAYOUT.md) for the planned modules and dependency direction.

## Branches

`main` holds stable releases. Development work is integrated on `dev` through short `feature/*` and `fix/*` branches.
