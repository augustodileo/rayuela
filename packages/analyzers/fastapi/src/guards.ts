/** Known non-auth dependencies that should not be classified as guards */
const NON_AUTH_DEPS = [
  "get_db", "get_session", "get_database", "get_settings",
  "get_redis", "get_cache", "get_config", "get_engine",
];

/** Classify a guard function name into a human-readable guard type.
 *  Returns null for non-auth dependencies (filtered out by caller). */
export function classifyGuard(guardName: string): string | null {
  const name = guardName.toLowerCase();

  // Known non-auth dependencies
  if (NON_AUTH_DEPS.includes(name)) {
    return null;
  }

  if (name.includes("current_user") || name.includes("user_id") || name.includes("auth")) {
    return "authenticated";
  }
  if (name.includes("admin")) {
    return "role:admin";
  }
  if (name.includes("role") || name.includes("permission")) {
    return "role_check";
  }
  if (name.includes("api_key") || name.includes("apikey")) {
    return "api_key";
  }

  // Unknown dependency — not a guard
  return null;
}
