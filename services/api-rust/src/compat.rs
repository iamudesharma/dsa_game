//! JavaScript unsigned conversion and mulberry32, shared by seeded oracles.
pub fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    value.trunc().rem_euclid(4294967296.0) as u32
}
/// ECMAScript WhiteSpace + LineTerminator (Rust trim differs at FEFF/0085).
pub fn trim(value: &str) -> &str {
    value.trim_matches(|c: char| {
        matches!(
            c,
            '\t' | '\n'
                | '\r'
                | '\u{000b}'
                | '\u{000c}'
                | ' '
                | '\u{00a0}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200a}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202f}'
                    | '\u{205f}'
                    | '\u{3000}'
                    | '\u{feff}'
        )
    })
}
/// Number(queryString), including empty strings and radix notation.
pub fn number(value: &str) -> f64 {
    let value = trim(value);
    if value.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(digits) = value.strip_prefix(prefix) {
            if digits.is_empty() {
                return f64::NAN;
            }
            return digits
                .chars()
                .try_fold(0.0, |n, c| {
                    c.to_digit(radix).map(|v| n * (radix as f64) + (v as f64))
                })
                .unwrap_or(f64::NAN);
        }
    }
    value.parse().unwrap_or(f64::NAN)
}
/// Node Buffer.from(cursor, 'base64url') accepts either alphabet, ignores
/// punctuation, and tolerates missing padding and trailing partial bytes.
pub fn cursor(value: &str) -> Option<String> {
    use base64::{
        alphabet,
        engine::{
            general_purpose::{GeneralPurpose, GeneralPurposeConfig},
            DecodePaddingMode,
        },
        Engine,
    };
    let mut clean: Vec<u8> = value
        .bytes()
        .take_while(|c| *c != b'=')
        .filter_map(|c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' => Some(c),
            b'+' => Some(b'-'),
            b'/' => Some(b'_'),
            _ => None,
        })
        .collect();
    if clean.len() % 4 == 1 {
        clean.pop();
    }
    let engine = GeneralPurpose::new(
        &alphabet::URL_SAFE,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    engine
        .decode(clean)
        .ok()
        .map(|v| String::from_utf8_lossy(&v).into_owned())
        .filter(|s| !s.is_empty())
}
pub struct Rng {
    state: u32,
}
impl Rng {
    pub fn new(seed: f64) -> Self {
        Self {
            state: to_uint32(seed),
        }
    }
    pub fn sample(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsigned_conversions() {
        assert_eq!(to_uint32(-1.0), u32::MAX);
        assert_eq!(to_uint32(4294967297.0), 1);
        assert_eq!(to_uint32(f64::NAN), 0);
        assert_eq!(to_uint32(f64::INFINITY), 0);
        assert_eq!(to_uint32(-1.9), u32::MAX);
    }
    #[test]
    fn exact_node_mulberry32_vectors() {
        let cases = [
            (
                0.0,
                [
                    0.26642920868471265,
                    0.0003297457005828619,
                    0.2232720274478197,
                    0.1462021479383111,
                    0.46732782293111086,
                ],
            ),
            (
                1.0,
                [
                    0.6270739405881613,
                    0.002735721180215478,
                    0.5274470399599522,
                    0.9810509674716741,
                    0.9683778982143849,
                ],
            ),
            (
                -1.0,
                [
                    0.8964226141106337,
                    0.189478256739676,
                    0.7156526781618595,
                    0.9440599093213677,
                    0.8452364315744489,
                ],
            ),
        ];
        for (seed, expected) in cases {
            let mut rng = Rng::new(seed);
            for value in expected {
                assert_eq!(rng.sample(), value);
            }
        }
    }
    #[test]
    fn javascript_queries() {
        assert_eq!(number(""), 0.0);
        assert_eq!(number(" 0x10 "), 16.0);
        assert_eq!(number("0b11"), 3.0);
        assert_eq!(number("0o10"), 8.0);
        assert!(number("-0x1").is_nan());
        assert_eq!(cursor("bXNnLTI!!"), Some("msg-2".into()));
        assert_eq!(cursor("bXNnLTI=ignored"), Some("msg-2".into()));
    }
}
