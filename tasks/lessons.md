# Lessons Learned

## Tree-sitter Python: typed_default_parameter vs default_parameter
**Pattern:** `user_id: UUID = Depends(guard)` uses `typed_default_parameter`, not `default_parameter`. Always match both with `[...]` alternation in tree-sitter queries that target default parameter values in Python.

## Tree-sitter regex: careful with greedy matching
**Pattern:** `^use[A-Z].*[Aa]uth` does NOT match "useAuthStore" because after consuming "useA", the remaining "uthStore" has no "Auth" substring. Fix: use `^use.*[Aa]uth` instead.

## napi-rs v2: Option<String> requires undefined, not null
**Pattern:** When passing TypeScript objects to Rust `#[napi(object)]` structs with `Option<T>` fields, use `undefined` (not `null`). JavaScript `null` triggers `StringExpected` error in napi-rs.

## napi-rs: CJS→ESM named exports
**Pattern:** Node.js CJS named export detection fails for complex loader scripts. Solution: create an `.mjs` ESM wrapper that re-exports via `createRequire`. Use `exports` field in package.json with `import`/`require` conditions.

## Rust cdylib: can't use integration tests
**Pattern:** `cdylib` crate type links against napi symbols that don't exist outside Node.js. Use `crate-type = ["cdylib", "rlib"]` and write tests as `#[cfg(test)]` modules inside the crate, not as integration tests in `tests/`.

## Expo Router: index.tsx screen naming
**Pattern:** For `(tabs)/index.tsx`, use the relative path (after stripping `/index`) to derive the screen name, not `path.dirname()` which loses the group directory context.
