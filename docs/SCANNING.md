# Repository scanning

Run node dist/src/cli/main.js scan [directory] after npm run build. The directory defaults to the current working directory. Add --json for every included path, its likely language, and the skipped-path list. The normal output shows a summary and the first 20 recognised source files.

Trace lists tracked and untracked files in a Git working tree with git ls-files. Git's ignore rules apply to untracked files. Tracked files remain visible even when an ignore rule matches them. Trace additionally skips known generated folders, including node_modules, dist, build, coverage, virtual environments, and common framework caches. It does not follow symlinks. A directory outside Git can still be scanned, but only those built-in exclusions apply; the command prints a note about that limitation.

Language labels come from file extensions and a few conventional names. Unknown files are counted as unclassified. The scan reads file metadata and path names, not source contents, and does not execute project code. It is a file inventory. Use `trace analyze [directory]` to read supported source files and build a call graph. The indexer API supports progress callbacks and cancellation; Ctrl+C cancels the CLI scan.

Skipped counts are paths reported by Git or by traversal, including whole ignored directories. They are not exact counts of individual files underneath those directories.
