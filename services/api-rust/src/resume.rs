//! Deterministic resume ingest and field-by-field model grounding.
use crate::{
    auth, contracts,
    error::ApiError,
    interview::{array, string},
    now_ms,
    provider::ChatError,
    text, AppState,
};
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::params;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};
macro_rules! re {
    ($pattern:expr) => {{
        static RE: OnceLock<regex::Regex> = OnceLock::new();
        RE.get_or_init(|| regex::Regex::new($pattern).unwrap())
    }};
}
fn units(s: &str) -> usize {
    s.encode_utf16().count()
}
fn nid(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    fn base36(mut n: u64) -> String {
        let mut bytes = Vec::new();
        loop {
            let digit = (n % 36) as u8;
            bytes.push(if digit < 10 {
                b'0' + digit
            } else {
                b'a' + digit - 10
            });
            n /= 36;
            if n == 0 {
                break;
            }
        }
        bytes.reverse();
        String::from_utf8(bytes).unwrap()
    }
    format!(
        "{prefix}:{}:{}",
        base36(now_ms() as u64),
        base36(COUNTER.fetch_add(1, Ordering::Relaxed) + 1)
    )
}
fn heading(line: &str) -> Option<&'static str> {
    let lower = line.trim().to_lowercase();
    let t = lower.trim_matches(|c: char| matches!(c, ':' | '#' | '*' | '-') || c.is_whitespace());
    if t.is_empty() || units(t) > 40 {
        return None;
    }
    for (key, aliases) in [
        ("summary", &["summary", "objective", "profile", "about"][..]),
        (
            "experience",
            &[
                "experience",
                "work experience",
                "employment",
                "work history",
                "professional experience",
            ][..],
        ),
        (
            "education",
            &["education", "academic", "university", "college", "degree"][..],
        ),
        (
            "skills",
            &[
                "skills",
                "technical skills",
                "technologies",
                "tech stack",
                "stack",
            ][..],
        ),
        (
            "projects",
            &[
                "projects",
                "side projects",
                "personal projects",
                "selected projects",
            ][..],
        ),
    ] {
        if aliases
            .iter()
            .any(|a| t == *a || t.starts_with(&format!("{a} ")))
        {
            return Some(key);
        }
    }
    None
}
fn sections(text: &str) -> HashMap<&'static str, Vec<String>> {
    let mut out: HashMap<_, Vec<String>> = HashMap::new();
    let mut current = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let cleaned =
            line.trim_start_matches(|c: char| matches!(c, '#' | '*') || c.is_whitespace());
        if let Some(colon) = cleaned.find(':') {
            if colon > 0 {
                if let Some(key) = heading(&cleaned[..colon]) {
                    current = Some(key);
                    let tail = cleaned[colon + 1..].trim();
                    if !tail.is_empty() {
                        out.entry(key).or_default().push(tail.into());
                    }
                    continue;
                }
            }
        }
        if let Some(key) = heading(cleaned) {
            current = Some(key);
            continue;
        }
        out.entry(current.unwrap_or("unclaimed"))
            .or_default()
            .push(line.into());
    }
    out
}
fn lines<'a>(sections: &'a HashMap<&str, Vec<String>>, key: &str) -> &'a [String] {
    sections.get(key).map(Vec::as_slice).unwrap_or(&[])
}
fn bullet(line: &str) -> bool {
    re!(r"^[-•*▪‣·]\s+|^[0-9]+[.)]\s+").is_match(line)
}
fn clean_bullet(line: &str) -> String {
    let first = re!(r"^[-•*▪‣·]\s+").replace(line, "");
    re!(r"^[0-9]+[.)]\s+").replace(&first, "").trim().into()
}
fn dates(segment: &str) -> (String, String, String) {
    let Some(m)=re!(r"(?i)((?-u:\b)(?:19|20)[0-9]{2}(?-u:\b)\s*(?:[-–—]|to)\s*(?:(?-u:\b)(?:19|20)[0-9]{2}(?-u:\b)|present|now|current))|((?-u:\b)(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:19|20)[0-9]{2}(?-u:\b))").find(segment)else{return(segment.trim().into(),String::new(),String::new());};
    let range = m.as_str();
    let parts: Vec<_> = re!(r"(?i)\s*(?:[-–—]|to)\s*").split(range).collect();
    let punctuation =
        |c: char| c.is_whitespace() || matches!(c, ',' | ';' | '|' | '·' | '•' | '-' | '–' | '—');
    let before = segment[..m.start()].trim_end_matches(punctuation);
    let after = segment[m.end()..].trim_start_matches(punctuation);
    let rest = re!(r"\s+")
        .replace_all(&format!("{before} {after}"), " ")
        .trim()
        .trim_end_matches(|c: char| matches!(c, ',' | ';' | ':') || c.is_whitespace())
        .to_owned();
    (
        rest,
        parts.first().unwrap_or(&"").trim().into(),
        parts.get(1).unwrap_or(&"Present").trim().into(),
    )
}
fn looks_company(s: &str) -> bool {
    re!(r"(?i)(?-u:\b)(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|group|holdings|labs?|technologies|tech|solutions|software|systems|bank|health|studio|studios|agency|partners|ventures|capital|consulting|media|digital|networks|platforms|io|ai)(?-u:\b)").is_match(s)||re!(r"(?:(?-u:\b)[A-Z]{2,}(?-u:\b))|(?:[A-Z][a-z]+[A-Z][a-zA-Z]*)").is_match(s)
}
fn title_company(rest: &str) -> (String, String) {
    for separator in [" — ", " – ", " - ", " | ", " @ ", " at "] {
        if let Some(index) = rest.find(separator) {
            let clean = |s: &str| {
                s.trim()
                    .trim_start_matches(|c: char| {
                        matches!(c, ',' | '-' | '–' | '—' | '|' | '·' | '•') || c.is_whitespace()
                    })
                    .to_owned()
            };
            let a = clean(&rest[..index]);
            let b = clean(&rest[index + separator.len()..]);
            if !a.is_empty() && !b.is_empty() {
                return (a, b);
            }
        }
    }
    if let Some(comma) = rest.find(',') {
        let a = rest[..comma].trim();
        let b = rest[comma + 1..].trim();
        if !a.is_empty() && !b.is_empty() && units(b) <= 80 {
            if looks_company(b) {
                return (a.into(), b.into());
            }
            if re!(r"(?i)(?-u:\b)(engineer|developer|manager|director|designer|scientist|analyst|architect|consultant|lead|head|intern|researcher|programmer|administrator|specialist|officer|founder|coordinator|associate|principal|staff)(?-u:\b)").is_match(a){return(text::slice(rest,200),String::new());}
            if looks_company(a) {
                return (b.into(), a.into());
            }
        }
    }
    (text::slice(rest, 200), String::new())
}
fn push(resume: &mut Value, key: &str, value: Value) {
    resume[key].as_array_mut().unwrap().push(value);
}
pub fn parse(source: &str) -> (Value, Vec<String>) {
    let mut base = crate::empty_resume();
    let mut unparsed = Vec::new();
    let input = source.trim();
    if input.is_empty() {
        return (base, unparsed);
    }
    let sections = sections(input);
    if !lines(&sections, "summary").is_empty() {
        base["summary"] = json!(text::slice(&lines(&sections, "summary").join(" "), 2000));
    }
    let mut names = Vec::new();
    let skill_separator = re!(r"[,;|/·•▪]");
    let skill_prefix = re!(r"^[-*]\s*");
    for line in lines(&sections, "skills") {
        let parts: Vec<_> = skill_separator
            .split(line)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() <= 1 && !bullet(line) {
            if units(line) <= 40 && line.split_whitespace().count() <= 4 {
                names.push(skill_prefix.replace(line, "").into_owned());
            } else {
                unparsed.push(line.clone());
            }
        } else {
            for p in parts {
                let clean = clean_bullet(p);
                if !clean.is_empty() && units(&clean) <= 60 && clean.split_whitespace().count() <= 5
                {
                    names.push(clean);
                } else if !clean.is_empty() {
                    unparsed.push(p.into());
                }
            }
        }
    }
    let mut seen = HashSet::new();
    for name in names {
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        if array(&base, "skills").len() >= 60 {
            unparsed.push(name);
            continue;
        }
        push(
            &mut base,
            "skills",
            json!({"id":nid("skill"),"name":text::slice(&name,200)}),
        );
    }
    let mut open: Option<Value> = None;
    for line in lines(&sections, "experience") {
        if bullet(line) {
            let b = clean_bullet(line);
            if let Some(e) = open.as_mut() {
                if array(e, "bullets").len() < 12 && units(&b) <= 400 {
                    push(e, "bullets", json!(b));
                } else {
                    unparsed.push(line.clone());
                }
            } else {
                unparsed.push(line.clone());
            }
            continue;
        }
        if let Some(mut e) = open.take() {
            e["id"] = json!(nid("exp"));
            push(&mut base, "experience", e);
        }
        let (rest, start, end) = dates(line);
        let (title, company) = title_company(&rest);
        if title.is_empty() && company.is_empty() {
            unparsed.push(line.clone());
            continue;
        }
        open = Some(json!({"title":title,"company":company,"start":start,"end":end,"bullets":[]}));
    }
    if let Some(mut e) = open {
        e["id"] = json!(nid("exp"));
        push(&mut base, "experience", e);
    }
    let education_separator = re!(r"[,|–—\-·]");
    let degree_hint = re!(
        r"(?i)(?-u:\b)(bsc|msc|ma(?-u:\b)|ms(?-u:\b)|mba|phd|ph\.d|btech|mtech|b\.tech|m\.tech|be(?-u:\b)|me(?-u:\b)|beng|bs(?-u:\b)|ba(?-u:\b)|bsn|msn|associate|bachelor|master|doctor|diploma|certificat)(?-u:\b)"
    );
    for line in lines(&sections, "education") {
        if bullet(line) || array(&base, "education").len() >= 10 {
            unparsed.push(line.clone());
            continue;
        }
        let (rest, start, end) = dates(line);
        let parts: Vec<_> = education_separator
            .split(&rest)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.is_empty() {
            unparsed.push(line.clone());
            continue;
        }
        let first = parts[0];
        let second = parts.get(1).copied().unwrap_or("");
        let (school, degree) = if degree_hint.is_match(first) && !degree_hint.is_match(second) {
            (second, first)
        } else {
            (first, second)
        };
        push(
            &mut base,
            "education",
            json!({"id":nid("edu"),"school":text::slice(school,200),"degree":text::slice(degree,200),"field":text::slice(parts.get(2).copied().unwrap_or(""),120),"start":start,"end":end}),
        );
    }
    let project_separator = re!(r"[:–—\-–|]");
    for line in lines(&sections, "projects") {
        if array(&base, "projects").len() >= 20 {
            unparsed.push(line.clone());
            continue;
        }
        let is_bullet = bullet(line);
        let b = if is_bullet {
            clean_bullet(line)
        } else {
            line.clone()
        };
        let separator = project_separator.find(&b);
        let (name, description) =
            if let Some(m) = separator.filter(|m| m.start() > 0 && units(&b[..m.start()]) < 80) {
                let name = text::slice(b[..m.start()].trim(), 200);
                let tail = b[m.end()..].trim();
                (
                    name,
                    text::slice(if tail.is_empty() { &b } else { tail }, 2000),
                )
            } else if is_bullet {
                (text::slice(&b, 80), text::slice(&b, 2000))
            } else if units(line) <= 200 {
                (text::slice(line, 200), text::slice(line, 2000))
            } else {
                unparsed.push(line.clone());
                continue;
            };
        push(
            &mut base,
            "projects",
            json!({"id":nid("proj"),"name":name,"description":description,"tech":[],"link":""}),
        );
    }
    unparsed.extend_from_slice(lines(&sections, "unclaimed"));
    match contracts::parse("Resume", base) {
        Ok(v) => (v, unparsed),
        Err(_) => (
            crate::empty_resume(),
            input
                .split('\n')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
        ),
    }
}
fn tokens(s: &str) -> HashSet<String> {
    let s = s
        .to_lowercase()
        .replace(['‘', '’'], "'")
        .replace(['“', '”'], "\"");
    let s = re!(r"[^a-z0-9+#.'/ -]+").replace_all(&s, " ");
    let s = re!(r"\s+").replace_all(&s, " ");
    s.trim()
        .split(' ')
        .map(|t| t.trim_matches(['.', '\'', '/', '-']))
        .filter(|t| units(t) > 1)
        .map(str::to_owned)
        .collect()
}
fn supported(value: &str, source: &HashSet<String>, threshold: f64) -> bool {
    let tokens = tokens(value);
    if tokens.is_empty() {
        return true;
    }
    let allowed = [
        "present", "current", "now", "role", "company", "project", "general", "and", "with", "for",
        "the", "a", "an", "of", "to", "in", "on", "at", "from", "by", "as", "etc", "using", "used",
    ];
    tokens
        .iter()
        .filter(|t| source.contains(*t) || allowed.contains(&t.as_str()))
        .count() as f64
        / tokens.len() as f64
        >= threshold
}
fn ground(
    value: &str,
    source: &HashSet<String>,
    threshold: f64,
    label: String,
    rejected: &mut Vec<String>,
) -> String {
    if value.trim().is_empty() {
        return String::new();
    }
    if supported(value, source, threshold) {
        value.into()
    } else {
        rejected.push(label);
        String::new()
    }
}
#[derive(Debug)]
pub enum GroundError {
    Schema(Vec<Value>),
    MissingEducation,
}
impl std::fmt::Display for GroundError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Schema(issues) => write!(f, "{}", serde_json::to_string_pretty(issues).unwrap()),
            Self::MissingEducation => {
                write!(f, "Cannot read properties of undefined (reading 'school')")
            }
        }
    }
}
pub fn grounded(raw: Value, source: &str) -> Result<(bool, Value, Vec<String>), GroundError> {
    let Ok(mut r) = contracts::parse("Resume", raw) else {
        return Ok((false, crate::empty_resume(), vec!["schema".into()]));
    };
    let source = tokens(source);
    let mut rejected = Vec::new();
    let mut experience = Vec::new();
    for e in array(&r, "experience") {
        let mut e = e.clone();
        for key in ["title", "company"] {
            let value = ground(
                string(&e, key),
                &source,
                1.0,
                format!("experience.{key}:{}", string(&e, key)),
                &mut rejected,
            );
            e[key] = json!(value);
        }
        let bullets: Vec<_> = array(&e, "bullets")
            .iter()
            .filter_map(|b| {
                let b = b.as_str().unwrap_or("");
                let result = ground(
                    b,
                    &source,
                    0.6,
                    format!("experience.bullet:{}", text::slice(b, 40)),
                    &mut rejected,
                );
                if result.is_empty() {
                    None
                } else {
                    Some(json!(result))
                }
            })
            .collect();
        if string(&e, "title").is_empty() && string(&e, "company").is_empty() && bullets.is_empty()
        {
            continue;
        }
        e["bullets"] = json!(bullets);
        for key in ["start", "end"] {
            e[key] = json!(ground(
                string(&e, key),
                &source,
                1.0,
                format!("experience.{key}:{}", string(&e, key)),
                &mut rejected
            ));
        }
        experience.push(e);
    }
    let mut education = Vec::new();
    for e in array(&r, "education") {
        let mut e = e.clone();
        for key in ["school", "degree"] {
            e[key] = json!(ground(
                string(&e, key),
                &source,
                0.75,
                format!("education.{key}:{}", string(&e, key)),
                &mut rejected
            ));
        }
        if !string(&e, "school").is_empty() || !string(&e, "degree").is_empty() {
            education.push(e);
        }
    }
    let mut projects = Vec::new();
    for p in array(&r, "projects") {
        let mut p = p.clone();
        let name = ground(
            string(&p, "name"),
            &source,
            0.75,
            format!("project.name:{}", string(&p, "name")),
            &mut rejected,
        );
        let description = ground(
            string(&p, "description"),
            &source,
            0.6,
            format!("project.description:{}", string(&p, "name")),
            &mut rejected,
        );
        if name.is_empty() && description.is_empty() {
            continue;
        }
        p["name"] = json!(name);
        p["description"] = json!(description);
        p["tech"] = json!(array(&p, "tech")
            .iter()
            .filter(|t| supported(t.as_str().unwrap_or(""), &source, 1.0))
            .take(20)
            .cloned()
            .collect::<Vec<_>>());
        projects.push(p);
    }
    let mut skills = Vec::new();
    let mut seen = HashSet::new();
    for s in array(&r, "skills") {
        let name = ground(
            string(s, "name"),
            &source,
            1.0,
            format!("skill:{}", string(s, "name")),
            &mut rejected,
        );
        if name.is_empty() || !seen.insert(name.to_lowercase()) {
            continue;
        }
        let mut s = s.clone();
        s["name"] = json!(name);
        skills.push(s);
    }
    r["summary"] = json!(ground(
        string(&r, "summary"),
        &source,
        0.6,
        "summary".into(),
        &mut rejected
    ));
    for key in ["name", "email", "location"] {
        r["contact"][key] = json!(ground(
            string(&r["contact"], key),
            &source,
            1.0,
            format!("contact.{key}"),
            &mut rejected
        ));
    }
    let produced = experience.len() + education.len() + projects.len() + skills.len() > 0;
    r["experience"] = json!(experience);
    r["education"] = json!(education);
    r["projects"] = json!(projects);
    r["skills"] = json!(skills);
    match contracts::parse("Resume", r) {
        Ok(r) => Ok((produced, r, rejected)),
        Err(issues) => Err(GroundError::Schema(issues)),
    }
}
fn exp_key(e: &Value) -> String {
    format!(
        "{}|{}",
        string(e, "title").to_lowercase(),
        string(e, "company").to_lowercase()
    )
}
fn edu_key(e: &Value) -> String {
    let mut parts: Vec<_> = [string(e, "school"), string(e, "degree")]
        .into_iter()
        .map(|s| s.to_lowercase().trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect();
    parts.sort();
    parts.join("|")
}
fn project_key(p: &Value) -> String {
    format!(
        "{}|{}",
        string(p, "name").to_lowercase(),
        text::slice(string(p, "description"), 40).to_lowercase()
    )
}
pub fn merge(model: &Value, fallback: &Value) -> Result<Value, GroundError> {
    let mut out = crate::empty_resume();
    let choose = |a: &str, b: &str| {
        if a.is_empty() {
            b.to_owned()
        } else {
            a.to_owned()
        }
    };
    out["summary"] = json!(choose(
        string(model, "summary"),
        string(fallback, "summary")
    ));
    for key in ["name", "email", "location"] {
        out["contact"][key] = json!(choose(
            string(&model["contact"], key),
            string(&fallback["contact"], key)
        ));
    }
    let mut index = HashMap::new();
    for e in array(model, "experience") {
        index.insert(exp_key(e), e);
    }
    let mut used = HashSet::new();
    let mut experience = Vec::new();
    for f in array(fallback, "experience") {
        let key = exp_key(f);
        if let Some(m) = index.get(&key) {
            used.insert(key);
            let mut e = (*m).clone();
            for (field, default) in [
                ("title", "Role"),
                ("company", "Company"),
                ("start", ""),
                ("end", "Present"),
            ] {
                let val = choose(string(m, field), string(f, field));
                e[field] = json!(if val.is_empty() { default.into() } else { val });
            }
            e["bullets"] = if array(m, "bullets").is_empty() {
                f["bullets"].clone()
            } else {
                m["bullets"].clone()
            };
            experience.push(e);
        } else {
            experience.push(f.clone());
        }
    }
    for m in array(model, "experience") {
        if !used.contains(&exp_key(m)) {
            experience.push(m.clone());
        }
    }
    experience.truncate(20);
    out["experience"] = json!(experience);
    let mut skills = Vec::new();
    let mut seen = HashSet::new();
    for s in array(model, "skills")
        .iter()
        .chain(array(fallback, "skills"))
    {
        if seen.insert(string(s, "name").to_lowercase()) {
            skills.push(s.clone());
        }
    }
    skills.truncate(60);
    out["skills"] = json!(skills);
    let mut projects = array(model, "projects").to_vec();
    let project_text: HashSet<_> = projects.iter().map(project_key).collect();
    projects.extend(
        array(fallback, "projects")
            .iter()
            .filter(|p| !project_text.contains(&project_key(p)))
            .cloned(),
    );
    for p in &mut projects {
        if string(p, "name").is_empty() {
            p["name"] = json!("Project");
        }
    }
    projects.truncate(20);
    out["projects"] = json!(projects);
    // Preserve Node's primary ordering, including duplicate primary keys.
    let mut education = array(model, "education").to_vec();
    let mut indices = HashMap::new();
    let mut seen = HashSet::new();
    for (i, e) in education.iter().enumerate() {
        let key = edu_key(e);
        indices.insert(key.clone(), i);
        seen.insert(key);
    }
    let mut replaced = HashSet::new();
    for f in array(fallback, "education") {
        let key = edu_key(f);
        if seen.contains(&key) {
            if let Some(&i) = indices.get(&key) {
                let original = &array(model, "education")[i];
                let mut e = original.clone();
                for (field, default) in [
                    ("school", "School"),
                    ("degree", "Degree"),
                    ("field", ""),
                    ("start", ""),
                    ("end", ""),
                ] {
                    let val = choose(string(original, field), string(f, field));
                    e[field] = json!(if val.is_empty() { default.into() } else { val });
                }
                if replaced.insert(i) {
                    education[i] = e;
                }
            } else {
                return Err(GroundError::MissingEducation);
            }
        } else {
            seen.insert(key);
            education.push(f.clone());
        }
    }
    education.truncate(10);
    out["education"] = json!(education);
    out["links"] = if array(model, "links").is_empty() {
        fallback["links"].clone()
    } else {
        model["links"].clone()
    };
    contracts::parse("Resume", out).map_err(GroundError::Schema)
}
fn prompt(source: &str) -> Value {
    let system=["You extract structured resume data from raw text. Return ONLY a JSON object.","ABSOLUTE RULE: copy content from the source text. Never invent, infer, embellish,","or add an employer, role, date, degree, project, or skill that is not written there.","If a field is absent in the source, use an empty string or an empty array.","Return exactly this shape:","{ \"summary\": string, \"contact\": {\"name\": string, \"email\": string, \"location\": string},","  \"experience\": [{\"id\": string, \"title\": string, \"company\": string, \"start\": string, \"end\": string, \"bullets\": [string]}],","  \"education\": [{\"id\": string, \"school\": string, \"degree\": string, \"field\": string, \"start\": string, \"end\": string}],","  \"projects\": [{\"id\": string, \"name\": string, \"description\": string, \"tech\": [string], \"link\": string}],","  \"skills\": [{\"id\": string, \"name\": string}] }","Every \"id\" must be unique, in the form exp:1, edu:1, proj:1, skill:1.","Keep bullet text close to the source wording. Do not add commentary."].join("\n");
    json!([{"role":"system","content":system},{"role":"user","content":format!("SOURCE RESUME TEXT:\n\"\"\"\n{source}\n\"\"\"")}])
}
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let (owner, _) = auth::resolve(&state, &headers).await?;
    let input=match contracts::parse("ParseResume",serde_json::from_slice(&body).unwrap_or_else(|_|json!({}))){Ok(v)=>v,Err(e)=>return Ok((StatusCode::BAD_REQUEST,Json(json!({"error":{"code":"BAD_REQUEST","message":"Invalid parse request","details":e}}))).into_response())};
    let (_, unparsed) = parse(string(&input, "text"));
    let source = text::slice(string(&input, "text").trim(), 12000);
    let (mut resume, _) = parse(&source);
    let mut result_source = "deterministic";
    let mut notes = Vec::new();
    let mut rejected = Vec::new();
    if let Some(id) = state.transport.chat_id() {
        match state.transport.chat(prompt(&source), 4000, 0.1).await {
            Ok(reply) => {
                if let Some(raw) = text::extract_json(&reply) {
                    match grounded(raw, &source) {
                        Ok((true, grounded, dropped)) => match merge(&grounded, &resume) {
                            Ok(v) => {
                                resume = v;
                                result_source = "model";
                                notes.push(format!("extracted by {id}"));
                                if !dropped.is_empty() {
                                    notes.push(format!("{} ungrounded field(s) replaced from the deterministic parse",dropped.len()));
                                }
                                rejected = dropped;
                            }
                            Err(error) => notes.push(format!(
                                "model extraction failed ({}); used deterministic parse",
                                text::slice(&error.to_string(), 200)
                            )),
                        },
                        Ok((false, _, _)) => notes.push(
                            "model extraction produced nothing grounded; used deterministic parse"
                                .into(),
                        ),
                        Err(error) => notes.push(format!(
                            "model extraction failed ({}); used deterministic parse",
                            text::slice(&error.to_string(), 200)
                        )),
                    }
                } else {
                    notes.push(format!(
                        "transport '{id}' returned non-JSON; used deterministic parse"
                    ));
                }
            }
            Err(ChatError::Busy) => return Err(ApiError::busy()),
            Err(error) => notes.push(format!(
                "model extraction failed ({}); used deterministic parse",
                text::slice(&error.to_string(), 200)
            )),
        }
    } else {
        notes.push("no model transport configured; used deterministic parse".into());
    }
    let saved = input["save"].as_bool() == Some(true);
    if saved {
        let data = resume.to_string();
        state.db.call(move|db|{db.execute("INSERT INTO resumes(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at",params![owner,data,now_ms()]).map_err(ApiError::internal)?;Ok(())}).await?;
    }
    Ok(Json(json!({"resume":resume,"unparsed":unparsed,"source":result_source,"notes":notes,"rejected":rejected,"saved":saved})).into_response())
}
