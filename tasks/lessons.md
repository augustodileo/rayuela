# Lessons Learned

## Architecture principle: tree-sitter FINDS, LSP FOLLOWS
Tree-sitter is for syntactic discovery (finding decorators, imports, screens). LSP is for semantic following (what does this function call, what type is this). Don't use tree-sitter for semantic analysis — that's heuristic pattern matching.

## Stack Graphs: ROOT_PATH_VAR is required
Python TSG rules use `(replace FILE_PATH ROOT_PATH "")` to derive module paths. Without ROOT_PATH set, cross-file resolution silently fails. Always canonicalize paths and set both FILE_PATH and ROOT_PATH.

## napi-rs v2: Option<T> needs undefined, not null
JavaScript `null` triggers `StringExpected` error in napi-rs for `Option<String>` fields. Use `undefined` in TypeScript.

## napi-rs: CJS→ESM named exports
Node.js CJS named export detection fails for loader scripts. Solution: `.mjs` ESM wrapper with `createRequire`.

## Tree-sitter Python: typed_default_parameter
`user_id: UUID = Depends(guard)` uses `typed_default_parameter`, not `default_parameter`. Match both with `[...]` alternation.

## Tree-sitter: empty strings have no string_content
`@router.post("")` parses as `(string)` with no `string_content` child. Use `(string) @route_str` and strip quotes manually.

## Screen naming: include parent directory for dynamic routes
`[id].tsx` in different directories (roll/, session/) needs parent context to avoid duplicate names. `roll/[id].tsx` → "RollDetailScreen".

## Structural hashing for trace identity
Hash(symbol, kind, params, children_hashes) — excludes file/line (metadata, not identity). Same structure = same hash. Different guard = different hash.

## Auto-dependency installation
LSP can only trace through installed packages. Auto-install via uv/pip/npm into ~/.cache/rayuela/ and point LSP at the venv via VIRTUAL_ENV env var.

## Regex gotcha: ^use[A-Z].*[Aa]uth
Does NOT match "useAuthStore". After consuming "useA", remaining "uthStore" has no "Auth" substring. Use `^use.*[Aa]uth` instead.
