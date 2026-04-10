import { parseFile, queryTree } from "rayuela-core";

export interface ApiEndpoint {
  /** e.g. "auth.signup" or "api.items.list" */
  key: string;
  /** e.g. "GET" */
  httpMethod: string;
  /** e.g. "/api/v1/items" or "/api/v1/items/{id}" */
  path: string;
}

// === Nested pattern: export const api = { module: { method: () => request(...) } } ===

const NESTED_STRING_QUERY = `
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

const NESTED_TEMPLATE_QUERY = `
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

const NESTED_METHOD_QUERY = `
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

// === Flat pattern: export const auth = { signup: () => request(...) } ===

const FLAT_STRING_QUERY = `
(variable_declarator
  name: (identifier) @module
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

const FLAT_TEMPLATE_QUERY = `
(variable_declarator
  name: (identifier) @module
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

const FLAT_METHOD_QUERY = `
(variable_declarator
  name: (identifier) @module
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
 * Parse an API client file and extract all endpoint definitions.
 * Handles both nested (api.module.method) and flat (module.method) patterns.
 */
export function parseApiClient(apiFile: string): ApiEndpoint[] {
  const tree = parseFile(apiFile);
  const endpoints: ApiEndpoint[] = [];

  // Collect explicit HTTP methods
  const explicitMethods = new Map<string, string>();
  for (const query of [NESTED_METHOD_QUERY, FLAT_METHOD_QUERY]) {
    for (const m of queryTree(tree, query)) {
      const mod = m.captures["module"]?.text;
      const method = m.captures["method_name"]?.text;
      const httpMethod = m.captures["http_method"]?.text;
      if (mod && method && httpMethod) {
        explicitMethods.set(`${mod}.${method}`, httpMethod.toUpperCase());
      }
    }
  }

  // Extract string-literal URLs (both patterns)
  for (const query of [NESTED_STRING_QUERY, FLAT_STRING_QUERY]) {
    for (const m of queryTree(tree, query)) {
      const mod = m.captures["module"]?.text;
      const method = m.captures["method"]?.text;
      const url = m.captures["url"]?.text;
      if (mod && method && url) {
        const key = `${mod}.${method}`;
        if (!endpoints.some((e) => e.key === key)) {
          const httpMethod = explicitMethods.get(key) || "GET";
          endpoints.push({ key, httpMethod, path: url });
        }
      }
    }
  }

  // Extract template-literal URLs (both patterns)
  for (const query of [NESTED_TEMPLATE_QUERY, FLAT_TEMPLATE_QUERY]) {
    for (const m of queryTree(tree, query)) {
      const mod = m.captures["module"]?.text;
      const method = m.captures["method"]?.text;
      const template = m.captures["template"]?.text;
      if (mod && method && template) {
        const key = `${mod}.${method}`;
        if (!endpoints.some((e) => e.key === key)) {
          const httpMethod = explicitMethods.get(key) || "GET";
          const path = template
            .replace(/^`/, "").replace(/`$/, "")
            .replace(/\$\{(\w+)\}/g, "{$1}")
            .replace(/\?.*$/, ""); // Strip query params
          endpoints.push({ key, httpMethod, path });
        }
      }
    }
  }

  return endpoints;
}

/**
 * Build a mapping from API call identifiers to full endpoint IDs.
 */
export function buildApiMapping(endpoints: ApiEndpoint[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const ep of endpoints) {
    mapping.set(ep.key, `${ep.httpMethod} ${ep.path}`);
  }
  return mapping;
}
