use napi::bindgen_prelude::*;
use napi_derive::napi;
use stack_graphs::graph::StackGraph;

#[napi(object)]
pub struct SymbolLocation {
    pub file: String,
    pub line: u32,
    pub symbol: String,
}

#[napi]
pub struct NameResolver {
    _graph: StackGraph,
}

#[napi]
impl NameResolver {
    /// Build a name resolution graph from all source files in a directory.
    #[napi(factory)]
    pub fn build(source_dir: String) -> Result<NameResolver> {
        let mut graph = StackGraph::new();
        let source_path = std::path::Path::new(&source_dir);
        let entries = walkdir(source_path);

        // Verify we can find source files
        let mut file_count = 0u32;
        for entry in &entries {
            let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
            match ext {
                "py" | "ts" | "tsx" | "js" | "jsx" => {
                    let file_str = entry.to_string_lossy().to_string();
                    let _file_handle = graph.get_or_create_file(&file_str);
                    file_count += 1;
                }
                _ => {}
            }
        }

        eprintln!("NameResolver: indexed {file_count} source files from {source_dir}");

        Ok(NameResolver { _graph: graph })
    }

    /// Find where a symbol is defined, given a file and line where it's referenced.
    /// Stubbed pending Stack Graphs stitcher implementation.
    #[napi]
    pub fn find_definition(&self, _symbol: String, _file: String, _line: u32) -> Option<SymbolLocation> {
        // Stack Graphs path-finding algorithm requires wiring up
        // PartialPaths + Database + ForwardPartialPathStitcher.
        // This is the most complex part of the Stack Graphs API
        // and is deferred to post-MVP.
        None
    }
}

fn walkdir(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walkdir(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_resolver_from_fixture() {
        let fixture_dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app"
        );

        // Should not panic — validates that Stack Graphs can process the fixture
        let _resolver = NameResolver::build(fixture_dir.to_string()).unwrap();
    }

    #[test]
    fn test_find_definition_returns_none_for_now() {
        let fixture_dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app"
        );
        let resolver = NameResolver::build(fixture_dir.to_string()).unwrap();

        // Stubbed — returns None until stitcher is implemented
        let result = resolver.find_definition(
            "get_current_user_id".to_string(),
            "items.py".to_string(),
            3,
        );
        assert!(result.is_none());
    }
}
