import { basename, extname } from "node:path";
import type { DiscoveryResult, SkipReason } from "./discover.js";

const extensionLanguages: Readonly<Record<string, string>> = {
  ".astro": "Astro",
  ".bash": "Shell",
  ".c": "C",
  ".cc": "C++",
  ".clj": "Clojure",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".cxx": "C++",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".go": "Go",
  ".h": "C/C++ header",
  ".hpp": "C++",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".lua": "Lua",
  ".m": "Objective-C",
  ".php": "PHP",
  ".pl": "Perl",
  ".ps1": "PowerShell",
  ".py": "Python",
  ".r": "R",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scala": "Scala",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".swift": "Swift",
  ".svelte": "Svelte",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".wasm": "WebAssembly",
};
const specialNames: Readonly<Record<string, string>> = {
  dockerfile: "Dockerfile",
  gemfile: "Ruby",
  makefile: "Make",
  rakefile: "Ruby",
};

export interface LanguageCount {
  readonly language: string;
  readonly files: number;
}

export interface ScanSummary {
  readonly root: string;
  readonly totalFiles: number;
  readonly sourceFiles: number;
  readonly unclassifiedFiles: number;
  readonly languages: readonly LanguageCount[];
  readonly skipped: Readonly<Record<SkipReason, number>>;
  readonly gitIgnoreApplied: boolean;
  readonly diagnostics: readonly string[];
}

export function languageForPath(path: string): string | null {
  const name = basename(path).toLowerCase();
  return specialNames[name] ?? extensionLanguages[extname(name)] ?? null;
}

/** Counts only file types recognised by the current extension/name registry. */
export function summarizeDiscovery(result: DiscoveryResult): ScanSummary {
  const counts = new Map<string, number>();
  let sourceFiles = 0;
  for (const file of result.files) {
    const language = languageForPath(file.path);
    if (!language) continue;
    sourceFiles += 1;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const skipped: Record<SkipReason, number> = {
    "generated-directory": 0,
    gitignored: 0,
    symlink: 0,
    "non-file": 0,
    missing: 0,
  };
  for (const entry of result.skipped) skipped[entry.reason] += 1;
  return {
    root: result.root,
    totalFiles: result.files.length,
    sourceFiles,
    unclassifiedFiles: result.files.length - sourceFiles,
    languages: [...counts].map(([language, files]) => ({ language, files }))
      .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language)),
    skipped,
    gitIgnoreApplied: result.gitIgnoreApplied,
    diagnostics: result.diagnostics,
  };
}
