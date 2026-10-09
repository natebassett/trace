# Repository layout

Trace uses one `src/` tree. The CLI and VS Code extension are entry points into the same analysis engine and viewer. We can split code into independently published packages later if a real dependency or release need appears.

```text
trace/
├── README.md                 short public introduction and quick start
├── src/
│   ├── core/                 graph schema, symbol IDs, edge types, evidence
│   ├── indexer/              file discovery, scan coordination, cache, refresh
│   ├── adapters/             language and framework-specific analysers
│   │   └── javascript-typescript/   first source adapter
│   ├── query/                callers, callees, paths and scoped expansion
│   ├── explanations/         source-backed, rule-based descriptions
│   ├── viewer/               shared interactive graph and source panels
│   ├── cli/                  command and local browser host
│   └── vscode/               extension commands and embedded viewer tab
├── tests/
│   ├── unit/                 small logic tests mirroring src/ areas
│   ├── integration/          indexer, adapter, graph and CLI boundaries
│   ├── e2e/                  browser and VS Code user workflows
│   └── fixtures/             tiny sample repositories with known links
├── docs/                     architecture, guides and design decisions
├── benchmarks/               scripts for measured runs on real repositories
├── scripts/                  local development and release helpers
├── .github/workflows/        continuous integration when added
└── project configuration     package manifest, compiler and lint settings
```

## Responsibilities and dependency direction

1. `core/` defines the language-neutral graph. It does not import UI, IDE, CLI or parser code.
2. `adapters/` parse source and emit graph records with source locations and certainty. Each adapter implements the same contract.
3. `indexer/` discovers files, runs adapters, stores the graph and refreshes changed files. It never executes repository code during an ordinary scan.
4. `query/` provides bounded incoming/outgoing and scope-expansion queries over the graph. It does not know the syntax of any language.
5. `explanations/` turns established graph facts and source evidence into concise text. It cannot invent a caller or a design intention.
6. `viewer/` renders query results and sends navigation requests. It does not import `vscode/` or a language adapter.
7. `cli/` and `vscode/` supply the host environment. Both use the same viewer and graph/query contract.

The normal flow is `source files → adapters → indexer/core graph → query → viewer`. The CLI and IDE extension start that flow and host the viewer.

## Tests and documentation

- Put a focused unit test under `tests/unit/` for logic that has meaningful branches or invariants. Keep its path close to the matching `src/` area.
- Put cross-component behaviour under `tests/integration/`; reserve `tests/e2e/` for user-visible workflows.
- Keep small, deliberately constructed repositories under `tests/fixtures/`. Each fixture states the exact links expected, including uncertain and missing links.
- Use `benchmarks/` for repeatable performance runs. The dissertation project and Mavis are external test inputs, not vendored copies or sources of product requirements. Generated benchmark output stays out of Git.
- Put detailed architecture, usage and decision documents under `docs/`. The root `README.md` is the brief navigation entry point.

Create each source or test subfolder when its first real file lands. This keeps the repository free of empty placeholder directories.
