/** Matches @router.METHOD("path") decorated functions.
 *  Uses (string) instead of (string (string_content)) to also match empty routes "". */
export const ROUTE_DECORATOR_QUERY = `
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router_var
        attribute: (identifier) @http_method
        (#match? @http_method "^(get|post|put|delete|patch|options|head)$"))
      arguments: (argument_list
        (string) @route_str)))
  definition: (function_definition
    name: (identifier) @handler_name
    parameters: (parameters) @params))
`;

/** Finds ALL Depends(X) and Security(X) calls anywhere.
 *  Handles: Depends(func), Security(func), Depends(func(...)), Security(mod.func) */
export const ALL_DEPENDS_QUERY = `
[
  (call
    function: (identifier) @dep_func
    (#match? @dep_func "^(Depends|Security)$")
    arguments: (argument_list
      (identifier) @guard_name))
  (call
    function: (identifier) @dep_func
    (#match? @dep_func "^(Depends|Security)$")
    arguments: (argument_list
      (attribute) @guard_name))
  (call
    function: (identifier) @dep_func
    (#match? @dep_func "^(Depends|Security)$")
    arguments: (argument_list
      (call
        function: (identifier) @guard_name)))
  (call
    function: (identifier) @dep_func
    (#match? @dep_func "^(Depends|Security)$")
    arguments: (argument_list
      (call
        function: (attribute) @guard_name)))
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
