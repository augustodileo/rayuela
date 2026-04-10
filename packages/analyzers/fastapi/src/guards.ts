/** Known non-auth dependencies that should not be classified as guards */
const NON_AUTH_DEPS = [
  "get_db", "get_session", "get_database", "get_settings",
  "get_redis", "get_cache", "get_config", "get_engine",
];

/** Classify a guard function from Depends() or Security().
 *  Returns null ONLY for known non-auth dependencies.
 *  Unknown dependencies are treated as guards (return the function name). */
export function classifyGuard(guardName: string): string | null {
  const name = guardName.toLowerCase();

  if (NON_AUTH_DEPS.includes(name)) {
    return null;
  }

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

  return guardName;
}
