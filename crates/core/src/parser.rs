use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;
use streaming_iterator::StreamingIterator;

/// Result of parsing a source file with Tree-sitter.
/// Holds the source text + a reference to the tree for subsequent queries.
#[napi]
pub struct ParseResult {
    source: Arc<String>,
    tree: tree_sitter::Tree,
    language: tree_sitter::Language,
    lang_name: String,
}

/// A single match from a Tree-sitter query, with named captures.
#[napi(object)]
pub struct QueryMatch {
    pub captures: HashMap<String, CaptureInfo>,
    pub start_line: u32,
    pub end_line: u32,
}

/// Information about a captured node in a query match.
#[napi(object)]
pub struct CaptureInfo {
    pub text: String,
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
}

fn detect_language(file_path: &str) -> Result<(&str, tree_sitter::Language)> {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    match ext {
        "py" => Ok(("python", tree_sitter_python::LANGUAGE.into())),
        "ts" | "tsx" => Ok(("typescript", tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())),
        "js" | "jsx" => Ok(("javascript", tree_sitter_javascript::LANGUAGE.into())),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("Unsupported file extension: .{other}"),
        )),
    }
}

/// Parse a source file into a Tree-sitter syntax tree.
/// Returns a ParseResult that can be passed to query_tree.
#[napi]
pub fn parse_file(file_path: String) -> Result<ParseResult> {
    let source = std::fs::read_to_string(&file_path).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to read {file_path}: {e}"))
    })?;

    let (lang_name, language) = detect_language(&file_path)?;

    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&language).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to set language: {e}"))
    })?;

    let tree = parser.parse(&source, None).ok_or_else(|| {
        Error::new(Status::GenericFailure, "Tree-sitter parse returned None")
    })?;

    Ok(ParseResult {
        source: Arc::new(source),
        tree,
        language,
        lang_name: lang_name.to_string(),
    })
}

/// Parse source code from a string (not a file). Useful for testing.
#[napi]
pub fn parse_source(source: String, language: String) -> Result<ParseResult> {
    let (lang_name, ts_language) = match language.as_str() {
        "python" => ("python", tree_sitter_python::LANGUAGE.into()),
        "typescript" => ("typescript", tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "javascript" => ("javascript", tree_sitter_javascript::LANGUAGE.into()),
        other => {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Unsupported language: {other}"),
            ))
        }
    };

    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&ts_language).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Failed to set language: {e}"))
    })?;

    let tree = parser.parse(&source, None).ok_or_else(|| {
        Error::new(Status::GenericFailure, "Tree-sitter parse returned None")
    })?;

    Ok(ParseResult {
        source: Arc::new(source),
        tree,
        language: ts_language,
        lang_name: lang_name.to_string(),
    })
}

/// Run a Tree-sitter query pattern against a parsed tree.
/// Returns all matches with their captured nodes.
#[napi]
pub fn query_tree(parse_result: &ParseResult, pattern: String) -> Result<Vec<QueryMatch>> {
    let query = tree_sitter::Query::new(&parse_result.language, &pattern).map_err(|e| {
        Error::new(Status::InvalidArg, format!("Invalid query pattern: {e}"))
    })?;

    let mut cursor = tree_sitter::QueryCursor::new();
    let source_bytes = parse_result.source.as_bytes();
    let root = parse_result.tree.root_node();

    let mut results = Vec::new();
    let mut matches = cursor.matches(&query, root, source_bytes);

    while let Some(query_match) = matches.next() {
        let mut captures = HashMap::new();
        let mut min_start = u32::MAX;
        let mut max_end = 0u32;

        for capture in query_match.captures {
            let name = query.capture_names()[capture.index as usize].to_string();
            let node = capture.node;
            let text = node.utf8_text(source_bytes).unwrap_or("").to_string();
            let start_line = node.start_position().row as u32 + 1;
            let end_line = node.end_position().row as u32 + 1;

            min_start = min_start.min(start_line);
            max_end = max_end.max(end_line);

            captures.insert(
                name,
                CaptureInfo {
                    text,
                    start_line,
                    start_col: node.start_position().column as u32,
                    end_line,
                    end_col: node.end_position().column as u32,
                },
            );
        }

        if !captures.is_empty() {
            results.push(QueryMatch {
                captures,
                start_line: min_start,
                end_line: max_end,
            });
        }
    }

    Ok(results)
}

/// Get the language name detected for a ParseResult.
#[napi]
pub fn get_language_name(parse_result: &ParseResult) -> String {
    parse_result.lang_name.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_python_source() {
        let result = parse_source(
            r#"
@router.post("/items")
async def create_item(name: str):
    return {"name": name}
"#
            .to_string(),
            "python".to_string(),
        )
        .unwrap();

        assert_eq!(get_language_name(&result), "python");
    }

    #[test]
    fn test_query_python_decorated_function() {
        let result = parse_source(
            r#"
@router.post("/items")
async def create_item(name: str):
    return {"name": name}
"#
            .to_string(),
            "python".to_string(),
        )
        .unwrap();

        let matches = query_tree(
            &result,
            r#"
(decorated_definition
  (decorator
    (call
      function: (attribute
        object: (identifier) @router
        attribute: (identifier) @method)
      arguments: (argument_list
        (string (string_content) @path))))
  definition: (function_definition
    name: (identifier) @func_name))
"#
            .to_string(),
        )
        .unwrap();

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].captures["method"].text, "post");
        assert_eq!(matches[0].captures["path"].text, "/items");
        assert_eq!(matches[0].captures["func_name"].text, "create_item");
    }

    #[test]
    fn test_query_python_depends_guard() {
        let result = parse_source(
            r#"
@router.get("/items")
async def list_items(user_id: UUID = Depends(get_current_user_id)):
    return []
"#
            .to_string(),
            "python".to_string(),
        )
        .unwrap();

        let matches = query_tree(
            &result,
            r#"
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
"#
            .to_string(),
        )
        .unwrap();

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].captures["guard_name"].text, "get_current_user_id");
    }

    #[test]
    fn test_parse_typescript_source() {
        let result = parse_source(
            r#"
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const router = useRouter();
  router.push("/item/123");
}
"#
            .to_string(),
            "typescript".to_string(),
        )
        .unwrap();

        assert_eq!(get_language_name(&result), "typescript");
    }

    #[test]
    fn test_query_typescript_function_calls() {
        let result = parse_source(
            r#"
import { api } from "../lib/api";

export default function HomeScreen() {
  api.items.list().then(setItems);
  api.items.get("123").then(setItem);
}
"#
            .to_string(),
            "typescript".to_string(),
        )
        .unwrap();

        let matches = query_tree(
            &result,
            r#"
(call_expression
  function: (member_expression
    object: (member_expression
      object: (identifier) @api_obj
      (#eq? @api_obj "api")
      property: (property_identifier) @module)
    property: (property_identifier) @method))
"#
            .to_string(),
        )
        .unwrap();

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].captures["module"].text, "items");
        assert_eq!(matches[0].captures["method"].text, "list");
        assert_eq!(matches[1].captures["module"].text, "items");
        assert_eq!(matches[1].captures["method"].text, "get");
    }

    #[test]
    fn test_query_typescript_router_push() {
        let result = parse_source(
            r#"
const router = useRouter();
router.push("/item/123");
router.replace("/(tabs)");
"#
            .to_string(),
            "typescript".to_string(),
        )
        .unwrap();

        let matches = query_tree(
            &result,
            r#"
(call_expression
  function: (member_expression
    object: (identifier) @router_obj
    (#eq? @router_obj "router")
    property: (property_identifier) @nav_method
    (#match? @nav_method "^(push|replace|navigate)$"))
  arguments: (arguments
    (string (string_fragment) @target)))
"#
            .to_string(),
        )
        .unwrap();

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].captures["target"].text, "/item/123");
        assert_eq!(matches[1].captures["target"].text, "/(tabs)");
    }

    #[test]
    fn test_parse_file_from_fixture() {
        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app/app/api/items.py"
        );
        let result = parse_file(fixture_path.to_string()).unwrap();
        assert_eq!(get_language_name(&result), "python");

        let matches = query_tree(
            &result,
            r#"
(decorated_definition
  (decorator
    (call
      function: (attribute
        attribute: (identifier) @method
        (#match? @method "^(get|post|put|delete|patch)$"))))
  definition: (function_definition
    name: (identifier) @func_name))
"#
            .to_string(),
        )
        .unwrap();

        assert_eq!(matches.len(), 3, "Expected 3 routes in items.py");
    }

    #[test]
    fn test_unsupported_language_returns_error() {
        let result = parse_source("fn main() {}".to_string(), "rust".to_string());
        assert!(result.is_err());
    }
}
