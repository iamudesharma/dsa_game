//! Grid, graph and string-table algorithm plans. Direction and tie ordering match Node.
use serde_json::{json, Value};
const IDS: [&str; 10] = [
    "num-islands",
    "max-area-island",
    "rotting-oranges",
    "word-search",
    "union-find-connect",
    "network-delay-time",
    "kruskal-mst",
    "unique-paths",
    "lcs-length",
    "edit-distance",
];
pub fn supports(id: &str) -> bool {
    IDS.contains(&id)
}
fn nums(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}
fn dims(x: &Value) -> (usize, usize) {
    (
        x["extras"]["rows"].as_u64().unwrap_or(3) as usize,
        x["extras"]["cols"].as_u64().unwrap_or(4) as usize,
    )
}
fn neighbors(i: usize, rows: usize, cols: usize) -> Vec<usize> {
    let r = (i / cols) as i64;
    let c = (i % cols) as i64;
    [(-1, 0), (0, 1), (1, 0), (0, -1)]
        .into_iter()
        .filter_map(|(dr, dc)| {
            let rr = r + dr;
            let cc = c + dc;
            (rr >= 0 && rr < rows as i64 && cc >= 0 && cc < cols as i64)
                .then_some((rr * cols as i64 + cc) as usize)
        })
        .collect()
}
fn components(x: &Value) -> Vec<Vec<usize>> {
    let v = nums(&x["values"]);
    let (rows, cols) = dims(x);
    let mut global = vec![false; v.len()];
    let mut out = vec![];
    for i in 0..rows * cols {
        if v[i] != 1 || global[i] {
            continue;
        }
        let mut seen = vec![false; v.len()];
        let mut stack = vec![i];
        let mut comp = vec![];
        while let Some(cur) = stack.pop() {
            if seen[cur] {
                continue;
            }
            seen[cur] = true;
            global[cur] = true;
            comp.push(cur);
            for ni in neighbors(cur, rows, cols).into_iter().rev() {
                if v[ni] == 1 && !seen[ni] {
                    stack.push(ni);
                }
            }
        }
        out.push(comp);
    }
    out
}
fn rot(x: &Value) -> Vec<i64> {
    let v = nums(&x["values"]);
    let (rows, cols) = dims(x);
    let mut dist = vec![-1; rows * cols];
    let mut queue = std::collections::VecDeque::new();
    for (i, value) in v.iter().enumerate() {
        if *value == 2 {
            dist[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(cur) = queue.pop_front() {
        for ni in neighbors(cur, rows, cols) {
            if v[ni] == 1 && dist[ni] == -1 {
                dist[ni] = dist[cur] + 1;
                queue.push_back(ni);
            }
        }
    }
    dist
}
fn select(i: usize) -> Value {
    json!({"type":"selectObject","objectId":format!("v{i}")})
}
fn assign(target: String, v: i64) -> Value {
    json!({"type":"assignValue","targetId":target,"value":v.to_string()})
}
fn submit(i: usize, value: String) -> Value {
    json!({"type":"submitAnswer","targetId":format!("v{i}"),"value":value})
}
fn rel(a: i64, b: i64) -> &'static str {
    if a < b {
        "lt"
    } else if a > b {
        "gt"
    } else {
        "eq"
    }
}
fn compare(a: usize, b: usize, r: &str) -> Value {
    json!({"type":"comparePair","aId":format!("v{a}"),"bId":format!("v{b}"),"relation":r})
}
fn root_path(parent: &[usize], mut x: usize) -> Vec<usize> {
    let mut out = vec![x];
    while parent[x] != x {
        x = parent[x];
        out.push(x);
    }
    out
}
fn table(x: &Value) -> Vec<i64> {
    let id = x["problemId"].as_str().unwrap();
    let (rows, cols) = dims(x);
    let v = nums(&x["values"]);
    let s = x["extras"]["s"].as_str().unwrap_or("").as_bytes();
    let t = x["extras"]["t"].as_str().unwrap_or("").as_bytes();
    let mut dp = vec![0; rows * cols];
    for r in 0..rows {
        for c in 0..cols {
            let i = r * cols + c;
            dp[i] = match id {
                "unique-paths" => {
                    if v[i] == 1 {
                        0
                    } else if i == 0 {
                        1
                    } else {
                        (if r > 0 { dp[i - cols] } else { 0 }) + (if c > 0 { dp[i - 1] } else { 0 })
                    }
                }
                "lcs-length" => {
                    if r == 0 || c == 0 {
                        0
                    } else if s[r - 1] == t[c - 1] {
                        dp[i - cols - 1] + 1
                    } else {
                        dp[i - cols].max(dp[i - 1])
                    }
                }
                _ => {
                    if r == 0 {
                        c as i64
                    } else if c == 0 {
                        r as i64
                    } else if s[r - 1] == t[c - 1] {
                        dp[i - cols - 1]
                    } else {
                        1 + dp[i - cols].min(dp[i - 1]).min(dp[i - cols - 1])
                    }
                }
            };
        }
    }
    dp
}
fn word(x: &Value) -> (Vec<Value>, bool) {
    struct Walk<'a> {
        tokens: Vec<&'a str>,
        word: Vec<char>,
        rows: usize,
        cols: usize,
        seen: Vec<bool>,
        out: Vec<Value>,
    }
    impl Walk<'_> {
        fn dfs(&mut self, i: usize, k: usize) -> bool {
            if self.tokens[i] != self.word[k].to_string() {
                return false;
            }
            self.out.push(select(i));
            self.out.push(assign(
                format!("cell_{}_{}", i / self.cols, i % self.cols),
                1,
            ));
            self.seen[i] = true;
            if k == self.word.len() - 1 {
                return true;
            }
            for ni in neighbors(i, self.rows, self.cols) {
                if !self.seen[ni] && self.dfs(ni, k + 1) {
                    return true;
                }
            }
            self.seen[i] = false;
            self.out.push(assign(
                format!("cell_{}_{}", i / self.cols, i % self.cols),
                0,
            ));
            false
        }
    }
    let (rows, cols) = dims(x);
    let mut walk = Walk {
        tokens: x["tokens"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect(),
        word: x["extras"]["word"].as_str().unwrap().chars().collect(),
        rows,
        cols,
        seen: vec![false; rows * cols],
        out: vec![],
    };
    let mut found = false;
    for i in 0..rows * cols {
        if walk.tokens[i] == walk.word[0].to_string() && walk.dfs(i, 0) {
            found = true;
            break;
        }
    }
    let last = walk
        .out
        .iter()
        .rev()
        .find(|a| a["type"] == "selectObject")
        .map(|a| {
            a["objectId"]
                .as_str()
                .unwrap()
                .trim_start_matches('v')
                .parse()
                .unwrap()
        })
        .unwrap_or(0);
    walk.out
        .push(submit(last, if found { "found" } else { "absent" }.into()));
    (walk.out, found)
}
pub fn setup(s: &mut Value) {
    let x = s["instance"].clone();
    let id = x["problemId"].as_str().unwrap();
    let n = x["values"].as_array().unwrap().len();
    s["variables"] = match id {
        "word-search" => json!({"r":0,"c":0,"n":n}),
        "network-delay-time" => json!({"i":0,"settled":0,"n":n,"source":x["extras"]["source"]}),
        "union-find-connect" => json!({"i":0,"comps":n,"n":n}),
        "kruskal-mst" => json!({"i":0,"comps":n,"mst":0,"n":n}),
        "unique-paths" | "lcs-length" | "edit-distance" => json!({"r":0,"c":0,"best":0,"n":n}),
        "rotting-oranges" => json!({"r":0,"c":0,"minutes":0,"n":n}),
        "max-area-island" => json!({"r":0,"c":0,"curArea":0,"maxArea":0,"n":n}),
        _ => json!({"r":0,"c":0,"islands":0,"n":n}),
    };
    if ["union-find-connect", "kruskal-mst"].contains(&id) {
        for i in 0..n {
            s["variables"][format!("parent_{i}")] = json!(i);
        }
    }
    if id == "network-delay-time" {
        let src = x["extras"]["source"].as_u64().unwrap_or(0) as usize;
        for i in 0..n {
            s["variables"][format!("dist_{i}")] = json!(if i == src { 0 } else { 9999 });
        }
    }
    if ["word-search", "lcs-length", "edit-distance"].contains(&id) {
        for (i, t) in x["tokens"].as_array().unwrap().iter().enumerate() {
            let o = &mut s["objects"][format!("v{i}")];
            o["kind"] = json!("token");
            o["label"] = t.clone();
            o["visual"]["text"] = t.clone();
            o.as_object_mut().unwrap().shift_remove("value");
        }
    }
}
pub fn actions(x: &Value) -> Vec<Value> {
    let id = x["problemId"].as_str().unwrap();
    let v = nums(&x["values"]);
    let n = v.len();
    let mut out = vec![];
    match id {
        "num-islands" | "max-area-island" => {
            let comps = components(x);
            for comp in &comps {
                for i in comp {
                    out.push(select(*i));
                }
            }
            let last = comps.last().and_then(|c| c.last()).copied().unwrap_or(0);
            let answer = if id == "num-islands" {
                comps.len()
            } else {
                comps.iter().map(Vec::len).max().unwrap_or(0)
            };
            out.push(submit(last, answer.to_string()));
        }
        "rotting-oranges" => {
            let dist = rot(x);
            let mut order: Vec<_> = dist
                .iter()
                .enumerate()
                .filter(|(_, d)| **d >= 0)
                .map(|(i, d)| (*d, i))
                .collect();
            order.sort();
            for (_, i) in &order {
                out.push(select(*i));
            }
            let answer = if v.iter().zip(&dist).any(|(v, d)| *v == 1 && *d == -1) {
                -1
            } else {
                *dist.iter().max().unwrap_or(&0)
            };
            out.push(submit(
                order.last().map(|(_, i)| *i).unwrap_or(0),
                answer.to_string(),
            ));
        }
        "word-search" => return word(x).0,
        "unique-paths" | "lcs-length" | "edit-distance" => {
            let (rows, cols) = dims(x);
            let dp = table(x);
            let s = x["extras"]["s"].as_str().unwrap_or("").as_bytes();
            let t = x["extras"]["t"].as_str().unwrap_or("").as_bytes();
            for r in 0..rows {
                for c in 0..cols {
                    let i = r * cols + c;
                    out.push(select(i));
                    if id != "unique-paths" && r > 0 && c > 0 && s[r - 1] != t[c - 1] {
                        let up = i - cols;
                        let left = i - 1;
                        let relation = rel(dp[up], dp[left]);
                        out.push(compare(up, left, relation));
                        if id == "edit-distance" {
                            let winner = if relation == "gt" { left } else { up };
                            out.push(compare(
                                winner,
                                i - cols - 1,
                                rel(dp[winner], dp[i - cols - 1]),
                            ));
                        }
                    }
                    out.push(assign(format!("dp_{r}_{c}"), dp[i]));
                }
            }
            out.push(submit(rows * cols - 1, dp.last().unwrap().to_string()));
        }
        "network-delay-time" => {
            let edges = nums(&x["extras"]["edges"]);
            let src = x["extras"]["source"].as_u64().unwrap_or(0) as usize;
            let mut dist = vec![9999; n];
            dist[src] = 0;
            let mut done = vec![false; n];
            let mut last = src;
            for _ in 0..n {
                let u = (0..n)
                    .filter(|i| !done[*i])
                    .min_by_key(|i| dist[*i])
                    .unwrap();
                done[u] = true;
                last = u;
                out.push(select(u));
                for e in edges.chunks_exact(3).filter(|e| e[0] as usize == u) {
                    let nb = e[1] as usize;
                    let relation = rel(dist[u] + e[2], dist[nb]);
                    out.push(compare(u, nb, relation));
                    if relation == "lt" {
                        dist[nb] = dist[u] + e[2];
                        out.push(assign(format!("dist_{nb}"), dist[nb]));
                    }
                }
            }
            out.push(submit(last, dist.iter().max().unwrap().to_string()));
        }
        _ => {
            let edges = nums(&x["extras"]["edges"]);
            let weighted = id == "kruskal-mst";
            let width = if weighted { 3 } else { 2 };
            let mut order: Vec<_> = (0..edges.len() / width).collect();
            if weighted {
                order.sort_by_key(|i| (edges[width * i + 2], *i));
            }
            let mut parent: Vec<_> = (0..n).collect();
            let (mut total, mut comps) = (0, n);
            for ei in order {
                let e = &edges[ei * width..ei * width + width];
                let u = root_path(&parent, e[0] as usize);
                let w = root_path(&parent, e[1] as usize);
                for node in u.iter().chain(&w) {
                    out.push(select(*node));
                }
                let ru = *u.last().unwrap();
                let rv = *w.last().unwrap();
                let relation = rel(ru as i64, rv as i64);
                out.push(compare(ru, rv, relation));
                if ru != rv {
                    out.push(assign(format!("parent_{ru}"), rv as i64));
                    parent[ru] = rv;
                    comps -= 1;
                    if weighted {
                        total += e[2];
                        out.push(assign("mst".into(), total));
                    }
                }
            }
            out.push(submit(
                0,
                if weighted {
                    total.to_string()
                } else {
                    comps.to_string()
                },
            ));
        }
    }
    out
}
pub fn code_line(id: &str, a: &Value) -> usize {
    match a["type"].as_str().unwrap() {
        "submitAnswer" => match id {
            "word-search" => {
                if a["value"] == "found" {
                    3
                } else {
                    5
                }
            }
            "kruskal-mst" => 12,
            "unique-paths" | "lcs-length" => 7,
            "edit-distance" => 8,
            _ => 9,
        },
        "selectObject" => match id {
            "word-search" => 9,
            "union-find-connect" => 13,
            "network-delay-time" => 5,
            "kruskal-mst" => 15,
            "unique-paths" | "lcs-length" | "edit-distance" => 3,
            _ => 6,
        },
        "comparePair" => match id {
            "lcs-length" | "edit-distance" => 5,
            "network-delay-time" | "kruskal-mst" => 7,
            _ => 6,
        },
        "assignValue" => match id {
            "word-search" => {
                if a["value"] == "1" {
                    9
                } else {
                    14
                }
            }
            "network-delay-time" => 8,
            "kruskal-mst" => {
                if a["targetId"] == "mst" {
                    9
                } else {
                    8
                }
            }
            "unique-paths" | "lcs-length" => 6,
            _ => 7,
        },
        _ => 1,
    }
}
pub fn legal(id: &str, a: &Value) -> Value {
    let mut result = crate::oracle_remaining::legal(a);
    let label = match a["type"].as_str().unwrap() {
        "selectObject" => match id {
            "num-islands" => "Claim the next land cell of this island",
            "max-area-island" => "Measure the next cell of this island",
            "rotting-oranges" => "Visit the next cell the wave reaches",
            "word-search" => "Step onto the next matching letter",
            "network-delay-time" => "Settle the closest unsettled node",
            "unique-paths" | "lcs-length" | "edit-distance" => "Walk to the next table cell",
            _ => "Walk up to the root",
        },
        "comparePair" => match id {
            "network-delay-time" => "Is the path through the settled node shorter?",
            "kruskal-mst" => "Are these two roots already connected?",
            "lcs-length" => "Which neighbour count is larger — take it.",
            "edit-distance" => "Which neighbour costs less — take it.",
            _ => "Are these two roots the same set?",
        },
        "assignValue" => {
            if id == "word-search" {
                "Mark or unmark this path cell"
            } else if id == "network-delay-time" {
                "Record the shorter distance"
            } else if a["targetId"] == "mst" {
                "Add this edge to the running total"
            } else if a["targetId"].as_str().unwrap().starts_with("parent_") {
                "Attach the root under the other set"
            } else {
                "Record the table value"
            }
        }
        _ => "Submit the result",
    };
    result[0]["label"] = json!(label);
    result
}
pub fn after(s: &mut Value, a: &Value, note: &mut String) {
    let id = s["problemId"].as_str().unwrap().to_owned();
    let inc = |s: &mut Value, key: &str| {
        s["variables"][key] = json!(s["variables"][key].as_i64().unwrap_or(0) + 1);
    };
    match a["type"].as_str().unwrap() {
        "selectObject" => {
            let oid = a["objectId"].as_str().unwrap();
            let pos = s["objects"][oid]["tags"]["index"].as_u64().unwrap() as usize;
            let (_, cols) = dims(&s["instance"]);
            let linear =
                ["union-find-connect", "network-delay-time", "kruskal-mst"].contains(&id.as_str());
            s["variables"]["r"] = json!(if linear { 0 } else { pos / cols });
            s["variables"]["c"] = json!(if linear { 0 } else { pos % cols });
            if id == "network-delay-time" {
                inc(s, "settled");
            }
            if id == "num-islands"
                && components(&s["instance"])
                    .iter()
                    .any(|c| c.first() == Some(&pos))
            {
                inc(s, "islands");
            }
            if id == "max-area-island" {
                if components(&s["instance"])
                    .iter()
                    .any(|c| c.first() == Some(&pos))
                {
                    s["variables"]["curArea"] = json!(1);
                } else {
                    inc(s, "curArea");
                }
                s["variables"]["maxArea"] = json!(s["variables"]["maxArea"]
                    .as_i64()
                    .unwrap_or(0)
                    .max(s["variables"]["curArea"].as_i64().unwrap()));
            }
            if id == "rotting-oranges" {
                s["variables"]["minutes"] = json!(rot(&s["instance"])[pos]);
            }
            *note = format!(
                "Visit {}.",
                s["objects"][oid]["label"].as_str().unwrap_or(oid)
            );
        }
        "assignValue" => {
            let key = a["targetId"].as_str().unwrap();
            if ["union-find-connect", "kruskal-mst"].contains(&id.as_str())
                && key.starts_with("parent_")
            {
                s["variables"]["comps"] = json!(s["variables"]["comps"].as_i64().unwrap_or(1) - 1);
            }
            if ["unique-paths", "lcs-length", "edit-distance"].contains(&id.as_str())
                && key.starts_with("dp_")
            {
                s["variables"]["best"] = s["variables"][key].clone();
            }
        }
        "comparePair" => {
            let eq = a["relation"] == "eq";
            *note = match id.as_str() {
                "network-delay-time" => {
                    if a["relation"] == "lt" {
                        "Shorter through the settled node — record it."
                    } else {
                        "No improvement — keep the known distance."
                    }
                }
                "kruskal-mst" => {
                    if eq {
                        "Already connected — skip this edge."
                    } else {
                        "Cheapest link between two groups — take it."
                    }
                }
                "lcs-length" => {
                    if eq {
                        "Both neighbours tie — record either."
                    } else {
                        "Take the larger neighbour count."
                    }
                }
                "edit-distance" => "Take the cheaper neighbour.",
                _ => {
                    if eq {
                        "Already the same set — no union."
                    } else {
                        "Different sets — union them."
                    }
                }
            }
            .into();
        }
        _ => {}
    }
}
pub fn answer(x: &Value) -> Value {
    let id = x["problemId"].as_str().unwrap();
    let last = actions(x).pop().unwrap();
    let raw = last["value"].as_str().unwrap();
    let numeric = raw.parse::<i64>().unwrap_or(0);
    let text = match id {
        "num-islands" => format!("{numeric} islands"),
        "max-area-island" => format!("max area {numeric}"),
        "rotting-oranges" => {
            if numeric == -1 {
                "some fresh oranges never rot".into()
            } else {
                format!("{numeric} minutes to rot everything")
            }
        }
        "word-search" => format!(
            "the word \"{}\" is {}on the board",
            x["extras"]["word"].as_str().unwrap(),
            if word(x).1 { "" } else { "not " }
        ),
        "network-delay-time" => format!("the signal reaches every node in {numeric}"),
        "kruskal-mst" => format!("minimum connection cost {numeric}"),
        "unique-paths" => {
            if numeric == 0 {
                "no open path reaches the finish".into()
            } else {
                format!("{numeric} unique paths reach the finish")
            }
        }
        "lcs-length" => format!("longest common subsequence has length {numeric}"),
        "edit-distance" => {
            if numeric == 1 {
                "1 edit turns one string into the other".into()
            } else {
                format!("{numeric} edits turn one string into the other")
            }
        }
        _ => format!("{numeric} connected components"),
    };
    json!({"text":text,"value":if id=="word-search"{json!(raw)}else{json!(numeric)}})
}
