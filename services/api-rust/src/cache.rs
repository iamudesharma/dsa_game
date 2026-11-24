//! Shared payload accounting. This measures serialized payload + keys, not RSS.
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

struct Entry {
    payload: Arc<[u8]>,
    accessed: Instant,
    ttl: Duration,
    ordinal: u64,
}
pub struct Cache {
    entries: HashMap<String, Entry>,
    bytes: usize,
    budget: usize,
    next_ordinal: u64,
}
impl Cache {
    pub fn new(budget: usize) -> Self {
        Self {
            entries: HashMap::new(),
            bytes: 0,
            budget,
            next_ordinal: 0,
        }
    }
    pub fn bytes(&self) -> usize {
        self.bytes
    }
    pub fn count_prefix(&mut self, prefix: &str, now: Instant) -> usize {
        self.expire(now);
        self.entries
            .keys()
            .filter(|key| key.starts_with(prefix))
            .count()
    }
    /// Shared references only; listing metadata must not copy serialized boards.
    pub fn payloads_prefix(&mut self, prefix: &str, now: Instant) -> Vec<Arc<[u8]>> {
        self.expire(now);
        let mut entries: Vec<_> = self
            .entries
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .map(|(_, entry)| entry)
            .collect();
        entries.sort_by_key(|entry| entry.ordinal);
        entries
            .into_iter()
            .map(|entry| entry.payload.clone())
            .collect()
    }
    pub fn discard(&mut self, key: &str) {
        self.remove(key);
    }
    fn remove(&mut self, key: &str) {
        if let Some(e) = self.entries.remove(key) {
            self.bytes -= key.len() + e.payload.len();
        }
    }
    pub fn expire(&mut self, now: Instant) {
        self.entries.retain(|key, e| {
            if now.saturating_duration_since(e.accessed) >= e.ttl {
                self.bytes -= key.len() + e.payload.len();
                false
            } else {
                true
            }
        });
    }
    pub fn get(&mut self, key: &str, now: Instant) -> Option<Arc<[u8]>> {
        self.expire(now);
        let e = self.entries.get_mut(key)?;
        e.accessed = now;
        Some(e.payload.clone())
    }
    pub fn put(&mut self, key: String, payload: Arc<[u8]>, ttl: Duration, now: Instant) -> bool {
        self.expire(now);
        let Some(size) = key.len().checked_add(payload.len()) else {
            return false;
        };
        // A too-large replacement must not delete a previously valid entry.
        if size > self.budget {
            return false;
        }
        let ordinal = self
            .entries
            .get(&key)
            .map(|entry| entry.ordinal)
            .unwrap_or_else(|| {
                let ordinal = self.next_ordinal;
                self.next_ordinal = self.next_ordinal.wrapping_add(1);
                ordinal
            });
        self.remove(&key);
        while self.bytes + size > self.budget {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.accessed)
                .map(|(k, _)| k.clone());
            if let Some(oldest) = oldest {
                self.remove(&oldest);
            } else {
                break;
            }
        }
        self.bytes += size;
        self.entries.insert(
            key,
            Entry {
                payload,
                accessed: now,
                ttl,
                ordinal,
            },
        );
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_lru_ttl_and_oversize() {
        let mut cache = Cache::new(12);
        let now = Instant::now();
        let ttl = Duration::from_secs(10);
        assert!(cache.put("game".into(), Arc::from(&b"1234"[..]), ttl, now));
        assert!(!cache.put("game".into(), Arc::from(&b"123456789"[..]), ttl, now));
        assert!(cache.get("game", now).is_some());
        assert!(cache.put(
            "coach".into(),
            Arc::from(&b"12"[..]),
            ttl,
            now + Duration::from_secs(1)
        ));
        assert!(cache.get("game", now + Duration::from_secs(1)).is_none());
        assert_eq!(cache.bytes(), 7);
        cache.expire(now + Duration::from_secs(11));
        assert_eq!(cache.bytes(), 0);
    }
}
