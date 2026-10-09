# Python analysis

Install Python 3.10 or newer alongside Node.js, then run `node dist/src/cli/main.js analyze [directory]`. Add `--json` for the validated graph, diagnostics, and source spans. Trace finds `.py` files using the same Git ignore and generated-folder rules as `scan`. Analysis reads at most 1 MiB per file and 32 MiB in total in this first version; skipped files produce diagnostics. Set `TRACE_PYTHON` to an interpreter path when `python` or `python3` is not the one you want.

Trace sends source text to Python's built-in `ast` parser in an isolated interpreter process. It does not import or execute the scanned project. The parser emits module, class, function, and method nodes. Direct name calls to one supplied function definition are `resolved`, including supported `from module import function` links. Calls such as `self.method()` are `possible` because subclasses can override the method. Calls through parameters, variables, unknown imports, decorators, reassigned names, and other dynamic expressions are `unresolved` with a source location and diagnostic.

The first version omits calls inside lambdas and comprehensions. It does not infer decorators, dynamic imports, monkey patching, reflection, or arbitrary runtime dispatch. A syntax-error file produces a diagnostic without claiming call relationships from its recovered tree. These limits are visible in the graph statuses; they are areas to expand after testing on real Python projects.

The `analyze` command also runs the JavaScript/TypeScript adapter when those files are present. It assembles one repository graph and checks it with `validateGraph` before returning it. Files of other types appear in the inventory but are not parsed into call relationships yet.
