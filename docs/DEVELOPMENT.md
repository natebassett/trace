# Development guide

Trace is built in small branches. Each branch should add one reviewable capability and leave the project building. You do not need to understand the whole codebase before working on one branch.

## Start work

1. Open the repository in VS Code.
2. Open a terminal in the repository folder.
3. Run `npm ci` to install the exact dependency versions in `package-lock.json`.
4. Run `npm test` to build the code and run its checks.

The current branch, `feature/workspace-foundation`, sets up these commands and a small CLI. It does not analyse code yet.

## Branch flow

- `main`: released versions.
- `dev`: completed features combined for the next release.
- `feature/<name>`: one new capability at a time.
- `fix/<name>`: a focused correction.

The usual path is `feature/*` into `dev`, then `dev` into `main` for a release. A feature is ready to integrate when its intended behaviour works, tests pass, and the documentation matches it.

## Where code belongs

- `src/core/`: graph types and rules shared by all parts of Trace.
- `src/adapters/`: language-specific source analysis.
- `src/indexer/`: repository scanning and refresh.
- `src/query/`: caller, callee, and scope questions over the graph.
- `src/viewer/`: interactive graph UI.
- `src/cli/` and `src/vscode/`: the two ways to open Trace.
- `tests/`: checks and small example repositories.

Create a folder when its first real implementation lands. [Repository layout](REPOSITORY_LAYOUT.md) explains the boundaries in more detail.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm ci` | Installs locked dependencies. |
| `npm run check` | Checks TypeScript types. |
| `npm run build` | Compiles TypeScript into the ignored `dist/` folder. |
| `npm test` | Builds and runs the automated tests. |

The next feature branch will define the language-neutral graph model: how Trace names functions and records connections, evidence, and uncertainty.
