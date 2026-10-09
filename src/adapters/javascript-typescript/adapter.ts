import { posix } from "node:path";
import * as ts from "typescript";
import { createEdgeId, createNodeId } from "../../core/ids.js";
import type { GraphDiagnostic, GraphNode, SourceSpan } from "../../core/graph.js";
import type { AdapterInput, AdapterResult, LanguageAdapter, SourceFile } from "../adapter.js";

const virtualRoot = "/__trace_source__";
const extensions = [".ts", ".tsx", ".js", ".jsx"] as const;

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error("Source analysis cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function isRepositoryPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function extension(path: string): ts.Extension {
  if (path.endsWith(".tsx")) return ts.Extension.Tsx;
  if (path.endsWith(".jsx")) return ts.Extension.Jsx;
  if (path.endsWith(".js")) return ts.Extension.Js;
  return ts.Extension.Ts;
}

function span(file: ts.SourceFile, start: number, end: number): SourceSpan {
  const first = file.getLineAndCharacterOfPosition(start);
  const last = file.getLineAndCharacterOfPosition(end);
  return {
    path: file.fileName.slice(virtualRoot.length + 1),
    start: { line: first.line + 1, column: first.character + 1 },
    end: { line: last.line + 1, column: last.character + 1 },
  };
}

function moduleCandidates(specifier: string, containingFile: string): string[] {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return [];
  const base = posix.normalize(posix.join(posix.dirname(containingFile), specifier));
  if (!base.startsWith(virtualRoot + "/")) return [];
  const suffix = posix.extname(base);
  if (suffix === ".js") return [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx", base];
  if (suffix === ".jsx") return [base.slice(0, -4) + ".tsx", base];
  if (suffix !== "") return [base];
  return [
    ...extensions.map((ext) => base + ext),
    ...extensions.map((ext) => base + "/index" + ext),
  ];
}

function programFor(files: readonly SourceFile[]): ts.Program {
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const name = virtualRoot + "/" + file.path;
    sourceFiles.set(name, ts.createSourceFile(name, file.content, ts.ScriptTarget.ES2022, true, scriptKind(file.path)));
  }

  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host: ts.CompilerHost = {
    ...ts.createCompilerHost(options),
    getCurrentDirectory: () => virtualRoot,
    getSourceFile: (name) => sourceFiles.get(name),
    fileExists: (name) => sourceFiles.has(name),
    readFile: (name) => sourceFiles.get(name)?.text,
    directoryExists: (name) => name === virtualRoot || [...sourceFiles.keys()].some((path) => path.startsWith(name + "/")),
    getDirectories: () => [],
    realpath: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (name) => name,
    resolveModuleNames: (names, containingFile) => names.map((name) => {
      const resolvedFileName = moduleCandidates(name, containingFile).find((candidate) => sourceFiles.has(candidate));
      return resolvedFileName === undefined ? undefined : {
        resolvedFileName,
        extension: extension(resolvedFileName),
        isExternalLibraryImport: false,
      };
    }),
  };
  return ts.createProgram([...sourceFiles.keys()], options, host);
}

function qualifiedName(node: ts.FunctionDeclaration): string {
  const names = [node.name!.text];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) names.unshift(parent.name.text);
  }
  return names.join(".");
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

/** Syntax and type-checker-backed analysis of named functions in supplied source files. */
export class JavaScriptTypeScriptAdapter implements LanguageAdapter {
  readonly id = "javascript-typescript";
  readonly version = "2";
  readonly languageIds = ["javascript", "typescript"] as const;

  supports(path: string): boolean {
    return /\.(?:ts|tsx|js|jsx)$/.test(path);
  }

  async analyze(input: AdapterInput, signal: AbortSignal): Promise<AdapterResult> {
    abortIfNeeded(signal);
    const files = input.files.filter((file) => this.supports(file.path));
    const paths = new Set<string>();
    for (const file of files) {
      if (!isRepositoryPath(file.path)) throw new Error("Invalid repository-relative source path: " + file.path);
      if (paths.has(file.path)) throw new Error("Duplicate source path: " + file.path);
      paths.add(file.path);
    }

    const program = programFor(files);
    const checker = program.getTypeChecker();
    const nodes: GraphNode[] = [];
    const edges: AdapterResult["edges"][number][] = [];
    const diagnostics: GraphDiagnostic[] = [];
    const functionIds = new Map<ts.FunctionDeclaration, string>();
    const targets = new Map<ts.Symbol, string | null>();
    const modified = new Set<ts.Symbol>();
    const invalidPaths = new Set<string>();

    function symbolAt(name: ts.Identifier): ts.Symbol | undefined {
      const symbol = checker.getSymbolAtLocation(name);
      return symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    }

    for (const file of files) {
      abortIfNeeded(signal);
      const source = program.getSourceFile(virtualRoot + "/" + file.path)!;
      const moduleId = createNodeId(input.repositoryId, "module", file.path);
      nodes.push({
        id: moduleId,
        kind: "module",
        label: posix.basename(file.path),
        parentId: input.repositoryId,
        path: file.path,
        languageId: file.path.endsWith(".ts") || file.path.endsWith(".tsx") ? "typescript" : "javascript",
      });
      const syntaxErrors = program.getSyntacticDiagnostics(source);
      for (const diagnostic of syntaxErrors) {
        diagnostics.push({
          code: "SYNTAX_ERROR",
          severity: "error",
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        });
      }
      if (syntaxErrors.length > 0) {
        invalidPaths.add(file.path);
        continue;
      }

      const globals = new Set<string>();
      for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) {
            if (globals.has(name.text)) continue;
            globals.add(name.text);
            nodes.push({
              id: createNodeId(input.repositoryId, "state", file.path + "::" + name.text),
              kind: "state",
              label: name.text,
              parentId: moduleId,
              stateKind: "global",
              location: span(source, declaration.getStart(source), declaration.getEnd()),
            });
          }
        }
      }

      function collect(node: ts.Node): void {
        abortIfNeeded(signal);
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
          const id = createNodeId(input.repositoryId, "symbol", file.path + "::" + node.name.text + "@" + node.getStart(source));
          functionIds.set(node, id);
          nodes.push({
            id,
            kind: "symbol",
            label: node.name.text,
            parentId: moduleId,
            qualifiedName: qualifiedName(node),
            symbolKind: "function",
            location: span(source, node.getStart(source), node.getEnd()),
          });
          const symbol = symbolAt(node.name);
          if (symbol) targets.set(symbol, targets.has(symbol) ? null : id);
        }
        ts.forEachChild(node, collect);
      }
      collect(source);
    }

    for (const file of files) {
      if (invalidPaths.has(file.path)) continue;
      const source = program.getSourceFile(virtualRoot + "/" + file.path)!;
      function collectWrites(node: ts.Node): void {
        abortIfNeeded(signal);
        let name: ts.Node | undefined;
        if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) name = node.left;
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) name = node.operand;
        if (name && ts.isIdentifier(name)) {
          const symbol = symbolAt(name);
          if (symbol) modified.add(symbol);
        }
        ts.forEachChild(node, collectWrites);
      }
      collectWrites(source);
    }

    for (const file of files) {
      if (invalidPaths.has(file.path)) continue;
      const source = program.getSourceFile(virtualRoot + "/" + file.path)!;
      const moduleId = createNodeId(input.repositoryId, "module", file.path);
      function visit(node: ts.Node, caller: string | null): void {
        abortIfNeeded(signal);
        let currentCaller = caller;
        if (ts.isFunctionLike(node)) {
          currentCaller = ts.isFunctionDeclaration(node) ? (functionIds.get(node) ?? null) : null;
        }
        if (ts.isCallExpression(node) && currentCaller !== null) {
          const site = span(source, node.getStart(source), node.getEnd());
          const callee = ts.isIdentifier(node.expression) ? symbolAt(node.expression) : undefined;
          const target = callee && !modified.has(callee) ? targets.get(callee) : undefined;
          const resolvedTarget = typeof target === "string" ? target : undefined;
          let to = resolvedTarget;
          if (to === undefined) {
            to = createNodeId(input.repositoryId, "boundary", file.path + "::call@" + node.getStart(source) + ":" + node.getEnd());
            nodes.push({
              id: to,
              kind: "boundary",
              label: node.expression.getText(source) + " target",
              parentId: moduleId,
              boundaryKind: "unresolved",
              location: site,
            });
            diagnostics.push({
              code: "UNRESOLVED_CALL",
              severity: "warning",
              message: "Call target cannot be established from the supplied source: " + node.expression.getText(source),
              location: site,
            });
          }
          const from = currentCaller;
          edges.push({
            id: createEdgeId(input.repositoryId, "calls", from, to, site),
            from,
            to,
            kind: "calls",
            status: resolvedTarget === undefined ? "unresolved" : "resolved",
            evidence: { span: site, adapterId: "javascript-typescript", method: resolvedTarget === undefined ? "unresolved-call" : "direct-call" },
          });
        }
        ts.forEachChild(node, (child) => visit(child, currentCaller));
      }
      visit(source, moduleId);
    }

    return { nodes, edges, diagnostics };
  }
}
