/** Matches @router.METHOD("path") decorated functions in FastAPI */
export const ROUTE_DECORATOR_QUERY = `
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router_var
        attribute: (identifier) @http_method
        (#match? @http_method "^(get|post|put|delete|patch|options|head)$"))
      arguments: (argument_list
        (string (string_content) @route_path))))
  definition: (function_definition
    name: (identifier) @handler_name
    parameters: (parameters) @params))
`;

/** Matches Depends(guard_function) in function parameters (typed and untyped) */
export const DEPENDS_GUARD_QUERY = `
[
  (default_parameter
    value: (call
      function: (identifier) @dep_func
      (#eq? @dep_func "Depends")
      arguments: (argument_list
        (identifier) @guard_name)))
  (typed_default_parameter
    value: (call
      function: (identifier) @dep_func
      (#eq? @dep_func "Depends")
      arguments: (argument_list
        (identifier) @guard_name)))
]
`;

/** Matches include_router(router_var, prefix="/...") with explicit prefix */
export const INCLUDE_ROUTER_WITH_PREFIX_QUERY = `
(call
  function: (attribute
    object: (identifier) @app_var
    attribute: (identifier) @method
    (#eq? @method "include_router"))
  arguments: (argument_list
    (identifier) @router_var
    (keyword_argument
      name: (identifier) @kwarg
      (#eq? @kwarg "prefix")
      value: (string (string_content) @prefix))))
`;

/** Matches include_router(router_var) without explicit prefix */
export const INCLUDE_ROUTER_NO_PREFIX_QUERY = `
(call
  function: (attribute
    object: (identifier) @app_var
    attribute: (identifier) @method
    (#eq? @method "include_router"))
  arguments: (argument_list
    (identifier) @router_var))
`;

/** Matches APIRouter(prefix="/...") constructor calls */
export const APIROUTER_CONSTRUCTOR_QUERY = `
(assignment
  left: (identifier) @var_name
  right: (call
    function: (identifier) @class_name
    (#eq? @class_name "APIRouter")
    arguments: (argument_list
      (keyword_argument
        name: (identifier) @kwarg
        (#eq? @kwarg "prefix")
        value: (string (string_content) @prefix)))))
`;

/** Matches from X import Y and from X import Y as Z */
export const IMPORT_FROM_QUERY = `
(import_from_statement
  module_name: (dotted_name) @module
  name: (dotted_name) @import_name)
`;

/** Matches aliased imports: from X import Y as Z */
export const IMPORT_FROM_ALIASED_QUERY = `
(import_from_statement
  module_name: (dotted_name) @module
  name: (aliased_import
    name: (dotted_name) @original_name
    alias: (identifier) @alias))
`;
