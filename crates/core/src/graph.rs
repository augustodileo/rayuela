use napi::bindgen_prelude::*;
use napi_derive::napi;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::algo::has_path_connecting;
use std::collections::HashMap;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct GraphNodeData {
    pub node_type: String,
    pub id: String,
    pub file: String,
    pub line: u32,
    pub guards: Vec<String>,
    pub conditions: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct GraphEdgeData {
    pub edge_type: String,
    pub from_id: String,
    pub to_id: String,
    pub file: String,
    pub line: u32,
}

#[napi]
pub struct AppGraph {
    graph: DiGraph<GraphNodeData, GraphEdgeData>,
    node_index: HashMap<String, NodeIndex>,
}

#[napi]
impl AppGraph {
    #[napi(constructor)]
    pub fn new() -> Self {
        AppGraph {
            graph: DiGraph::new(),
            node_index: HashMap::new(),
        }
    }

    #[napi]
    pub fn add_node(&mut self, node: GraphNodeData) {
        let id = node.id.clone();
        if !self.node_index.contains_key(&id) {
            let idx = self.graph.add_node(node);
            self.node_index.insert(id, idx);
        }
    }

    #[napi]
    pub fn add_edge(&mut self, edge: GraphEdgeData) {
        if let (Some(&from), Some(&to)) = (
            self.node_index.get(&edge.from_id),
            self.node_index.get(&edge.to_id),
        ) {
            self.graph.add_edge(from, to, edge);
        }
    }

    /// Check if there's a directed path from one node to another.
    #[napi]
    pub fn is_reachable(&self, from_id: String, to_id: String) -> bool {
        match (self.node_index.get(&from_id), self.node_index.get(&to_id)) {
            (Some(&from), Some(&to)) => has_path_connecting(&self.graph, from, to, None),
            _ => false,
        }
    }

    /// Find all nodes matching a type and glob pattern on the id.
    /// For endpoints, the pattern matches against the path portion (after the HTTP method).
    /// E.g., pattern "/api/*" matches node id "GET /api/items".
    #[napi]
    pub fn find_nodes(&self, node_type: String, pattern: String) -> Vec<GraphNodeData> {
        let matcher = globset::GlobBuilder::new(&pattern)
            .literal_separator(false)
            .build()
            .ok()
            .map(|g| g.compile_matcher());

        self.graph
            .node_weights()
            .filter(|n| {
                if n.node_type != node_type {
                    return false;
                }
                // Try matching against the full ID and also against
                // the path portion (everything after the first space, for endpoint IDs like "GET /api/items")
                let path_portion = n.id.split_once(' ').map(|(_, p)| p).unwrap_or(&n.id);
                match &matcher {
                    Some(m) => m.is_match(&n.id) || m.is_match(path_portion),
                    None => n.id.contains(&pattern),
                }
            })
            .cloned()
            .collect()
    }

    /// Find all nodes of a type that have zero incoming edges of a given edge type.
    #[napi]
    pub fn find_orphans(&self, node_type: String, edge_type: String) -> Vec<GraphNodeData> {
        self.graph
            .node_indices()
            .filter(|&idx| {
                let node = &self.graph[idx];
                node.node_type == node_type
                    && !self
                        .graph
                        .edges_directed(idx, petgraph::Direction::Incoming)
                        .any(|e| e.weight().edge_type == edge_type)
            })
            .map(|idx| self.graph[idx].clone())
            .collect()
    }

    /// Get all nodes.
    #[napi]
    pub fn get_all_nodes(&self) -> Vec<GraphNodeData> {
        self.graph.node_weights().cloned().collect()
    }

    /// Get all edges.
    #[napi]
    pub fn get_all_edges(&self) -> Vec<GraphEdgeData> {
        self.graph.edge_weights().cloned().collect()
    }

    /// Get a single node by id.
    #[napi]
    pub fn get_node(&self, id: String) -> Option<GraphNodeData> {
        self.node_index
            .get(&id)
            .map(|&idx| self.graph[idx].clone())
    }

    /// Count nodes by type.
    #[napi]
    pub fn count_nodes(&self, node_type: String) -> u32 {
        self.graph
            .node_weights()
            .filter(|n| n.node_type == node_type)
            .count() as u32
    }

    /// Check if a path exists through a sequence of node IDs.
    #[napi]
    pub fn path_exists(&self, node_ids: Vec<String>) -> bool {
        if node_ids.len() < 2 {
            return node_ids.len() == 1 && self.node_index.contains_key(&node_ids[0]);
        }
        for pair in node_ids.windows(2) {
            if !self.is_reachable(pair[0].clone(), pair[1].clone()) {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_endpoint(id: &str, guards: Vec<&str>) -> GraphNodeData {
        GraphNodeData {
            node_type: "endpoint".to_string(),
            id: id.to_string(),
            file: "test.py".to_string(),
            line: 1,
            guards: guards.into_iter().map(String::from).collect(),
            conditions: vec![],
        }
    }

    fn make_screen(id: &str, guards: Vec<&str>) -> GraphNodeData {
        GraphNodeData {
            node_type: "screen".to_string(),
            id: id.to_string(),
            file: "test.tsx".to_string(),
            line: 1,
            guards: guards.into_iter().map(String::from).collect(),
            conditions: vec![],
        }
    }

    fn make_edge(from: &str, to: &str, edge_type: &str) -> GraphEdgeData {
        GraphEdgeData {
            edge_type: edge_type.to_string(),
            from_id: from.to_string(),
            to_id: to.to_string(),
            file: "test.py".to_string(),
            line: 1,
        }
    }

    #[test]
    fn test_add_nodes_and_edges() {
        let mut graph = AppGraph::new();
        graph.add_node(make_screen("UploadScreen", vec!["authenticated"]));
        graph.add_node(make_endpoint("POST /api/items", vec!["authenticated"]));

        assert_eq!(graph.count_nodes("screen".to_string()), 1);
        assert_eq!(graph.count_nodes("endpoint".to_string()), 1);

        graph.add_edge(make_edge("UploadScreen", "POST /api/items", "calls"));

        assert!(graph.is_reachable("UploadScreen".to_string(), "POST /api/items".to_string()));
        assert!(!graph.is_reachable("POST /api/items".to_string(), "UploadScreen".to_string()));
    }

    #[test]
    fn test_transitive_reachability() {
        let mut graph = AppGraph::new();
        graph.add_node(make_screen("ScreenA", vec![]));
        graph.add_node(make_endpoint("POST /api/foo", vec![]));
        graph.add_node(make_screen("ScreenB", vec![]));

        graph.add_edge(make_edge("ScreenA", "POST /api/foo", "calls"));
        graph.add_edge(make_edge("POST /api/foo", "ScreenB", "navigates"));

        assert!(graph.is_reachable("ScreenA".to_string(), "ScreenB".to_string()));
    }

    #[test]
    fn test_find_nodes_by_pattern() {
        let mut graph = AppGraph::new();
        graph.add_node(make_endpoint("GET /api/items", vec!["auth"]));
        graph.add_node(make_endpoint("POST /api/items", vec!["auth"]));
        graph.add_node(make_endpoint("GET /health", vec![]));

        let api_endpoints = graph.find_nodes("endpoint".to_string(), "/api/*".to_string());
        assert_eq!(api_endpoints.len(), 2);

        let health = graph.find_nodes("endpoint".to_string(), "/health".to_string());
        assert_eq!(health.len(), 1);
    }

    #[test]
    fn test_find_orphans() {
        let mut graph = AppGraph::new();
        graph.add_node(make_endpoint("GET /api/items", vec![]));
        graph.add_node(make_endpoint("GET /api/secret", vec![]));
        graph.add_node(make_screen("HomeScreen", vec![]));
        graph.add_edge(make_edge("HomeScreen", "GET /api/items", "calls"));

        let orphans = graph.find_orphans("endpoint".to_string(), "calls".to_string());
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].id, "GET /api/secret");
    }

    #[test]
    fn test_path_exists_through_sequence() {
        let mut graph = AppGraph::new();
        graph.add_node(make_screen("Upload", vec![]));
        graph.add_node(make_endpoint("POST /upload", vec![]));
        graph.add_node(make_screen("Detail", vec![]));

        graph.add_edge(make_edge("Upload", "POST /upload", "calls"));
        graph.add_edge(make_edge("POST /upload", "Detail", "navigates"));

        assert!(graph.path_exists(vec![
            "Upload".to_string(),
            "POST /upload".to_string(),
            "Detail".to_string(),
        ]));

        assert!(!graph.path_exists(vec![
            "Detail".to_string(),
            "Upload".to_string(),
        ]));
    }

    #[test]
    fn test_duplicate_node_not_added() {
        let mut graph = AppGraph::new();
        graph.add_node(make_endpoint("GET /api/items", vec![]));
        graph.add_node(make_endpoint("GET /api/items", vec!["auth"]));

        assert_eq!(graph.count_nodes("endpoint".to_string()), 1);
        let node = graph.get_node("GET /api/items".to_string()).unwrap();
        assert!(node.guards.is_empty());
    }

    #[test]
    fn test_get_node_returns_none_for_missing() {
        let graph = AppGraph::new();
        assert!(graph.get_node("nonexistent".to_string()).is_none());
    }
}
