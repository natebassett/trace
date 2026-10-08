#!/usr/bin/env node

const usage = `Trace is a local code relationship explorer.

Usage:
  trace --help

Project scanning and graph navigation will be added in upcoming feature branches.`;

export function runCli(
  args: readonly string[],
  writeOut: (message: string) => void = console.log,
  writeError: (message: string) => void = console.error,
): number {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    writeOut(usage);
    return 0;
  }

  writeError(`Unknown command: ${args.join(" ")}\nRun trace --help for usage.`);
  return 2;
}

process.exitCode = runCli(process.argv.slice(2));
