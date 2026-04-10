use napi::bindgen_prelude::*;
use napi_derive::napi;
use sha2::{Sha256, Digest};
use std::collections::HashMap;

/// The kind of code element a trace node represents.
#[napi(string_enum)]
#[derive(Debug, PartialEq, Eq, Hash)]
pub enum TraceKind {
    Endpoint,
    Screen,
    Guard,
    Service,
    Repository,
    External,
    Function,
}

/// A single trace node. Immutable after construction.
/// Identity is structural: hash = SHA-256(symbol, kind, parameters, children_hashes).
#[napi(object)]
#[derive(Clone, Debug)]
pub struct Trace {
    pub hash: String,
    pub symbol: String,
    pub file: String,
    pub line: u32,
    pub kind: TraceKind,
    pub parameters: Vec<String>,
    pub children: Vec<String>,
}

/// Expanded tree form of a trace (for display, not storage).
#[napi(object)]
#[derive(Clone, Debug)]
pub struct TraceTree {
    pub hash: String,
    pub symbol: String,
    pub file: String,
    pub line: u32,
    pub kind: TraceKind,
    pub parameters: Vec<String>,
    pub children: Vec<TraceTree>,
}

/// Compute structural hash for a trace.
/// Includes symbol, kind, parameters, children hashes.
/// Deliberately excludes file/line (source location is metadata, not identity).
fn compute_hash(
    symbol: &str,
    kind: &TraceKind,
    parameters: &[String],
    children_hashes: &[String],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(symbol.as_bytes());
    hasher.update(b"|");
    hasher.update(format!("{:?}", kind).as_bytes());
    hasher.update(b"|");
    for param in parameters {
        hasher.update(param.as_bytes());
        hasher.update(b",");
    }
    hasher.update(b"|");
    for ch in children_hashes {
        hasher.update(ch.as_bytes());
        hasher.update(b",");
    }
    format!("{:x}", hasher.finalize())
}

/// Hash-consed store for traces. Each unique structural trace is stored exactly once.
#[napi]
pub struct TraceStore {
    traces: HashMap<String, Trace>,
    symbol_index: HashMap<String, Vec<String>>,
    roots: Vec<String>,
}

#[napi]
impl TraceStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        TraceStore {
            traces: HashMap::new(),
            symbol_index: HashMap::new(),
            roots: Vec::new(),
        }
    }

    /// Insert a leaf trace (no children). Returns its hash.
    #[napi]
    pub fn insert_leaf(
        &mut self,
        symbol: String,
        file: String,
        line: u32,
        kind: TraceKind,
        parameters: Vec<String>,
    ) -> String {
        let hash = compute_hash(&symbol, &kind, &parameters, &[]);
        if !self.traces.contains_key(&hash) {
            self.traces.insert(hash.clone(), Trace {
                hash: hash.clone(),
                symbol: symbol.clone(),
                file,
                line,
                kind,
                parameters,
                children: vec![],
            });
            self.symbol_index.entry(symbol).or_default().push(hash.clone());
        }
        hash
    }

    /// Insert a composite trace with children. Returns its hash.
    #[napi]
    pub fn insert(
        &mut self,
        symbol: String,
        file: String,
        line: u32,
        kind: TraceKind,
        parameters: Vec<String>,
        children_hashes: Vec<String>,
    ) -> Result<String> {
        for ch in &children_hashes {
            if !self.traces.contains_key(ch) {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!("Child trace not found: {ch}"),
                ));
            }
        }
        let hash = compute_hash(&symbol, &kind, &parameters, &children_hashes);
        if !self.traces.contains_key(&hash) {
            self.traces.insert(hash.clone(), Trace {
                hash: hash.clone(),
                symbol: symbol.clone(),
                file,
                line,
                kind,
                parameters,
                children: children_hashes,
            });
            self.symbol_index.entry(symbol).or_default().push(hash.clone());
        }
        Ok(hash)
    }

    /// Mark a trace as a root entry point.
    #[napi]
    pub fn add_root(&mut self, hash: String) -> Result<()> {
        if !self.traces.contains_key(&hash) {
            return Err(Error::new(Status::InvalidArg, "Trace not found"));
        }
        if !self.roots.contains(&hash) {
            self.roots.push(hash);
        }
        Ok(())
    }

    /// Get a trace by hash.
    #[napi]
    pub fn get(&self, hash: String) -> Option<Trace> {
        self.traces.get(&hash).cloned()
    }

    /// Get all root traces.
    #[napi]
    pub fn get_roots(&self) -> Vec<Trace> {
        self.roots.iter().filter_map(|h| self.traces.get(h).cloned()).collect()
    }

    /// Find all traces whose symbol matches.
    #[napi]
    pub fn find_by_symbol(&self, symbol: String) -> Vec<Trace> {
        self.symbol_index.get(&symbol)
            .map(|hashes| hashes.iter().filter_map(|h| self.traces.get(h).cloned()).collect())
            .unwrap_or_default()
    }

    /// Find all root traces that transitively contain a node with the given symbol.
    #[napi]
    pub fn find_roots_containing(&self, symbol: String) -> Vec<Trace> {
        let target_hashes: std::collections::HashSet<String> = self.symbol_index
            .get(&symbol).cloned().unwrap_or_default().into_iter().collect();
        if target_hashes.is_empty() { return vec![]; }

        self.roots.iter()
            .filter(|h| self.subtree_contains(h, &target_hashes))
            .filter_map(|h| self.traces.get(h).cloned())
            .collect()
    }

    /// Find root traces missing a specific guard in parameters.
    #[napi]
    pub fn find_roots_missing_guard(&self, guard_name: String) -> Vec<Trace> {
        let guard_param = format!("guard:{guard_name}");
        self.roots.iter()
            .filter_map(|h| self.traces.get(h))
            .filter(|t| !self.subtree_has_param(t, &guard_param))
            .cloned()
            .collect()
    }

    /// Expand a trace into a full tree for display.
    #[napi]
    pub fn expand(&self, hash: String) -> Option<TraceTree> {
        self.expand_inner(&hash, &mut std::collections::HashSet::new())
    }

    /// Total unique traces.
    #[napi]
    pub fn len(&self) -> u32 {
        self.traces.len() as u32
    }

    /// Number of root traces.
    #[napi]
    pub fn root_count(&self) -> u32 {
        self.roots.len() as u32
    }

    fn subtree_contains(&self, hash: &str, targets: &std::collections::HashSet<String>) -> bool {
        if targets.contains(hash) { return true; }
        if let Some(trace) = self.traces.get(hash) {
            for ch in &trace.children {
                if self.subtree_contains(ch, targets) { return true; }
            }
        }
        false
    }

    fn subtree_has_param(&self, trace: &Trace, param: &str) -> bool {
        if trace.parameters.iter().any(|p| p == param) { return true; }
        for ch in &trace.children {
            if let Some(child) = self.traces.get(ch) {
                if self.subtree_has_param(child, param) { return true; }
            }
        }
        false
    }

    fn expand_inner(&self, hash: &str, visited: &mut std::collections::HashSet<String>) -> Option<TraceTree> {
        let trace = self.traces.get(hash)?;
        let children = if visited.contains(hash) {
            vec![]
        } else {
            visited.insert(hash.to_string());
            trace.children.iter()
                .filter_map(|ch| self.expand_inner(ch, visited))
                .collect()
        };
        Some(TraceTree {
            hash: trace.hash.clone(),
            symbol: trace.symbol.clone(),
            file: trace.file.clone(),
            line: trace.line,
            kind: trace.kind.clone(),
            parameters: trace.parameters.clone(),
            children,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leaf_deduplication() {
        let mut store = TraceStore::new();
        let h1 = store.insert_leaf("jwt.decode".into(), "auth.py".into(), 13, TraceKind::External, vec![]);
        let h2 = store.insert_leaf("jwt.decode".into(), "other.py".into(), 99, TraceKind::External, vec![]);
        // Same symbol + kind + params → same hash (file/line excluded from hash)
        assert_eq!(h1, h2);
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn test_different_params_different_hash() {
        let mut store = TraceStore::new();
        let h1 = store.insert_leaf("endpoint".into(), "a.py".into(), 1, TraceKind::Endpoint, vec!["guard:auth".into()]);
        let h2 = store.insert_leaf("endpoint".into(), "a.py".into(), 1, TraceKind::Endpoint, vec![]);
        assert_ne!(h1, h2);
        assert_eq!(store.len(), 2);
    }

    #[test]
    fn test_composite_trace() {
        let mut store = TraceStore::new();
        let jwt = store.insert_leaf("jwt.decode".into(), "auth.py".into(), 13, TraceKind::External, vec![]);
        let bearer = store.insert_leaf("HTTPBearer".into(), "auth.py".into(), 6, TraceKind::External, vec![]);

        let guard = store.insert(
            "get_current_user_id".into(), "auth.py".into(), 9,
            TraceKind::Guard, vec!["guard:authenticated".into()],
            vec![jwt.clone(), bearer.clone()],
        ).unwrap();

        let endpoint = store.insert(
            "POST /api/v1/items".into(), "items.py".into(), 10,
            TraceKind::Endpoint, vec!["guard:authenticated".into()],
            vec![guard.clone()],
        ).unwrap();

        store.add_root(endpoint.clone()).unwrap();

        assert_eq!(store.len(), 4); // jwt, bearer, guard, endpoint
        assert_eq!(store.root_count(), 1);

        // Find roots containing jwt.decode
        let roots = store.find_roots_containing("jwt.decode".into());
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].symbol, "POST /api/v1/items");

        // Expand the tree
        let tree = store.expand(endpoint).unwrap();
        assert_eq!(tree.symbol, "POST /api/v1/items");
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].symbol, "get_current_user_id");
        assert_eq!(tree.children[0].children.len(), 2);
    }

    #[test]
    fn test_shared_subtrees() {
        let mut store = TraceStore::new();
        let jwt = store.insert_leaf("jwt.decode".into(), "auth.py".into(), 13, TraceKind::External, vec![]);
        let guard = store.insert(
            "get_current_user_id".into(), "auth.py".into(), 9,
            TraceKind::Guard, vec![],
            vec![jwt.clone()],
        ).unwrap();

        // Two endpoints sharing the same guard
        let ep1 = store.insert(
            "POST /api/items".into(), "items.py".into(), 10,
            TraceKind::Endpoint, vec!["guard:authenticated".into()],
            vec![guard.clone()],
        ).unwrap();
        let ep2 = store.insert(
            "GET /api/items".into(), "items.py".into(), 15,
            TraceKind::Endpoint, vec!["guard:authenticated".into()],
            vec![guard.clone()],
        ).unwrap();

        store.add_root(ep1.clone()).unwrap();
        store.add_root(ep2.clone()).unwrap();

        // Guard and jwt are shared, not duplicated
        assert_eq!(store.len(), 4); // jwt, guard, ep1, ep2
        assert_eq!(store.root_count(), 2);

        // Both roots contain jwt.decode
        let roots = store.find_roots_containing("jwt.decode".into());
        assert_eq!(roots.len(), 2);
    }

    #[test]
    fn test_find_roots_missing_guard() {
        let mut store = TraceStore::new();

        let guarded = store.insert_leaf(
            "POST /api/items".into(), "items.py".into(), 10,
            TraceKind::Endpoint, vec!["guard:authenticated".into()],
        );
        let unguarded = store.insert_leaf(
            "GET /health".into(), "main.py".into(), 5,
            TraceKind::Endpoint, vec![],
        );

        store.add_root(guarded).unwrap();
        store.add_root(unguarded).unwrap();

        let missing = store.find_roots_missing_guard("authenticated".into());
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].symbol, "GET /health");
    }

    #[test]
    fn test_cycle_handling_in_expand() {
        let mut store = TraceStore::new();
        // Create a "cycle" by manually having a node reference itself as child
        let leaf = store.insert_leaf("func_a".into(), "a.py".into(), 1, TraceKind::Function, vec![]);
        // Insert func_b that calls func_a
        let func_b = store.insert(
            "func_b".into(), "b.py".into(), 1,
            TraceKind::Function, vec![],
            vec![leaf.clone()],
        ).unwrap();

        store.add_root(func_b.clone()).unwrap();

        // Expand should not infinite loop
        let tree = store.expand(func_b).unwrap();
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].symbol, "func_a");
    }
}
