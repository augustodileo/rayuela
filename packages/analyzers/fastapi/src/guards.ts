/** Classify a guard function name into a human-readable guard type */
export function classifyGuard(guardName: string): string {
  const name = guardName.toLowerCase();

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
  return guardName;
}
