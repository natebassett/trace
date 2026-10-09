# Graph contract

The graph is the common language between Trace's analysers, indexer, queries, CLI, and viewer. It describes what the source shows without assuming that every possible runtime path is known.

## A small example

```text
                 calls (resolved) ──→ load
start ─────────── calls (resolved) ──→ save
                 calls (unresolved) → handler target (boundary)
```

The [branching fixture](../tests/fixtures/graph-contract/branching.json) contains this exact graph. The two known calls point to functions. The indirect `handler()` call points to an unresolved boundary and has a diagnostic. Each arrow has a source location and records how it was found.

## Nodes and arrows

A node is a repository, package, module, symbol, shared state item, or boundary. A boundary represents an external, unresolved, or unsupported target. Containment uses `parentId`; it is separate from runtime relationships.

An arrow has a direction, relationship kind, status, and evidence. Current relationship kinds cover calls, imports, exports, state reads and writes, event links, and external effects. For `reads` and `writes`, the arrow starts at the code doing the access and points to the state node. An import arrow means a module dependency; it does not mean a function was called.

| Status | Meaning |
| --- | --- |
| `resolved` | Analysis identified the target from source evidence. |
| `possible` | The target is plausible but cannot be established uniquely. Several possible arrows may leave one call site. |
| `unresolved` | The target is unknown or unsupported; the arrow ends at a boundary node. |
| `observed` | A future opt-in runtime trace recorded this relationship in one identified run. It says nothing about paths that run did not take. |

Every arrow records a repository-relative file path, a 1-based start and exclusive end position, the adapter ID, and the analysis method. A known branch, loop, or exception condition can have its own source span. No arrow should be presented as certain without that evidence.

## Identity and versioning

The schema starts at version `1`. Readers check `schemaVersion` before using a snapshot. Node and edge IDs are deterministic for the same input keys. An adapter must choose a local symbol key that separates namesakes and overloads; the ID helper cannot infer that distinction from a display name. Edge IDs include both endpoints and the source site. A code edit that changes a symbol's key or a call site's position can change its ID; saved-view repair is a later feature.

`validateGraph` checks references, duplicate IDs, parent cycles, source locations, status rules, and unresolved boundaries before a graph is trusted by later components. Language adapters implement the shared `LanguageAdapter` interface and return graph facts plus diagnostics. Repository analysis now combines Python and JavaScript/TypeScript adapter output, validates it, and exposes it through the CLI.
