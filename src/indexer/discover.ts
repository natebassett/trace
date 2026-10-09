import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedDirectoryNames = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next",
  ".nuxt", ".turbo", ".cache", ".venv", "venv", "target",
]);

export type SkipReason = "generated-directory" | "gitignored" | "symlink" | "non-file" | "missing";

export interface DiscoveredFile {
  readonly path: string;
}

export interface SkippedEntry {
  readonly path: string;
  readonly reason: SkipReason;
}

export interface DiscoveryProgress {
  readonly examined: number;
  readonly included: number;
  readonly skipped: number;
}

export interface DiscoveryResult {
  readonly root: string;
  readonly files: readonly DiscoveredFile[];
  readonly skipped: readonly SkippedEntry[];
  readonly diagnostics: readonly string[];
  readonly gitIgnoreApplied: boolean;
}

export interface DiscoveryOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DiscoveryProgress) => void;
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Repository scan cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function excludedPath(path: string): boolean {
  return path.split("/").some((part) => excludedDirectoryNames.has(part));
}

function withinRoot(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path));
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep);
}

async function gitPaths(
  root: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...(signal ? { signal } : {}),
  });
  return stdout.split("\0").filter((path) => path.length > 0).map((path) => path.replaceAll("\\", "/"));
}

async function canUseGit(root: string, signal: AbortSignal | undefined): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      ...(signal ? { signal } : {}),
    });
    return stdout.trim() === "true";
  } catch (error) {
    checkAbort(signal);
    const code: unknown = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === 128) return false;
    throw error;
  }
}

/** Finds repository files without opening or executing their contents. */
export async function discoverRepository(
  directory: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  checkAbort(options.signal);
  const root = await realpath(resolve(directory));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error("Scan path is not a directory: " + directory);

  const files: DiscoveredFile[] = [];
  const skipped: SkippedEntry[] = [];
  const diagnostics: string[] = [];
  let examined = 0;

  function report(): void {
    options.onProgress?.({ examined, included: files.length, skipped: skipped.length });
  }

  function skip(path: string, reason: SkipReason): void {
    skipped.push({ path, reason });
    examined += 1;
    report();
  }

  async function include(path: string): Promise<void> {
    checkAbort(options.signal);
    if (!withinRoot(root, path)) {
      throw new Error("Git returned a path outside the scan root: " + path);
    }
    if (excludedPath(path)) {
      skip(path, "generated-directory");
      return;
    }
    try {
      const stat = await lstat(resolve(root, path));
      if (stat.isSymbolicLink()) {
        skip(path, "symlink");
      } else if (!stat.isFile()) {
        skip(path, "non-file");
      } else {
        files.push({ path });
        examined += 1;
        report();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        skip(path, "missing");
      } else {
        throw error;
      }
    }
  }

  const gitIgnoreApplied = await canUseGit(root, options.signal);
  if (gitIgnoreApplied) {
    const paths = await gitPaths(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--"], options.signal);
    for (const path of [...new Set(paths)].sort()) {
      await include(path);
    }
    const ignored = await gitPaths(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z", "--"], options.signal);
    for (const path of [...new Set(ignored)].sort()) {
      checkAbort(options.signal);
      if (!withinRoot(root, path)) continue;
      skip(path, excludedPath(path) ? "generated-directory" : "gitignored");
    }
  } else {
    diagnostics.push("Git ignore rules were unavailable; only built-in generated-folder exclusions were applied.");
    async function walk(directoryPath: string): Promise<void> {
      checkAbort(options.signal);
      const entries = await readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        checkAbort(options.signal);
        const absolutePath = resolve(directoryPath, entry.name);
        const path = toPortablePath(relative(root, absolutePath));
        if (excludedPath(path)) {
          skip(path, "generated-directory");
        } else if (entry.isSymbolicLink()) {
          skip(path, "symlink");
        } else if (entry.isDirectory()) {
          await walk(absolutePath);
        } else if (entry.isFile()) {
          await include(path);
        } else {
          skip(path, "non-file");
        }
      }
    }
    await walk(root);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { root, files, skipped, diagnostics, gitIgnoreApplied };
}



