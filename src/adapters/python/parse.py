"""Parse supplied Python source without importing or executing it.

Input and output are JSON on stdin/stdout. The TypeScript adapter owns graph IDs.
"""

import ast
import json
import posixpath
import sys

TRY_TYPES = (ast.Try,) + ((ast.TryStar,) if hasattr(ast, "TryStar") else ())


def location(path, source, node):
    lines = source.splitlines(keepends=True)

    def position(line, byte_column):
        text = lines[line - 1] if 0 < line <= len(lines) else ""
        column = len(text.encode("utf-8")[:byte_column].decode("utf-8", "ignore")) + 1
        return {"line": line, "column": column}

    return {
        "path": path,
        "start": position(node.lineno, node.col_offset),
        "end": position(node.end_lineno, node.end_col_offset),
    }


class Scope:
    def __init__(self, kind, path, parent=None, qualified="", caller=None):
        self.kind = kind
        self.path = path
        self.parent = parent
        self.qualified = qualified
        self.caller = caller
        self.bindings = {}
        self.global_names = set()
        self.nonlocal_names = set()
        self.dynamic_all = False
        self.instance_fields = {}

    def bind(self, name, binding):
        self.bindings.setdefault(name, []).append(binding)


class Analyzer:
    def __init__(self, files):
        self.files = {item["path"]: item["content"] for item in files}
        self.modules = {}
        self.scopes = {}
        self.classes = {}
        self.definitions = []
        self.globals = {}
        self.calls = []
        self.diagnostics = []

    def targets(self, node):
        if isinstance(node, ast.Name):
            return [node.id]
        if isinstance(node, (ast.Tuple, ast.List)):
            return [name for child in node.elts for name in self.targets(child)]
        if isinstance(node, ast.Starred):
            return self.targets(node.value)
        return []

    def bind_parameters(self, node, scope):
        arguments = node.args
        for parameter in arguments.posonlyargs + arguments.args + arguments.kwonlyargs:
            scope.bind(parameter.arg, {"kind": "parameter"})
        for parameter in (arguments.vararg, arguments.kwarg):
            if parameter:
                scope.bind(parameter.arg, {"kind": "parameter"})

    def collect(self, node, scope, conditional=False):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            kind = "class" if isinstance(node, ast.ClassDef) else (
                "method" if scope.kind == "class" else "function"
            )
            qualified = (scope.qualified + "." if scope.qualified else "") + node.name
            key = f"{scope.path}::{qualified}@{node.lineno}:{node.col_offset}"
            parent = scope.caller if scope.kind == "function" else (
                scope.caller if scope.kind == "class" else None
            )
            self.definitions.append({
                "key": key,
                "path": scope.path,
                "name": node.name,
                "qualifiedName": qualified,
                "kind": kind,
                "parentKey": parent,
                "span": location(scope.path, self.files[scope.path], node),
            })
            binding_kind = kind if not conditional and not node.decorator_list else "dynamic"
            scope.bind(node.name, {"kind": binding_kind, "key": key})
            child = Scope(
                "class" if kind == "class" else "function", scope.path, scope,
                qualified, key,
            )
            self.scopes[id(node)] = child
            if kind == "class":
                self.classes[key] = child
            if kind != "class":
                self.bind_parameters(node, child)
            for statement in node.body:
                self.collect(statement, child)
            return

        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value = node.value if not isinstance(node, ast.AugAssign) else None
            constructed = (
                value.func.id if not conditional and isinstance(value, ast.Call)
                and isinstance(value.func, ast.Name) else None
            )
            for target in targets:
                for name in self.targets(target):
                    scope.bind(name, {
                        "kind": "instance" if constructed else "assignment",
                        "className": constructed,
                    })
                    if scope.kind == "module":
                        self.globals.setdefault((scope.path, name), {
                            "key": f"{scope.path}::{name}",
                            "path": scope.path,
                            "name": name,
                            "span": location(scope.path, self.files[scope.path], node),
                        })
                if (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name) and target.value.id == "self"
                    and scope.kind == "function" and scope.parent and scope.parent.kind == "class"
                    and len(scope.bindings.get("self", [])) == 1
                    and scope.bindings["self"][0]["kind"] == "parameter"
                ):
                    scope.parent.instance_fields.setdefault(target.attr, []).append(constructed)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            for name in self.targets(node.target):
                scope.bind(name, {"kind": "assignment"})
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if item.optional_vars:
                    for name in self.targets(item.optional_vars):
                        scope.bind(name, {"kind": "assignment"})
        elif isinstance(node, ast.ExceptHandler) and node.name:
            scope.bind(node.name, {"kind": "assignment"})
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    scope.dynamic_all = True
                else:
                    scope.bind(alias.asname or alias.name, {
                        "kind": "dynamic" if conditional else "import-from", "module": node.module or "",
                        "level": node.level, "name": alias.name,
                    })
        elif isinstance(node, ast.Import):
            for alias in node.names:
                scope.bind(alias.asname or alias.name.split(".")[0], {"kind": "import"})
        elif isinstance(node, ast.Global):
            scope.global_names.update(node.names)
        elif isinstance(node, ast.Nonlocal):
            scope.nonlocal_names.update(node.names)
        elif isinstance(node, (ast.Delete, ast.MatchAs, ast.MatchStar)):
            names = node.targets if isinstance(node, ast.Delete) else [node]
            for target in names:
                name = target.name if isinstance(target, (ast.MatchAs, ast.MatchStar)) else None
                for bound in ([name] if name else self.targets(target)):
                    scope.bind(bound, {"kind": "assignment"})

        # Blocks share their containing scope. Function, class, and lambda bodies do not.
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            nested_conditional = conditional or isinstance(node, (
                ast.If, ast.For, ast.AsyncFor, ast.While, *TRY_TYPES,
                ast.With, ast.AsyncWith, ast.Match,
            ))
            for child in ast.iter_child_nodes(node):
                self.collect(child, scope, nested_conditional)

    def imported_target(self, scope, binding):
        module = binding["module"].replace(".", "/")
        if binding["level"]:
            base = posixpath.dirname(scope.path)
            for _ in range(binding["level"] - 1):
                base = posixpath.dirname(base)
            module = posixpath.join(base, module)
        candidates = [module + ".py", posixpath.join(module, "__init__.py")]
        for path in candidates:
            imported = self.modules.get(posixpath.normpath(path))
            if imported:
                bindings = imported.bindings.get(binding["name"], [])
                if len(bindings) == 1 and bindings[0]["kind"] in ("function", "class"):
                    return bindings[0]
        return None

    def name_target(self, scope, name):
        current = scope
        while current:
            if current.dynamic_all:
                return None
            if name in current.global_names or name in current.nonlocal_names:
                return None
            bindings = current.bindings.get(name, [])
            if bindings:
                if len(bindings) != 1:
                    return None
                binding = bindings[0]
                if binding["kind"] in ("function", "class"):
                    return binding
                if binding["kind"] == "import-from":
                    return self.imported_target(current, binding)
                return None
            current = current.parent
            if current and current.kind == "class":
                current = current.parent
        return None

    def constructor_target(self, binding):
        class_scope = self.classes.get(binding["key"])
        if class_scope:
            initializers = class_scope.bindings.get("__init__", [])
            if len(initializers) == 1 and initializers[0]["kind"] == "method":
                return initializers[0]["key"]
        return binding["key"]

    def instance_binding(self, scope, name):
        current = scope
        while current:
            if current.dynamic_all or name in current.global_names or name in current.nonlocal_names:
                return None
            bindings = current.bindings.get(name, [])
            if bindings:
                return bindings[0] if len(bindings) == 1 and bindings[0]["kind"] == "instance" else None
            current = current.parent
            if current and current.kind == "class":
                current = current.parent
        return None

    def class_method_target(self, scope, class_name, method_name):
        binding = self.name_target(scope, class_name)
        if not binding or binding["kind"] != "class":
            return None
        class_scope = self.classes.get(binding["key"])
        if not class_scope:
            return None
        methods = class_scope.bindings.get(method_name, [])
        if len(methods) == 1 and methods[0]["kind"] == "method":
            return methods[0]["key"]
        return None

    def method_target(self, scope, expression):
        if not isinstance(expression, ast.Attribute):
            return None
        if isinstance(expression.value, ast.Name):
            owner = expression.value.id
            if scope.kind == "function" and scope.parent and scope.parent.kind == "class":
                parameters = scope.bindings.get(owner, [])
                if owner in ("self", "cls") and len(parameters) == 1 and parameters[0]["kind"] == "parameter":
                    bindings = scope.parent.bindings.get(expression.attr, [])
                    if len(bindings) == 1 and bindings[0]["kind"] == "method":
                        return bindings[0]["key"]
            instance = self.instance_binding(scope, owner)
            if instance:
                return self.class_method_target(scope, instance["className"], expression.attr)
        if (
            isinstance(expression.value, ast.Attribute)
            and isinstance(expression.value.value, ast.Name)
            and expression.value.value.id == "self"
            and scope.kind == "function" and scope.parent and scope.parent.kind == "class"
        ):
            fields = scope.parent.instance_fields.get(expression.value.attr, [])
            if len(fields) == 1:
                return self.class_method_target(scope, fields[0], expression.attr)
        return None

    def visit(self, node, scope, caller):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for item in node.decorator_list + node.args.defaults + [x for x in node.args.kw_defaults if x]:
                self.visit(item, scope, caller)
            child = self.scopes[id(node)]
            for statement in node.body:
                self.visit(statement, child, child.caller)
            return
        if isinstance(node, ast.ClassDef):
            for item in node.decorator_list + node.bases:
                self.visit(item, scope, caller)
            child = self.scopes[id(node)]
            for statement in node.body:
                self.visit(statement, child, caller)
            return
        if isinstance(node, ast.Lambda):
            for item in node.args.defaults:
                self.visit(item, scope, caller)
            return
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            return
        if isinstance(node, ast.Call):
            expression = ast.get_source_segment(self.files[scope.path], node.func) or "call"
            binding = self.name_target(scope, node.func.id) if isinstance(node.func, ast.Name) else None
            if binding and binding["kind"] == "function":
                target = binding["key"]
                status = "resolved"
            elif binding and binding["kind"] == "class":
                target = self.constructor_target(binding)
                status = "possible"
            else:
                target = None
                status = "unresolved"
            if not target:
                target = self.method_target(scope, node.func)
                if target:
                    status = "possible"
            self.calls.append({
                "path": scope.path,
                "callerKey": caller,
                "targetKey": target,
                "status": status,
                "expression": expression[:100],
                "span": location(scope.path, self.files[scope.path], node),
            })
        for child in ast.iter_child_nodes(node):
            self.visit(child, scope, caller)

    def analyze(self):
        trees = {}
        for path, content in self.files.items():
            try:
                trees[path] = ast.parse(content, filename=path)
            except SyntaxError as error:
                self.diagnostics.append({
                    "code": "PYTHON_SYNTAX_ERROR", "severity": "error",
                    "message": f"{path}:{error.lineno}: {error.msg}",
                })
            self.modules[path] = Scope("module", path)
        for path, tree in trees.items():
            for statement in tree.body:
                self.collect(statement, self.modules[path])
        for path, tree in trees.items():
            for statement in tree.body:
                self.visit(statement, self.modules[path], None)
        return {
            "definitions": self.definitions,
            "globals": list(self.globals.values()),
            "calls": self.calls,
            "diagnostics": self.diagnostics,
        }


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("Trace requires Python 3.10 or newer")
    request = json.load(sys.stdin)
    json.dump(Analyzer(request["files"]).analyze(), sys.stdout, ensure_ascii=False)
