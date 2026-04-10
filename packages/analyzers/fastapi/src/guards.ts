import { parseFile, queryTree } from "rayuela-core";
import type { NameResolver, SymbolLocation } from "rayuela-core";

/** Known non-auth dependencies that should not be classified as guards */
const NON_AUTH_DEPS = [
  "get_db", "get_session", "get_database", "get_settings",
  "get_redis", "get_cache", "get_config", "get_engine",
];

/** Tree-sitter query: find calls to jwt.decode, HTTPBearer, etc. in a function body */
const AUTH_PATTERN_QUERY = `
(call_expression
  function: (attribute
    object: (identifier) @obj
    attribute: (identifier) @method))
`;

/** Tree-sitter query: find HTTPBearer/HTTPAuthorizationCredentials in parameters */
const SECURITY_TYPE_QUERY = `
[
  (default_parameter
    value: (call
      function: (identifier) @func_name))
  (typed_default_parameter
    value: (call
      function: (identifier) @func_name))
  (typed_default_parameter
    type: (type) @type_name)
  (typed_parameter
    type: (type) @type_name)
]
`;

/** Classify a guard function by analyzing its source code.
 *  Uses the resolver to find the definition, then parses the function body
 *  for authentication patterns (JWT, HTTPBearer, role checks, etc.). */
export function classifyGuardBySource(
  guardName: string,
  file: string,
  line: number,
  resolver: { findDefinition(symbol: string, file: string, line: number): SymbolLocation | null },
): string | null {
  // Resolve the guard to its definition via Stack Graphs
  const def = resolver.findDefinition(guardName, file, line);
  if (!def) {
    // Can't resolve — fall back to heuristic
    return classifyGuard(guardName);
  }

  // Parse the definition file and analyze the function body
  try {
    const tree = parseFile(def.file);

    // Look for auth patterns in the function's body and parameters
    const callMatches = queryTree(tree, AUTH_PATTERN_QUERY);
    const typeMatches = queryTree(tree, SECURITY_TYPE_QUERY);

    // Check for JWT patterns (jwt.decode, jwt.verify, etc.)
    const hasJwt = callMatches.some((m) => {
      const obj = m.captures["obj"]?.text?.toLowerCase();
      const method = m.captures["method"]?.text?.toLowerCase();
      return obj === "jwt" && (method === "decode" || method === "verify" || method === "encode");
    });

    // Check for HTTPBearer/security patterns
    const hasBearer = typeMatches.some((m) => {
      const funcName = m.captures["func_name"]?.text;
      const typeName = m.captures["type_name"]?.text;
      return (
        funcName === "HTTPBearer" ||
        funcName === "OAuth2PasswordBearer" ||
        funcName === "APIKeyHeader" ||
        typeName?.includes("HTTPAuthorizationCredentials") ||
        typeName?.includes("HTTPBearer")
      );
    });

    // Check for role/permission patterns
    const hasRoleCheck = callMatches.some((m) => {
      const method = m.captures["method"]?.text?.toLowerCase();
      return method?.includes("role") || method?.includes("permission") || method?.includes("admin");
    });

    if (hasJwt || hasBearer) {
      return "authenticated";
    }
    if (hasRoleCheck) {
      return "role_check";
    }

    // If we parsed the source but found no auth patterns, it's not a guard
    // But if it was imported from a security/auth module, trust the module path
    if (def.file.includes("/auth") || def.file.includes("/security")) {
      return "authenticated";
    }

    return null;
  } catch {
    // Parse failed — fall back to heuristic
    return classifyGuard(guardName);
  }
}

/** Classify a guard function from Depends().
 *  Returns null ONLY for known non-auth dependencies (get_db, etc.).
 *  Unknown dependencies are treated as guards (return the function name). */
export function classifyGuard(guardName: string): string | null {
  const name = guardName.toLowerCase();

  // Known non-auth dependencies — definitely not guards
  if (NON_AUTH_DEPS.includes(name)) {
    return null;
  }

  // Classify known auth patterns into human-readable types
  if (name.includes("current_user") || name.includes("user_id") || name.includes("auth")) {
    return "authenticated";
  }
  if (name.includes("admin") || name.includes("superuser")) {
    return "role:admin";
  }
  if (name.includes("role") || name.includes("permission")) {
    return "role_check";
  }
  if (name.includes("api_key") || name.includes("apikey")) {
    return "api_key";
  }

  // Unknown Depends() — likely a guard, return the function name
  return guardName;
}
