/**
 * Deterministic method call resolution using Stack Graphs + tree-sitter.
 *
 * For a call like `RollService(db).create_roll(user_id, data)`:
 * 1. Tree-sitter extracts: class="RollService", method="create_roll"
 * 2. Stack Graphs resolves "RollService" import → roll_service.py
 * 3. Tree-sitter finds "def create_roll" in roll_service.py → line number
 *
 * No LSP needed. No heuristics. Each tool does what it's designed for:
 * - Stack Graphs: cross-file name resolution (imports)
 * - Tree-sitter: structural pattern matching (find function definition)
 */

import type { CallTreeNode, SourcePosition } from "./types.js";

interface NameResolverLike {
  findDefinition(symbol: string, file: string, line: number): { file: string; line: number } | null;
}

/** Python: find all method calls of pattern `await Class(args).method(args)` */
const PY_CONSTRUCTOR_METHOD_CALL = `
(await
  (call
    function: (attribute
      object: (call
        function: (identifier) @class_name)
      attribute: (identifier) @method_name)))
`;

/** Python: find all method calls on variables: `await var.method(args)` */
const PY_VAR_METHOD_CALL = `
(await
  (call
    function: (attribute
      object: (identifier) @var_name
      attribute: (identifier) @method_name)))
`;

/** Python: find class definition of a name */
const PY_CLASS_METHOD_DEF = `
(class_definition
  name: (identifier) @class_name
  body: (block
    (function_definition
      name: (identifier) @method_name)))
`;

/** Python: find variable assignment to a class constructor */
const PY_VAR_ASSIGNMENT = `
(assignment
  left: (identifier) @var_name
  right: (call
    function: (identifier) @class_name))
`;

/** Python: find self.attr.method() calls — instance attribute method access */
const PY_SELF_ATTR_METHOD_CALL = `
(await
  (call
    function: (attribute
      object: (attribute
        object: (identifier) @self_ref
        (#eq? @self_ref "self")
        attribute: (identifier) @attr_name)
      attribute: (identifier) @method_name)))
`;

/** Python: find self.attr = Class(args) assignments in __init__ */
const PY_SELF_ATTR_ASSIGNMENT = `
(assignment
  left: (attribute
    object: (identifier) @self_ref
    (#eq? @self_ref "self")
    attribute: (identifier) @attr_name)
  right: (call
    function: (identifier) @class_name))
`;

/** Python: plain function call (no await): func(args) — e.g., create_access_token(user.id) */
const PY_PLAIN_FUNC_CALL = `
(call
  function: (identifier) @call_func)
`;

/** Python: plain self.attr.method(args) (no await) — e.g., self.dispatcher.dispatch(...) */
const PY_PLAIN_SELF_ATTR_CALL = `
(call
  function: (attribute
    object: (attribute
      object: (identifier) @self_ref
      (#eq? @self_ref "self")
      attribute: (identifier) @attr_name)
    attribute: (identifier) @method_name))
`;

/**
 * Build a call tree for a Python function using Stack Graphs + tree-sitter.
 * No LSP required.
 */
export async function buildCallTreeDeterministic(
  resolver: NameResolverLike,
  position: SourcePosition,
  sourceDir: string,
  maxDepth: number = 4,
): Promise<CallTreeNode | null> {
  const { parseFile, queryTree } = await import("rayuela-core");

  let tree;
  try { tree = parseFile(position.file); } catch { return null; }

  // Find the function at this position
  const fnQuery = position.file.endsWith(".py")
    ? `(function_definition name: (identifier) @fn_name)`
    : `[(function_declaration name: (identifier) @fn_name)
       (export_default_declaration (function_declaration name: (identifier) @fn_name))]`;

  const fns = queryTree(tree, fnQuery);
  const fn = fns.reduce((best: typeof fns[0] | null, m) => {
    const line = m.captures["fn_name"]?.startLine;
    if (!line) return best;
    return !best || Math.abs(line - position.line) < Math.abs(best.captures["fn_name"]?.startLine - position.line)
      ? m : best;
  }, null);

  const fnName = fn?.captures["fn_name"]?.text || "unknown";
  const fnLine = fn?.captures["fn_name"]?.startLine || position.line;

  // Determine function end line
  const allFnLines = fns.map(m => m.captures["fn_name"]?.startLine).filter(Boolean).sort((a, b) => a - b);
  const fnIdx = allFnLines.indexOf(fnLine);
  const fnEndLine = fnIdx >= 0 && fnIdx < allFnLines.length - 1
    ? allFnLines[fnIdx + 1] - 1 : fnLine + 100;

  const rootNode: CallTreeNode = {
    name: fnName, file: position.file, line: position.line, children: [],
  };

  if (maxDepth <= 0) return rootNode;

  const visited = new Set<string>();
  visited.add(`${position.file}:${position.line}`);

  if (position.file.endsWith(".py")) {
    // Pattern 1: await Class(args).method(args)
    const allConstructorCalls = queryTree(tree, PY_CONSTRUCTOR_METHOD_CALL);
    const constructorCalls = allConstructorCalls
      .filter(m => {
        const line = m.captures["method_name"]?.startLine;
        return line && line >= fnLine && line <= fnEndLine;
      });
    // Debug: uncomment to see resolution details
    // console.error(`  [resolver] ${fnName}@${position.file.split("/").pop()}:${fnLine}-${fnEndLine}: ${allConstructorCalls.length} total, ${constructorCalls.length} in range`);

    for (const call of constructorCalls) {
      const className = call.captures["class_name"]?.text;
      const methodName = call.captures["method_name"]?.text;
      const callLine = call.captures["class_name"]?.startLine;
      if (!className || !methodName || !callLine) continue;

      const child = await resolveClassMethod(
        resolver, parseFile, queryTree,
        position.file, callLine, className, methodName,
        sourceDir, maxDepth - 1, visited,
      );
      if (child) rootNode.children.push(child);
    }

    // Pattern 2: var = Class(args); await var.method(args)
    // Collect variable → class mappings in this function's scope
    const varAssignments = queryTree(tree, PY_VAR_ASSIGNMENT)
      .filter(m => {
        const line = m.captures["var_name"]?.startLine;
        return line && line >= fnLine && line <= fnEndLine;
      });
    const varClassMap = new Map<string, string>();
    for (const a of varAssignments) {
      const v = a.captures["var_name"]?.text;
      const c = a.captures["class_name"]?.text;
      if (v && c) varClassMap.set(v, c);
    }

    const varMethodCalls = queryTree(tree, PY_VAR_METHOD_CALL)
      .filter(m => {
        const line = m.captures["method_name"]?.startLine;
        return line && line >= fnLine && line <= fnEndLine;
      });

    for (const call of varMethodCalls) {
      const varName = call.captures["var_name"]?.text;
      const methodName = call.captures["method_name"]?.text;
      const callLine = call.captures["var_name"]?.startLine;
      if (!varName || !methodName || !callLine) continue;

      const className = varClassMap.get(varName);
      if (!className) continue; // Unknown variable type

      const child = await resolveClassMethod(
        resolver, parseFile, queryTree,
        position.file, callLine, className, methodName,
        sourceDir, maxDepth - 1, visited,
      );
      if (child) rootNode.children.push(child);
    }

    // Pattern 3: await self.attr.method(args) — instance attribute calls
    // Resolve by finding self.attr = Class(args) in the enclosing class __init__
    const selfMethodCalls = queryTree(tree, PY_SELF_ATTR_METHOD_CALL)
      .filter(m => {
        const line = m.captures["method_name"]?.startLine;
        return line && line >= fnLine && line <= fnEndLine;
      });

    if (selfMethodCalls.length > 0) {
      // Build self.attr → Class mapping from __init__ in the same file
      const selfAttrMap = new Map<string, string>();
      const selfAssignments = queryTree(tree, PY_SELF_ATTR_ASSIGNMENT);
      for (const a of selfAssignments) {
        const attr = a.captures["attr_name"]?.text;
        const cls = a.captures["class_name"]?.text;
        if (attr && cls) selfAttrMap.set(attr, cls);
      }

      for (const call of selfMethodCalls) {
        const attrName = call.captures["attr_name"]?.text;
        const methodName = call.captures["method_name"]?.text;
        const callLine = call.captures["method_name"]?.startLine;
        if (!attrName || !methodName || !callLine) continue;

        const className = selfAttrMap.get(attrName);
        if (!className) continue;

        const child = await resolveClassMethod(
          resolver, parseFile, queryTree,
          position.file, callLine, className, methodName,
          sourceDir, maxDepth - 1, visited,
        );
        if (child) rootNode.children.push(child);
      }

      // Also check non-awaited self.attr.method() (e.g., self.dispatcher.dispatch())
      const plainSelfCalls = queryTree(tree, PY_PLAIN_SELF_ATTR_CALL)
        .filter(m => {
          const line = m.captures["method_name"]?.startLine;
          return line && line >= fnLine && line <= fnEndLine;
        });

      for (const call of plainSelfCalls) {
        const attrName = call.captures["attr_name"]?.text;
        const methodName = call.captures["method_name"]?.text;
        const callLine = call.captures["method_name"]?.startLine;
        if (!attrName || !methodName || !callLine) continue;

        const className = selfAttrMap.get(attrName);
        if (!className) continue;

        const child = await resolveClassMethod(
          resolver, parseFile, queryTree,
          position.file, callLine, className, methodName,
          sourceDir, maxDepth - 1, visited,
        );
        if (child) rootNode.children.push(child);
      }
    }

    // Pattern 4: plain func(args) — non-awaited function calls (e.g., create_access_token)
    // Stack Graphs filters: only follows calls that resolve to project code
    const plainFuncCalls = queryTree(tree, PY_PLAIN_FUNC_CALL)
      .filter(m => {
        const line = m.captures["call_func"]?.startLine;
        return line && line >= fnLine && line <= fnEndLine;
      });

    for (const call of plainFuncCalls) {
      const funcName = call.captures["call_func"]?.text;
      const callLine = call.captures["call_func"]?.startLine;
      if (!funcName || !callLine) continue;

      // Resolve via Stack Graphs — only follow if it resolves to project code
      const funcDef = resolver.findDefinition(funcName, position.file, 0);
      if (!funcDef || !funcDef.file.startsWith(sourceDir)) continue;

      // Check if the resolved definition is a function (not a class constructor)
      // by parsing the target file and checking what's at the definition line
      let defTree;
      try { defTree = parseFile(funcDef.file); } catch { continue; }
      const defFns = queryTree(defTree, `(function_definition name: (identifier) @fn_name)`);
      const isFunction = defFns.some(
        m => m.captures["fn_name"]?.text === funcName &&
             Math.abs((m.captures["fn_name"]?.startLine || 0) - funcDef.line) <= 2
      );
      if (!isFunction) continue; // It's a class, not a function — skip

      const key = `${funcDef.file}:${funcDef.line}`;
      if (visited.has(key)) continue;

      const child = await buildCallTreeDeterministic(
        resolver,
        { file: funcDef.file, line: funcDef.line, col: 0 },
        sourceDir,
        maxDepth - 1,
      );
      if (child) rootNode.children.push(child);
    }
  }

  return rootNode;
}

/**
 * Resolve a class method call: Class.method → find the method definition.
 *
 * 1. Stack Graphs resolves `Class` import to the source file
 * 2. Tree-sitter finds `def method` within the class in that file
 * 3. Recurse into the method body
 */
async function resolveClassMethod(
  resolver: NameResolverLike,
  parseFile: (f: string) => unknown,
  queryTree: (tree: unknown, q: string) => Array<{ captures: Record<string, { text: string; startLine: number; startCol: number }> }>,
  fromFile: string,
  fromLine: number,
  className: string,
  methodName: string,
  sourceDir: string,
  depth: number,
  visited: Set<string>,
): Promise<CallTreeNode | null> {
  // Step 1: Resolve the class import via Stack Graphs
  // Use line 0 to search all references in the file (the class may be imported at a different line)
  const classDef = resolver.findDefinition(className, fromFile, 0);
  // Debug: uncomment to see class resolution details
  // console.error(`    [resolve] ${className}.${methodName} → ${classDef ? classDef.file.split("/").pop() + ":" + classDef.line : "null"}`);
  if (!classDef || !classDef.file.startsWith(sourceDir)) {
    return { name: `${className}.${methodName}`, file: fromFile, line: fromLine, children: [] };
  }

  // Step 2: Find the method in the resolved class file
  let classTree;
  try { classTree = parseFile(classDef.file); } catch { return null; }

  const methodDefs = queryTree(classTree, PY_CLASS_METHOD_DEF)
    .filter(m =>
      m.captures["class_name"]?.text === className &&
      m.captures["method_name"]?.text === methodName
    );

  if (methodDefs.length === 0) {
    // Method not found in class — might be inherited or dynamic
    return { name: `${className}.${methodName}`, file: classDef.file, line: classDef.line, children: [] };
  }

  const methodLine = methodDefs[0].captures["method_name"]?.startLine;
  if (!methodLine) return null;

  const key = `${classDef.file}:${methodLine}`;
  if (visited.has(key)) {
    return { name: methodName, file: classDef.file, line: methodLine, children: [] };
  }

  // Step 3: Recurse into the method body
  if (depth <= 0) {
    return { name: methodName, file: classDef.file, line: methodLine, children: [] };
  }

  return buildCallTreeDeterministic(
    resolver,
    { file: classDef.file, line: methodLine, col: 0 },
    sourceDir,
    depth,
  );
}
