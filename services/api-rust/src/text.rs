//! Text helpers for explicit JavaScript string operations.
pub fn slice(text: &str, max_units: usize) -> String {
    let units: Vec<_> = text.encode_utf16().take(max_units).collect();
    String::from_utf16_lossy(&units)
}
pub fn extract_json(text: &str) -> Option<serde_json::Value> {
    static FENCE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let captures = FENCE
        .get_or_init(|| regex::Regex::new(r"(?is)```(?:json)?\s*(.*?)\s*```").unwrap())
        .captures(text);
    let candidate = captures
        .as_ref()
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .unwrap_or(text)
        .trim();
    let start = candidate.find('{')?;
    let end = candidate.rfind('}')?;
    if end <= start {
        return None;
    }
    let json = &candidate[start..=end];
    if !bounded_structure(json.as_bytes(), 4096) {
        return None;
    }
    serde_json::from_str(json).ok()
}

/// Count structural tokens without allocating a JSON tree. A byte limit alone
/// permits hundreds of thousands of tiny JSON values; concurrent validation
/// could otherwise multiply a 1 MiB body into many MiB of Value allocations.
pub fn bounded_structure(bytes: &[u8], max_tokens: usize) -> bool {
    let mut quoted = false;
    let mut escaped = false;
    let mut tokens = 1usize;
    for byte in bytes {
        if quoted {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                quoted = false;
            }
        } else if *byte == b'"' {
            quoted = true;
        } else if matches!(*byte, b'{' | b'[' | b':' | b',') {
            tokens += 1;
            if tokens > max_tokens {
                return false;
            }
        }
    }
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structure_limits_ignore_quoted_and_escaped_content() {
        assert!(bounded_structure(br#"{"text":"[{},:[\"\\\"]"}"#, 4));
        assert!(!bounded_structure(b"[0,0,0,0,0]", 5));
        assert!(bounded_structure(b"[0,0,0,0,0]", 6));
    }
}
