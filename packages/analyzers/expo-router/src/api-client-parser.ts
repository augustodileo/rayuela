import { parseFile, queryTree } from "rayuela-core";

export interface ApiEndpoint {
  /** e.g. "api.items.list" */
  key: string;
  /** e.g. "GET" */
  httpMethod: string;
  /** e.g. "/api/v1/items" or "/api/v1/items/{id}" */
  path: string;
}

/** Tree-sitter: api.MODULE.METHOD = (...) => request("URL", ...) with string literal */
const API_STRING_URL_QUERY = `
(pair
  key: (property_identifier) @module
  value: (object
    (pair
      key: (property_identifier) @method
      value: (arrow_function
        body: (call_expression
          function: (identifier) @fn
          (#eq? @fn "request")
          arguments: (arguments
            (string (string_fragment) @url)))))))
`;

/** Tree-sitter: api.MODULE.METHOD = (...) => request(\`URL\`) with template literal */
const API_TEMPLATE_URL_QUERY = `
(pair
  key: (property_identifier) @module
  value: (object
    (pair
      key: (property_identifier) @method
      value: (arrow_function
        body: (call_expression
          function: (identifier) @fn
          (#eq? @fn "request")
          arguments: (arguments
            (template_string) @template))))))
`;

/** Tree-sitter: request("URL", { method: "POST", ... }) — extract explicit HTTP method */
const API_HTTP_METHOD_QUERY = `
(pair
  key: (property_identifier) @module
  value: (object
    (pair
      key: (property_identifier) @method_name
      value: (arrow_function
        body: (call_expression
          function: (identifier) @fn
          (#eq? @fn "request")
          arguments: (arguments
            _
            (object
              (pair
                key: (property_identifier) @opt_key
                (#eq? @opt_key "method")
                value: (string (string_fragment) @http_method)))))))))
`;

/**
 * Parse an API client file (e.g., lib/api.ts) and extract all endpoint definitions.
 * Looks for the pattern:
 *   export const api = { module: { method: (...) => request("/path", { method: "POST" }) } }
 *
 * Returns a list of ApiEndpoint with the actual HTTP method and URL extracted from source code.
 */
export function parseApiClient(apiFile: string): ApiEndpoint[] {
  const tree = parseFile(apiFile);
  const endpoints: ApiEndpoint[] = [];

  // Collect explicit HTTP methods per (module, method) pair
  const explicitMethods = new Map<string, string>();
  const methodMatches = queryTree(tree, API_HTTP_METHOD_QUERY);
  for (const m of methodMatches) {
    const mod = m.captures["module"]?.text;
    const method = m.captures["method_name"]?.text;
    const httpMethod = m.captures["http_method"]?.text;
    if (mod && method && httpMethod) {
      explicitMethods.set(`${mod}.${method}`, httpMethod.toUpperCase());
    }
  }

  // Extract string-literal URLs
  const stringMatches = queryTree(tree, API_STRING_URL_QUERY);
  for (const m of stringMatches) {
    const mod = m.captures["module"]?.text;
    const method = m.captures["method"]?.text;
    const url = m.captures["url"]?.text;
    if (mod && method && url) {
      const key = `api.${mod}.${method}`;
      const httpMethod = explicitMethods.get(`${mod}.${method}`) || "GET";
      endpoints.push({ key, httpMethod, path: url });
    }
  }

  // Extract template-literal URLs
  const templateMatches = queryTree(tree, API_TEMPLATE_URL_QUERY);
  for (const m of templateMatches) {
    const mod = m.captures["module"]?.text;
    const method = m.captures["method"]?.text;
    const template = m.captures["template"]?.text;
    if (mod && method && template) {
      const key = `api.${mod}.${method}`;
      const httpMethod = explicitMethods.get(`${mod}.${method}`) || "GET";
      // Convert `${id}` to {id} for endpoint matching
      const path = template
        .replace(/^`/, "").replace(/`$/, "")
        .replace(/\$\{(\w+)\}/g, "{$1}");
      endpoints.push({ key, httpMethod, path });
    }
  }

  return endpoints;
}

/**
 * Build a mapping from api call identifiers to full endpoint IDs.
 * e.g., "api.items.list" → "GET /api/v1/items"
 */
export function buildApiMapping(endpoints: ApiEndpoint[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const ep of endpoints) {
    mapping.set(ep.key, `${ep.httpMethod} ${ep.path}`);
  }
  return mapping;
}
