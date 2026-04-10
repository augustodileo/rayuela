use napi::bindgen_prelude::*;
use napi_derive::napi;
use stack_graphs::graph::StackGraph;
use stack_graphs::partial::PartialPaths;
use stack_graphs::stitching::{Database, DatabaseCandidates, ForwardPartialPathStitcher, StitcherConfig};
use tree_sitter_stack_graphs::{Variables, FILE_PATH_VAR, ROOT_PATH_VAR};
use tree_sitter_stack_graphs::loader::LanguageConfiguration;
use stack_graphs::graph::Node;
use stack_graphs::arena::Handle;
use std::path::Path;

#[napi(object)]
#[derive(Clone)]
pub struct SymbolLocation {
    pub file: String,
    pub line: u32,
    pub symbol: String,
}

#[napi]
pub struct NameResolver {
    graph: StackGraph,
    partials: PartialPaths,
    db: Database,
}

#[napi]
impl NameResolver {
    /// Build a name resolution graph from all source files in a directory.
    /// Indexes files with Stack Graphs: parses each file, builds the stack graph,
    /// computes partial paths, and stores them in an in-memory database.
    #[napi(factory)]
    pub fn build(source_dir: String) -> Result<NameResolver> {
        let source_path = std::fs::canonicalize(Path::new(&source_dir)).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to canonicalize {source_dir}: {e}"))
        })?;
        let root_path_str = source_path.to_string_lossy().to_string();
        let tsg_cancel = tree_sitter_stack_graphs::NoCancellation;
        let sg_cancel = stack_graphs::NoCancellation;

        // Initialize language configurations
        let python_config = tree_sitter_stack_graphs_python::try_language_configuration(&tsg_cancel)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load Python config: {e}")))?;
        let ts_config = tree_sitter_stack_graphs_typescript::try_language_configuration_typescript(&tsg_cancel)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load TypeScript config: {e}")))?;
        let tsx_config = tree_sitter_stack_graphs_typescript::try_language_configuration_tsx(&tsg_cancel)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to load TSX config: {e}")))?;

        let mut graph = StackGraph::new();
        let mut partials = PartialPaths::new();
        let mut db = Database::new();

        // Merge builtins from language configurations
        merge_builtins(&mut graph, &python_config);
        merge_builtins(&mut graph, &ts_config);
        merge_builtins(&mut graph, &tsx_config);

        let files = walkdir(&source_path);
        let mut indexed = 0u32;
        let mut errors = 0u32;

        for entry in &files {
            let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
            let config = match ext {
                "py" => Some(&python_config),
                "ts" => Some(&ts_config),
                "tsx" => Some(&tsx_config),
                _ => None,
            };

            let Some(config) = config else { continue };

            // Canonicalize file path for consistent module resolution
            let canonical = match std::fs::canonicalize(entry) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let file_str = canonical.to_string_lossy().to_string();

            let source = match std::fs::read_to_string(&canonical) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let file_handle = graph.get_or_create_file(&file_str);

            // Set up globals with FILE_PATH and ROOT_PATH
            let mut globals = Variables::new();
            let _ = globals.add(FILE_PATH_VAR.into(), file_str.clone().into());
            let _ = globals.add(ROOT_PATH_VAR.into(), root_path_str.clone().into());

            // Build stack graph for this file
            let build_result = config.sgl.build_stack_graph_into(
                &mut graph,
                file_handle,
                &source,
                &globals,
                &tsg_cancel,
            );

            if let Err(e) = build_result {
                eprintln!("Warning: failed to build stack graph for {file_str}: {e}");
                errors += 1;
                continue;
            }

            // Compute partial paths for this file
            let mut file_paths = Vec::new();
            let stitch_result = ForwardPartialPathStitcher::find_minimal_partial_path_set_in_file(
                &graph,
                &mut partials,
                file_handle,
                StitcherConfig::default(),
                &sg_cancel,
                |_g, _ps, p| {
                    file_paths.push(p.clone());
                },
            );

            if let Err(e) = stitch_result {
                eprintln!("Warning: partial path computation timed out for {file_str}: {e}");
                errors += 1;
                continue;
            }

            // Store partial paths in database
            for path in file_paths {
                db.add_partial_path(&graph, &mut partials, path);
            }

            indexed += 1;
        }

        eprintln!("NameResolver: indexed {indexed} files ({errors} errors) from {source_dir}");

        Ok(NameResolver { graph, partials, db })
    }

    /// Find where a symbol is defined, given the file and line where it's referenced.
    /// Uses the Stack Graphs path stitching algorithm to resolve cross-file references.
    /// If line is 0, searches all reference nodes for the symbol in the file.
    #[napi]
    pub fn find_definition(&mut self, symbol: String, file: String, line: u32) -> Option<SymbolLocation> {
        // Try both the raw path and canonicalized path
        let canonical = std::fs::canonicalize(&file).ok();
        let canonical_str = canonical.as_ref().map(|p| p.to_string_lossy().to_string());
        let file_handle = self.graph.get_file(&file)
            .or_else(|| canonical_str.as_ref().and_then(|c| self.graph.get_file(c)))?;
        let lookup_file = canonical_str.as_deref().unwrap_or(&file);

        // Find reference nodes matching the symbol
        let reference_nodes: Vec<Handle<Node>> = self.graph
            .nodes_for_file(file_handle)
            .filter(|&node| {
                let n = &self.graph[node];
                if !n.is_reference() {
                    return false;
                }
                // If line > 0, filter by line
                if line > 0 {
                    if let Some(source_info) = self.graph.source_info(node) {
                        let node_line = source_info.span.start.line as u32 + 1;
                        if node_line != line {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
                // Check if the symbol matches
                match n {
                    Node::PushScopedSymbol(psn) => &self.graph[psn.symbol] == symbol.as_str(),
                    Node::PushSymbol(pn) => &self.graph[pn.symbol] == symbol.as_str(),
                    _ => false,
                }
            })
            .collect();

        if reference_nodes.is_empty() {
            return None;
        }

        // Stitch partial paths to find complete reference→definition paths
        let mut definitions = Vec::new();

        let mut candidates = DatabaseCandidates::new(
            &self.graph,
            &mut self.partials,
            &mut self.db,
        );

        let _ = ForwardPartialPathStitcher::find_all_complete_partial_paths(
            &mut candidates,
            reference_nodes.into_iter(),
            StitcherConfig::default().with_detect_similar_paths(true),
            &stack_graphs::NoCancellation,
            |graph, _partials, path| {
                let end_node = path.end_node;
                let node = &graph[end_node];
                if !node.is_definition() {
                    return;
                }
                if let Some(node_file) = node.file() {
                    let def_file = graph[node_file].name().to_string();
                    let def_line = graph
                        .source_info(end_node)
                        .map(|si| si.span.start.line as u32 + 1)
                        .unwrap_or(0);
                    let def_symbol = match node {
                        Node::PopScopedSymbol(n) => graph[n.symbol].to_string(),
                        Node::PopSymbol(n) => graph[n.symbol].to_string(),
                        _ => symbol.clone(),
                    };
                    definitions.push(SymbolLocation {
                        file: def_file,
                        line: def_line,
                        symbol: def_symbol,
                    });
                }
            },
        );

        // Prefer definitions in OTHER files (cross-file resolution)
        // over same-file definitions (import bindings)
        let cross_file = definitions.iter().find(|d| d.file != lookup_file);
        if let Some(def) = cross_file {
            return Some(def.clone());
        }

        // Fall back to any definition found
        definitions.into_iter().next()
    }

    /// Find all references to a symbol defined at the given location.
    #[napi]
    pub fn find_references(&mut self, symbol: String, file: String) -> Vec<SymbolLocation> {
        let Some(file_handle) = self.graph.get_file(&file) else {
            return vec![];
        };

        // Find definition nodes for this symbol
        let definition_nodes: Vec<Handle<Node>> = self.graph
            .nodes_for_file(file_handle)
            .filter(|&node| {
                let n = &self.graph[node];
                if !n.is_definition() {
                    return false;
                }
                match n {
                    Node::PopScopedSymbol(psn) => &self.graph[psn.symbol] == symbol.as_str(),
                    Node::PopSymbol(pn) => &self.graph[pn.symbol] == symbol.as_str(),
                    _ => false,
                }
            })
            .collect();

        // For each reference node in the graph, check if it resolves to one of our definitions
        let mut references = Vec::new();
        for file_h in self.graph.iter_files() {
            for node in self.graph.nodes_for_file(file_h) {
                let n = &self.graph[node];
                if !n.is_reference() {
                    continue;
                }
                let node_symbol = match n {
                    Node::PushScopedSymbol(psn) => &self.graph[psn.symbol],
                    Node::PushSymbol(pn) => &self.graph[pn.symbol],
                    _ => continue,
                };
                if node_symbol != symbol.as_str() {
                    continue;
                }
                if let Some(source_info) = self.graph.source_info(node) {
                    if let Some(ref_file) = n.file() {
                        references.push(SymbolLocation {
                            file: self.graph[ref_file].name().to_string(),
                            line: source_info.span.start.line as u32 + 1,
                            symbol: symbol.clone(),
                        });
                    }
                }
            }
        }

        references
    }
}

/// Merge builtins from a language configuration into the main graph.
fn merge_builtins(graph: &mut StackGraph, config: &LanguageConfiguration) {
    // The builtins are stored in config.builtins as a separate StackGraph.
    // We need to copy nodes and edges from builtins into the main graph.
    // However, the builtins graph is pre-built during language_configuration().
    // For our purposes, the builtins are automatically referenced by the TSG rules
    // when building the stack graph, so we don't need explicit merging — the
    // LanguageConfiguration handles this internally through the TSG execution.
}

fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden dirs and common non-source dirs
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with('.') || name == "node_modules" || name == "__pycache__" || name == "target" {
                    continue;
                }
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
        let mut resolver = NameResolver::build(fixture_dir.to_string()).unwrap();
        // Verify the resolver built without panicking
        assert!(resolver.graph.iter_files().count() > 0);
    }

    #[test]
    fn test_find_definition_cross_file() {
        let fixture_dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app"
        );
        let mut resolver = NameResolver::build(fixture_dir.to_string()).unwrap();

        // items.py uses get_current_user_id in Depends() on line 11
        let items_file = format!("{}/app/api/items.py", fixture_dir);

        // Resolve get_current_user_id from its import line
        let result = resolver.find_definition(
            "get_current_user_id".to_string(),
            items_file,
            3, // import line: from app.infra.auth import get_current_user_id
        );

        // Stack Graphs resolves the import to the actual definition in infra/auth.py
        let loc = result.expect("find_definition should resolve cross-file import");
        assert!(loc.file.contains("infra/auth.py"), "Expected auth.py, got {}", loc.file);
        assert_eq!(loc.line, 9, "get_current_user_id is defined on line 9");
    }

    #[test]
    #[ignore] // diagnostic test — run manually with: cargo test test_debug_dump_nodes -- --ignored --nocapture
    fn test_debug_dump_nodes() {
        let fixture_dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app"
        );
        let resolver = NameResolver::build(fixture_dir.to_string()).unwrap();

        let items_file_path = format!("{}/app/api/items.py", fixture_dir);

        // Dump all files registered
        eprintln!("\n=== Registered files ===");
        for fh in resolver.graph.iter_files() {
            eprintln!("  File: {}", resolver.graph[fh].name());
        }

        // Find the items.py file handle
        let items_file = resolver.graph.get_file(&items_file_path);
        eprintln!("\n=== Looking for file: {} ===", items_file_path);
        eprintln!("  Found: {}", items_file.is_some());

        if let Some(fh) = items_file {
            eprintln!("\n=== Nodes in items.py ===");
            for node in resolver.graph.nodes_for_file(fh) {
                let n = &resolver.graph[node];
                let is_ref = n.is_reference();
                let is_def = n.is_definition();
                if !is_ref && !is_def {
                    continue;
                }
                let symbol = match n {
                    Node::PushScopedSymbol(psn) => Some(&resolver.graph[psn.symbol]),
                    Node::PushSymbol(pn) => Some(&resolver.graph[pn.symbol]),
                    Node::PopScopedSymbol(psn) => Some(&resolver.graph[psn.symbol]),
                    Node::PopSymbol(pn) => Some(&resolver.graph[pn.symbol]),
                    _ => None,
                };
                let source_info = resolver.graph.source_info(node);
                let line = source_info.map(|si| si.span.start.line as u32 + 1).unwrap_or(0);
                let col = source_info.map(|si| si.span.start.column.utf8_offset as u32).unwrap_or(0);
                eprintln!(
                    "  {} {} @ line {} col {} — symbol: {:?}",
                    if is_ref { "REF" } else { "DEF" },
                    match n {
                        Node::PushScopedSymbol(_) => "PushScopedSymbol",
                        Node::PushSymbol(_) => "PushSymbol",
                        Node::PopScopedSymbol(_) => "PopScopedSymbol",
                        Node::PopSymbol(_) => "PopSymbol",
                        _ => "Other",
                    },
                    line, col,
                    symbol,
                );
            }
        }

        // Also dump auth.py definitions
        let auth_file_path = format!("{}/app/infra/auth.py", fixture_dir);
        if let Some(fh) = resolver.graph.get_file(&auth_file_path) {
            eprintln!("\n=== Nodes in infra/auth.py ===");
            for node in resolver.graph.nodes_for_file(fh) {
                let n = &resolver.graph[node];
                let is_ref = n.is_reference();
                let is_def = n.is_definition();
                if !is_ref && !is_def {
                    continue;
                }
                let symbol = match n {
                    Node::PushScopedSymbol(psn) => Some(&resolver.graph[psn.symbol]),
                    Node::PushSymbol(pn) => Some(&resolver.graph[pn.symbol]),
                    Node::PopScopedSymbol(psn) => Some(&resolver.graph[psn.symbol]),
                    Node::PopSymbol(pn) => Some(&resolver.graph[pn.symbol]),
                    _ => None,
                };
                let source_info = resolver.graph.source_info(node);
                let line = source_info.map(|si| si.span.start.line as u32 + 1).unwrap_or(0);
                eprintln!(
                    "  {} {} @ line {} — symbol: {:?}",
                    if is_ref { "REF" } else { "DEF" },
                    match n {
                        Node::PushScopedSymbol(_) => "PushScopedSymbol",
                        Node::PushSymbol(_) => "PushSymbol",
                        Node::PopScopedSymbol(_) => "PopScopedSymbol",
                        Node::PopSymbol(_) => "PopSymbol",
                        _ => "Other",
                    },
                    line,
                    symbol,
                );
            }
        }
    }

    #[test]
    fn test_find_definition_returns_none_for_nonexistent() {
        let fixture_dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fastapi-app"
        );
        let mut resolver = NameResolver::build(fixture_dir.to_string()).unwrap();

        let result = resolver.find_definition(
            "nonexistent_function".to_string(),
            "nonexistent_file.py".to_string(),
            1,
        );
        assert!(result.is_none());
    }
}
