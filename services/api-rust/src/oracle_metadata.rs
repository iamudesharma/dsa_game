//! Client-visible source listings are static data, never executed by the service.
use serde_json::Value;
pub fn get(id: &str) -> &'static Value {
    static DATA: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    &DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/oracles.json"))
            .expect("checked-in oracle metadata")
    })[id]
}
