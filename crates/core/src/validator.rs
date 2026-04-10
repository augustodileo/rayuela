use napi_derive::napi;
use crate::graph::AppGraph;

/// A single test from the spec file (parsed by TypeScript, passed to Rust).
#[napi(object)]
#[derive(Clone, Debug)]
pub struct SpecTest {
    pub name: String,
    pub test_type: String, // "path" | "match"
    // For "path" tests:
    pub from_id: Option<String>,
    pub through_ids: Option<Vec<String>>,
    pub to_id: Option<String>,
    // For "match" tests:
    pub match_type: Option<String>,      // "endpoint" | "screen"
    pub match_pattern: Option<String>,    // glob
    pub exclude_pattern: Option<String>,  // glob to exclude
    // Expected properties:
    pub expect_reachable: Option<bool>,
    pub expect_guards: Option<Vec<String>>,
    pub expect_min_callers: Option<u32>,
}

/// Result of validating one spec test.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    pub message: Option<String>,
    pub failures: Vec<TestFailure>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TestFailure {
    pub node_id: String,
    pub reason: String,
    pub file: String,
    pub line: u32,
}

/// Validate a list of spec tests against the graph.
#[napi]
pub fn validate_spec(graph: &AppGraph, tests: Vec<SpecTest>) -> Vec<TestResult> {
    tests.iter().map(|test| validate_one(graph, test)).collect()
}

fn validate_one(graph: &AppGraph, test: &SpecTest) -> TestResult {
    match test.test_type.as_str() {
        "path" => validate_path_test(graph, test),
        "match" => validate_match_test(graph, test),
        _ => TestResult {
            name: test.name.clone(),
            passed: false,
            message: Some(format!("Unknown test type: {}", test.test_type)),
            failures: vec![],
        },
    }
}

fn validate_path_test(graph: &AppGraph, test: &SpecTest) -> TestResult {
    let mut failures = Vec::new();

    // Build the path sequence: [from, ...through, to]
    let mut path_ids = Vec::new();
    if let Some(from) = &test.from_id {
        path_ids.push(from.clone());
    }
    if let Some(through) = &test.through_ids {
        path_ids.extend(through.clone());
    }
    if let Some(to) = &test.to_id {
        path_ids.push(to.clone());
    }

    // Check all nodes exist
    for id in &path_ids {
        if graph.get_node(id.clone()).is_none() {
            failures.push(TestFailure {
                node_id: id.clone(),
                reason: format!("{id} not found in graph"),
                file: String::new(),
                line: 0,
            });
        }
    }

    if !failures.is_empty() {
        return TestResult {
            name: test.name.clone(),
            passed: false,
            message: Some("Path contains nodes not found in graph".to_string()),
            failures,
        };
    }

    // Check reachability
    if let Some(expect_reachable) = test.expect_reachable {
        let is_reachable = if path_ids.len() >= 2 {
            graph.path_exists(path_ids.clone())
        } else if path_ids.len() == 1 {
            graph.get_node(path_ids[0].clone()).is_some()
        } else {
            false
        };

        if is_reachable != expect_reachable {
            let msg = if expect_reachable {
                "Expected path to be reachable but it is not"
            } else {
                "Expected path to NOT be reachable but it is"
            };
            failures.push(TestFailure {
                node_id: path_ids.first().cloned().unwrap_or_default(),
                reason: msg.to_string(),
                file: String::new(),
                line: 0,
            });
        }
    }

    // Check guards on all nodes in the path
    if let Some(expected_guards) = &test.expect_guards {
        for id in &path_ids {
            if let Some(node) = graph.get_node(id.clone()) {
                for guard in expected_guards {
                    if !node.guards.contains(guard) {
                        failures.push(TestFailure {
                            node_id: id.clone(),
                            reason: format!("Missing guard: {guard}"),
                            file: node.file.clone(),
                            line: node.line,
                        });
                    }
                }
            }
        }
    }

    TestResult {
        name: test.name.clone(),
        passed: failures.is_empty(),
        message: None,
        failures,
    }
}

fn validate_match_test(graph: &AppGraph, test: &SpecTest) -> TestResult {
    let node_type = test.match_type.clone().unwrap_or_default();
    let pattern = test.match_pattern.clone().unwrap_or("*".to_string());
    let mut failures = Vec::new();

    let matching_nodes = graph.find_nodes(node_type, pattern);

    // Filter out excluded nodes
    let matching_nodes: Vec<_> = if let Some(exclude) = &test.exclude_pattern {
        let exclude_matcher = globset::GlobBuilder::new(exclude)
            .literal_separator(false)
            .build()
            .ok()
            .map(|g| g.compile_matcher());

        matching_nodes
            .into_iter()
            .filter(|n| match &exclude_matcher {
                Some(m) => {
                    let path_portion = n.id.split_once(' ').map(|(_, p)| p).unwrap_or(&n.id);
                    !m.is_match(&n.id) && !m.is_match(path_portion)
                }
                None => true,
            })
            .collect()
    } else {
        matching_nodes
    };

    // Check reachability (negative assertion: "should not exist")
    if let Some(false) = test.expect_reachable {
        for node in &matching_nodes {
            failures.push(TestFailure {
                node_id: node.id.clone(),
                reason: format!("{} exists but should not be reachable", node.id),
                file: node.file.clone(),
                line: node.line,
            });
        }

        return TestResult {
            name: test.name.clone(),
            passed: failures.is_empty(),
            message: None,
            failures,
        };
    }

    // Check guards on all matching nodes
    if let Some(expected_guards) = &test.expect_guards {
        for node in &matching_nodes {
            for guard in expected_guards {
                if !node.guards.contains(guard) {
                    failures.push(TestFailure {
                        node_id: node.id.clone(),
                        reason: format!("Missing guard: {guard}"),
                        file: node.file.clone(),
                        line: node.line,
                    });
                }
            }
        }
    }

    TestResult {
        name: test.name.clone(),
        passed: failures.is_empty(),
        message: None,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{GraphNodeData, GraphEdgeData};

    fn build_test_graph() -> AppGraph {
        let mut graph = AppGraph::new();

        graph.add_node(GraphNodeData {
            node_type: "screen".to_string(),
            id: "UploadScreen".to_string(),
            file: "upload.tsx".to_string(),
            line: 1,
            guards: vec!["authenticated".to_string()],
            conditions: vec![],
        });
        graph.add_node(GraphNodeData {
            node_type: "endpoint".to_string(),
            id: "POST /api/items".to_string(),
            file: "items.py".to_string(),
            line: 10,
            guards: vec!["authenticated".to_string()],
            conditions: vec![],
        });
        graph.add_node(GraphNodeData {
            node_type: "screen".to_string(),
            id: "DetailScreen".to_string(),
            file: "detail.tsx".to_string(),
            line: 1,
            guards: vec!["authenticated".to_string()],
            conditions: vec![],
        });
        graph.add_node(GraphNodeData {
            node_type: "endpoint".to_string(),
            id: "GET /health".to_string(),
            file: "main.py".to_string(),
            line: 5,
            guards: vec![],
            conditions: vec![],
        });

        graph.add_edge(GraphEdgeData {
            edge_type: "calls".to_string(),
            from_id: "UploadScreen".to_string(),
            to_id: "POST /api/items".to_string(),
            file: "upload.tsx".to_string(),
            line: 15,
        });
        graph.add_edge(GraphEdgeData {
            edge_type: "navigates".to_string(),
            from_id: "UploadScreen".to_string(),
            to_id: "DetailScreen".to_string(),
            file: "upload.tsx".to_string(),
            line: 20,
        });

        graph
    }

    #[test]
    fn test_path_reachable_passes() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "Upload flow exists".to_string(),
            test_type: "path".to_string(),
            from_id: Some("UploadScreen".to_string()),
            through_ids: Some(vec!["POST /api/items".to_string()]),
            to_id: None,
            match_type: None,
            match_pattern: None,
            exclude_pattern: None,
            expect_reachable: Some(true),
            expect_guards: None,
            expect_min_callers: None,
        }]);

        assert!(results[0].passed);
    }

    #[test]
    fn test_path_unreachable_fails() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "Reverse path should fail".to_string(),
            test_type: "path".to_string(),
            from_id: Some("DetailScreen".to_string()),
            through_ids: None,
            to_id: Some("UploadScreen".to_string()),
            match_type: None,
            match_pattern: None,
            exclude_pattern: None,
            expect_reachable: Some(true),
            expect_guards: None,
            expect_min_callers: None,
        }]);

        assert!(!results[0].passed);
    }

    #[test]
    fn test_match_guards_passes() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "All API endpoints require auth".to_string(),
            test_type: "match".to_string(),
            from_id: None,
            through_ids: None,
            to_id: None,
            match_type: Some("endpoint".to_string()),
            match_pattern: Some("/api/*".to_string()),
            exclude_pattern: None,
            expect_reachable: None,
            expect_guards: Some(vec!["authenticated".to_string()]),
            expect_min_callers: None,
        }]);

        assert!(results[0].passed);
    }

    #[test]
    fn test_match_guards_fails_for_unguarded() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "All endpoints need auth".to_string(),
            test_type: "match".to_string(),
            from_id: None,
            through_ids: None,
            to_id: None,
            match_type: Some("endpoint".to_string()),
            match_pattern: Some("*".to_string()),
            exclude_pattern: None,
            expect_reachable: None,
            expect_guards: Some(vec!["authenticated".to_string()]),
            expect_min_callers: None,
        }]);

        assert!(!results[0].passed);
        assert_eq!(results[0].failures.len(), 1);
        assert_eq!(results[0].failures[0].node_id, "GET /health");
    }

    #[test]
    fn test_negative_assertion_no_debug_endpoints() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "No debug endpoints".to_string(),
            test_type: "match".to_string(),
            from_id: None,
            through_ids: None,
            to_id: None,
            match_type: Some("endpoint".to_string()),
            match_pattern: Some("/debug/*".to_string()),
            exclude_pattern: None,
            expect_reachable: Some(false),
            expect_guards: None,
            expect_min_callers: None,
        }]);

        assert!(results[0].passed);
    }

    #[test]
    fn test_missing_node_in_path_fails() {
        let graph = build_test_graph();
        let results = validate_spec(&graph, vec![SpecTest {
            name: "Path with nonexistent node".to_string(),
            test_type: "path".to_string(),
            from_id: Some("NonExistentScreen".to_string()),
            through_ids: None,
            to_id: Some("POST /api/items".to_string()),
            match_type: None,
            match_pattern: None,
            exclude_pattern: None,
            expect_reachable: Some(true),
            expect_guards: None,
            expect_min_callers: None,
        }]);

        assert!(!results[0].passed);
        assert!(results[0].failures[0].reason.contains("not found"));
    }
}
