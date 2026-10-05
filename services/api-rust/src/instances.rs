//! Seeded instance generation. RNG calls and insertion order mirror JavaScript;
//! this module does not advertise gameplay until transition ports are complete.
use crate::compat::Rng;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
fn int(rng: &mut Rng, min: i64, max: i64) -> i64 {
    min + (rng.sample() * ((max - min + 1) as f64)).floor() as i64
}
fn shuffle<T>(values: &mut [T], rng: &mut Rng) {
    for i in (1..values.len()).rev() {
        let j = (rng.sample() * (i + 1) as f64).floor() as usize;
        values.swap(i, j);
    }
}
fn unique(n: usize, rng: &mut Rng, min: i64, max: i64) -> Vec<i64> {
    let mut v = Vec::with_capacity(n);
    while v.len() < n {
        let x = int(rng, min, max);
        if !v.contains(&x) {
            v.push(x);
        }
    }
    v
}
fn random_values(n: usize, rng: &mut Rng, min: i64, max: i64) -> Vec<i64> {
    (0..n).map(|_| int(rng, min, max)).collect()
}
fn slots(n: usize) -> Value {
    json!((0..n)
        .map(|i| json!({"id":format!("s{i}"),"index":i,"kind":"default"}))
        .collect::<Vec<_>>())
}
fn list(values: &[i64]) -> Value {
    json!(values
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let mut node = json!({"id":format!("n{i}"),"value":v});
            if i + 1 < values.len() {
                node["nextId"] = json!(format!("n{}", i + 1));
            }
            node
        })
        .collect::<Vec<_>>())
}
fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n >= i64::MIN as f64 && n < i64::MAX as f64 {
        json!(n as i64)
    } else {
        json!(n)
    }
}
fn reachable(v: &[i64]) -> bool {
    let mut reach = 0;
    for (i, x) in v.iter().enumerate() {
        if i as i64 > reach {
            return false;
        }
        reach = reach.max(i as i64 + x);
    }
    true
}
fn inorder(n: usize, i: usize, out: &mut Vec<usize>) {
    if i >= n {
        return;
    }
    inorder(n, 2 * i + 1, out);
    out.push(i);
    inorder(n, 2 * i + 2, out);
}
fn bst(n: usize, rng: &mut Rng) -> Vec<i64> {
    let mut sorted = unique(n, rng, 10, 89);
    sorted.sort();
    let mut order = vec![];
    inorder(n, 0, &mut order);
    let mut values = vec![0; n];
    for (rank, index) in order.into_iter().enumerate() {
        values[index] = sorted[rank];
    }
    values
}
fn sift(v: &mut [i64], mut p: usize, k: usize) {
    loop {
        let mut smallest = p;
        for child in [2 * p + 1, 2 * p + 2] {
            if child < k && v[child] < v[smallest] {
                smallest = child;
            }
        }
        if smallest == p {
            return;
        }
        v.swap(p, smallest);
        p = smallest;
    }
}
fn letters(n: usize, rng: &mut Rng) -> Vec<char> {
    (0..n)
        .map(|_| b"abcde"[(rng.sample() * 5.0).floor() as usize] as char)
        .collect()
}
fn tokens(instance: &mut Value, chars: &[char]) {
    instance["values"] = json!(chars.iter().map(|c| *c as u32).collect::<Vec<_>>());
    instance["tokens"] = json!(chars.iter().map(char::to_string).collect::<Vec<_>>());
}
/// Build inputs are internal and bounded by catalogue metadata. Invalid IDs or
/// difficulties return None rather than allocating from untrusted lengths.
pub fn build(id: &str, seed: f64, difficulty: &str, length: Option<f64>) -> Option<Value> {
    if !seed.is_finite()
        || length.is_some_and(|n| !n.is_finite())
        || !["easy", "medium", "hard"].contains(&difficulty)
    {
        return None;
    }
    let meta = crate::reference()["problems"]
        .as_array()?
        .iter()
        .find(|p| p["id"] == id)?;
    let h = &meta["instanceHints"];
    let lo = h["minLength"].as_u64()? as usize;
    let hi = h["maxLength"].as_u64()? as usize;
    let default = if difficulty == "easy" {
        lo
    } else if difficulty == "hard" {
        hi
    } else {
        (lo + hi).div_ceil(2)
    };
    let mut n = length
        .unwrap_or(default as f64)
        .trunc()
        .clamp(lo as f64, hi as f64) as usize;
    let (min, max) = (
        h["valueRange"][0].as_i64().unwrap_or(1),
        h["valueRange"][1].as_i64().unwrap_or(99),
    );
    let mut rng = Rng::new(seed);
    let mut values = vec![];
    let mut extra = json!({"difficulty":difficulty});
    let mut result = json!({"problemId":id,"seed":number(seed)});
    match id {
        "binary-search" => {
            let default = if difficulty == "easy" {
                8
            } else if difficulty == "hard" {
                16
            } else {
                12
            };
            n = length
                .unwrap_or(default as f64)
                .trunc()
                .clamp(lo as f64, hi as f64) as usize;
            let max = if max - min + 1 < n as i64 {
                min + 99 * n as i64
            } else {
                max
            };
            let mut pool: Vec<_> = (min..=max).collect();
            for i in 0..n {
                let j = i + int(&mut rng, 0, (pool.len() - 1 - i) as i64) as usize;
                pool.swap(i, j);
            }
            values = pool[..n].to_vec();
            values.sort();
            let mut candidates: Vec<_> = (1..n.saturating_sub(1))
                .filter(|i| *i != (n - 1) / 2)
                .collect();
            if candidates.is_empty() {
                candidates = (1..n.saturating_sub(1)).collect();
            }
            let target = if n <= 2 {
                0
            } else {
                candidates[int(&mut rng, 0, candidates.len() as i64 - 1) as usize]
            };
            result["target"] = json!(values[target]);
            extra = json!({"targetIndex":target,"lo":0,"hi":n-1,"mid":(n-1)/2,"found":false,"comparisons":0,"steps":0,"wrongAnswers":0,"history":[]});
        }
        "array-max-min" => {
            values = random_values(n, &mut rng, min, max);
            let want = rng.sample() < 0.5;
            let extreme = if want {
                *values.iter().max()?
            } else {
                *values.iter().min()?
            };
            if values.iter().filter(|v| **v == extreme).count() > 1 {
                let spot = values.iter().rposition(|v| *v == extreme)?;
                let replacement = int(&mut rng, min, max);
                values[spot] = if replacement == extreme {
                    replacement + 1
                } else {
                    replacement
                };
            }
            result["target"] = json!(if want {
                values.iter().max()?
            } else {
                values.iter().min()?
            });
            extra = json!({"wantMax":want});
        }
        "bubble-sort" | "selection-sort" => {
            values = unique(n, &mut rng, min, max);
            shuffle(&mut values, &mut rng);
            if values.windows(2).all(|w| w[0] <= w[1]) {
                values.rotate_right(1);
            }
            extra = Value::Null;
        }
        "two-sum" | "two-pointers-pair" => {
            let a = int(&mut rng, 2, 9);
            let b = int(&mut rng, 11, 19);
            let target = a + b;
            values = vec![a, b];
            values.extend((0..n - 2).map(|i| target + 4 + i as i64));
            if id == "two-sum" {
                shuffle(&mut values, &mut rng);
            } else {
                values.sort();
            }
            result["target"] = json!(target);
            extra["answerIndices"] = json!([
                values.iter().position(|v| *v == a)?,
                values.iter().position(|v| *v == b)?
            ]);
        }
        "move-zeroes" => {
            values = unique(n - 2, &mut rng, 10, 89);
            values.extend([0, 0]);
            shuffle(&mut values, &mut rng);
            result["target"] = json!(0);
        }
        "valid-parentheses" => {
            let pairs = n / 2;
            let mut chars: Vec<_> = (0..pairs).map(|i| ['(', '[', '{'][i % 3]).collect();
            chars.extend((0..pairs).rev().map(|i| [')', ']', '}'][i % 3]));
            let valid = rng.sample() >= 0.35;
            if !valid && !chars.is_empty() {
                let last = chars.len() - 1;
                chars[last] = ']';
            }
            tokens(&mut result, &chars);
            values = chars
                .iter()
                .map(|c| match c {
                    '(' | ')' => 0,
                    '[' | ']' => 1,
                    _ => 2,
                })
                .collect();
            extra["valid"] = json!(valid);
        }
        "stack-push-pop"
        | "queue-operations"
        | "linked-list-traversal"
        | "reverse-linked-list"
        | "linked-list-cycle" => {
            values = unique(n, &mut rng, 10, 89);
            if id.contains("linked-list") {
                result["list"] = list(&values);
            }
            if id == "linked-list-cycle" {
                let has = rng.sample() >= 0.4;
                let index = if has {
                    int(&mut rng, 0, n as i64 - 1)
                } else {
                    -1
                };
                extra["hasCycle"] = json!(has);
                extra["cycleIndex"] = json!(index);
            }
        }
        "climbing-stairs" => {
            values = (0..n.max(3) as i64).collect();
        }
        "house-robber" => {
            values = random_values(n.max(2), &mut rng, 1, 20);
        }
        "coin-change" => {
            let amount = n.max(5);
            let mut pool = vec![2, 3, 4, 5, 6];
            shuffle(&mut pool, &mut rng);
            let count = 1 + (rng.sample() * 2.0).floor() as usize;
            let mut coins = vec![1];
            coins.extend(&pool[..count]);
            coins.sort();
            values = (0..=amount as i64).collect();
            extra["coins"] = json!(coins);
            extra["amount"] = json!(amount);
        }
        "subsets" | "permutations" => {
            values = unique(n.clamp(2, 4), &mut rng, 1, 9);
        }
        "single-number" => {
            if n % 2 == 0 {
                n = if n < hi { n + 1 } else { n - 1 };
            }
            let distinct = unique((n - 1) / 2 + 1, &mut rng, min, max);
            values.push(*distinct.last()?);
            for x in &distinct[..distinct.len() - 1] {
                values.extend([*x, *x]);
            }
            shuffle(&mut values, &mut rng);
        }
        "jump-game" => {
            let want = rng.sample() >= 0.3;
            for _ in 0..=12 {
                values = random_values(n, &mut rng, min, max);
                values[n - 1] = 0;
                if reachable(&values) == want {
                    break;
                }
            }
        }
        "sliding-window-max-sum" => {
            values = random_values(n, &mut rng, 1, 20);
            let want = if difficulty == "easy" {
                2
            } else if difficulty == "hard" {
                4
            } else {
                3
            };
            extra["k"] = json!(want.min(n - 1).max(2));
        }
        "prefix-sum-range" => {
            values = random_values(n, &mut rng, 1, 20);
            let l = int(&mut rng, 0, n as i64 - 3) as usize;
            let r = int(&mut rng, l as i64 + 1, n as i64 - 1) as usize;
            extra["l"] = json!(l);
            extra["r"] = json!(r);
            extra["rangeSum"] = json!(values[l..=r].iter().sum::<i64>());
        }
        "kadane-max-subarray" => {
            values = random_values(n, &mut rng, -9, 20);
            let index = int(&mut rng, 0, n as i64 - 1) as usize;
            values[index] = int(&mut rng, 10, 20);
        }
        "merge-intervals" => {
            let mut starts = vec![int(&mut rng, 1, 5)];
            for _ in 1..n.max(3) {
                starts.push(starts.last()? + int(&mut rng, 1, 5));
            }
            let mut ends: Vec<_> = starts.iter().map(|s| s + int(&mut rng, 1, 6)).collect();
            if starts[1] > ends[0] {
                ends[0] = starts[1] + 1;
            }
            values = starts
                .iter()
                .zip(&ends)
                .flat_map(|(s, e)| [*s, *e])
                .collect();
            extra["starts"] = json!(starts);
            extra["ends"] = json!(ends);
        }
        "next-greater-element" => {
            values = unique(n, &mut rng, 10, 89);
            shuffle(&mut values, &mut rng);
        }
        "rotated-search" => {
            values = unique(n.max(3), &mut rng, 1, 99);
            values.sort();
            let pivot = int(&mut rng, 1, values.len() as i64 - 2) as usize;
            values.rotate_left(pivot);
            let index = int(&mut rng, 0, values.len() as i64 - 1) as usize;
            result["target"] = json!(values[index]);
            extra["answerIndex"] = json!(index);
        }
        "frequency-count" => {
            let mode = int(&mut rng, 1, 9);
            values = random_values(n, &mut rng, 1, 9);
            values[0] = mode;
            values[1] = mode;
            values[2 % n] = mode;
            let mut counts: Vec<(i64, usize)> = vec![];
            for x in &values {
                if let Some((_, c)) = counts.iter_mut().find(|(v, _)| v == x) {
                    *c += 1;
                } else {
                    counts.push((*x, 1));
                }
            }
            for i in 0..counts.len() {
                let (v, c) = counts[i];
                let mc = counts.iter().find(|(v, _)| *v == mode)?.1;
                if v != mode && c >= mc {
                    let spot = values.iter().position(|x| *x == v)?;
                    values[spot] = mode;
                    counts[i].1 -= 1;
                    counts.iter_mut().find(|(v, _)| *v == mode)?.1 += 1;
                }
            }
            shuffle(&mut values, &mut rng);
            extra["mode"] = json!(mode);
        }
        "valid-anagram" => {
            let l = n.clamp(4, 8);
            let s = letters(l, &mut rng);
            let valid = rng.sample() >= 0.45;
            let mut t = s.clone();
            if valid {
                shuffle(&mut t, &mut rng);
            } else {
                t[0] = if t[0] == 'a' { 'b' } else { 'a' };
            }
            let chars: Vec<_> = s.into_iter().chain(t).collect();
            tokens(&mut result, &chars);
            values = chars.iter().map(|c| *c as i64).collect();
            extra["split"] = json!(l);
            extra["valid"] = json!(valid);
        }
        "valid-palindrome" => {
            let l = n.clamp(4, 8);
            let left = letters(l / 2, &mut rng);
            let mut chars = left.clone();
            if l % 2 == 1 {
                chars.extend(letters(1, &mut rng));
            }
            chars.extend(left.into_iter().rev());
            let valid = rng.sample() >= 0.35;
            if !valid {
                chars[0] = if chars[l - 1] == 'a' { 'b' } else { 'a' };
            }
            tokens(&mut result, &chars);
            values = chars.iter().map(|c| *c as i64).collect();
            extra["valid"] = json!(valid);
        }
        "tree-traversals" | "tree-level-order" => {
            values = unique(n.max(3), &mut rng, 10, 89);
            if id == "tree-traversals" {
                extra["order"] = json!(
                    ["preorder", "inorder", "postorder"][(rng.sample() * 3.0).floor() as usize]
                );
            }
        }
        "bst-validate" | "bst-search" => {
            values = bst(n.max(3), &mut rng);
            if id == "bst-validate" {
                let valid = rng.sample() >= 0.35;
                if !valid {
                    let a = int(&mut rng, 0, n as i64 - 1) as usize;
                    let mut b = int(&mut rng, 0, n as i64 - 1) as usize;
                    while a == b {
                        b = int(&mut rng, 0, n as i64 - 1) as usize;
                    }
                    values.swap(a, b);
                }
                extra["valid"] = json!(valid);
            } else {
                let index = int(&mut rng, 0, n as i64 - 1) as usize;
                result["target"] = json!(values[index]);
                extra["answerIndex"] = json!(index);
            }
        }
        "kth-largest-heap" => {
            values = unique(n.max(4), &mut rng, min, max);
            let want = if difficulty == "easy" {
                2
            } else if difficulty == "hard" {
                4
            } else {
                3
            };
            let k = want.min(values.len() - 1).max(2);
            for p in (0..k / 2).rev() {
                sift(&mut values, p, k);
            }
            extra["k"] = json!(k);
        }
        "trie-prefix-search" => {
            return Some(trie(seed, difficulty, &mut rng));
        }
        "num-islands" | "max-area-island" | "rotting-oranges" | "word-search"
        | "union-find-connect" | "network-delay-time" | "kruskal-mst" | "unique-paths"
        | "lcs-length" | "edit-distance" => {
            return Some(graph(id, seed, difficulty, n, &mut rng));
        }
        _ => return None,
    }
    result["slots"] = slots(values.len());
    result["values"] = json!(values);
    if !extra.is_null() {
        result["extras"] = extra;
    }
    Some(result)
}

fn neighbors(i: usize, rows: usize, cols: usize) -> Vec<usize> {
    let (r, c) = (i / cols, i % cols);
    let mut out = vec![];
    for (dr, dc) in [(-1, 0), (0, 1), (1, 0), (0, -1)] {
        let (nr, nc) = (r as i64 + dr, c as i64 + dc);
        if nr >= 0 && nr < rows as i64 && nc >= 0 && nc < cols as i64 {
            out.push(nr as usize * cols + nc as usize);
        }
    }
    out
}
fn components(v: &[i64], rows: usize, cols: usize) -> usize {
    let mut seen = vec![false; v.len()];
    let mut count = 0;
    for start in 0..v.len() {
        if v[start] == 0 || seen[start] {
            continue;
        }
        count += 1;
        let mut stack = vec![start];
        while let Some(i) = stack.pop() {
            if seen[i] || v[i] == 0 {
                continue;
            }
            seen[i] = true;
            stack.extend(neighbors(i, rows, cols));
        }
    }
    count
}
fn rot(v: &[i64], rows: usize, cols: usize) -> Vec<i64> {
    let mut distances = vec![-1; v.len()];
    let mut queue = std::collections::VecDeque::new();
    for (i, x) in v.iter().enumerate() {
        if *x == 2 {
            distances[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for j in neighbors(i, rows, cols) {
            if v[j] == 1 && distances[j] == -1 {
                distances[j] = distances[i] + 1;
                queue.push_back(j);
            }
        }
    }
    distances
}
fn word_found(chars: &[char], rows: usize, cols: usize, word: &[char]) -> bool {
    fn dfs(
        i: usize,
        k: usize,
        chars: &[char],
        dims: (usize, usize),
        word: &[char],
        seen: &mut [bool],
    ) -> bool {
        if seen[i] || chars[i] != word[k] {
            return false;
        }
        if k + 1 == word.len() {
            return true;
        }
        seen[i] = true;
        for j in neighbors(i, dims.0, dims.1) {
            if dfs(j, k + 1, chars, dims, word, seen) {
                seen[i] = false;
                return true;
            }
        }
        seen[i] = false;
        false
    }
    let mut seen = vec![false; chars.len()];
    (0..chars.len()).any(|i| dfs(i, 0, chars, (rows, cols), word, &mut seen))
}
fn embed(chars: &mut [char], rows: usize, cols: usize, word: &[char], rng: &mut Rng) {
    for _ in 0..30 {
        let mut path = vec![int(rng, 0, chars.len() as i64 - 1) as usize];
        while path.len() < word.len() {
            let options: Vec<_> = neighbors(*path.last().unwrap(), rows, cols)
                .into_iter()
                .filter(|i| !path.contains(i))
                .collect();
            if options.is_empty() {
                break;
            }
            path.push(options[(rng.sample() * options.len() as f64).floor() as usize]);
        }
        if path.len() == word.len() {
            for (i, c) in path.into_iter().zip(word) {
                chars[i] = *c;
            }
            return;
        }
    }
    let row = int(rng, 0, rows as i64 - 1) as usize;
    chars[row * cols..row * cols + word.len()].copy_from_slice(word);
}
fn graph(id: &str, seed: f64, difficulty: &str, n: usize, rng: &mut Rng) -> Value {
    let (mut rows, mut cols) = if difficulty == "easy" {
        (4, 4)
    } else if difficulty == "hard" {
        (5, 6)
    } else {
        (5, 5)
    };
    let mut values = vec![];
    let mut extra = json!({"difficulty":difficulty});
    let mut result = json!({"problemId":id,"seed":number(seed)});
    match id {
        "num-islands" | "max-area-island" => {
            values = (0..rows * cols)
                .map(|_| if rng.sample() < 0.45 { 1 } else { 0 })
                .collect();
            for attempt in 0..12 {
                if components(&values, rows, cols) >= 2 {
                    break;
                }
                let mut r = Rng::new(seed + attempt as f64 + 1.0);
                values = (0..rows * cols)
                    .map(|_| if r.sample() < 0.45 { 1 } else { 0 })
                    .collect();
            }
            if components(&values, rows, cols) < 2 {
                values.fill(0);
                values[0] = 1;
                *values.last_mut().unwrap() = 1;
            }
        }
        "rotting-oranges" => {
            if difficulty == "hard" {
                cols = 5;
            }
            let roll = |r: &mut Rng| -> Vec<i64> {
                (0..rows * cols)
                    .map(|_| {
                        let x = r.sample();
                        if x < 0.25 {
                            0
                        } else if x < 0.4 {
                            2
                        } else {
                            1
                        }
                    })
                    .collect()
            };
            values = roll(rng);
            for _ in 0..12 {
                if values.contains(&2) && values.contains(&1) {
                    break;
                }
                values = roll(rng);
            }
            for _ in 0..12 {
                if !values.contains(&2) || !values.contains(&1) {
                    values = roll(rng);
                    continue;
                }
                let d = rot(&values, rows, cols);
                let unreachable = values
                    .iter()
                    .enumerate()
                    .any(|(i, v)| *v == 1 && d[i] == -1);
                if !unreachable || rng.sample() < 0.3 {
                    break;
                }
                values = roll(rng);
            }
            if !values.contains(&2) {
                let i = int(rng, 0, values.len() as i64 - 1) as usize;
                values[i] = 2;
            }
            if !values.contains(&1) {
                let i = values
                    .iter()
                    .position(|v| *v == 0)
                    .unwrap_or_else(|| int(rng, 0, values.len() as i64 - 1) as usize);
                values[i] = 1;
            }
        }
        "word-search" => {
            if difficulty != "easy" {
                cols = 5;
                rows = 5;
            }
            let l = if difficulty == "easy" {
                3
            } else if difficulty == "hard" {
                5
            } else {
                4
            };
            let word = letters(l, rng);
            let present = rng.sample() >= 0.4;
            let mut chars = letters(rows * cols, rng);
            let mut valid;
            if present {
                embed(&mut chars, rows, cols, &word, rng);
                valid = true;
            } else {
                let spot = int(rng, 0, chars.len() as i64 - 1) as usize;
                chars[spot] = word[0];
                valid = word_found(&chars, rows, cols, &word);
                for t in 0..8 {
                    if !valid {
                        break;
                    }
                    chars = letters(rows * cols, &mut Rng::new(seed + t as f64 + 1.0));
                    let spot = int(
                        &mut Rng::new(seed + t as f64 + 100.0),
                        0,
                        chars.len() as i64 - 1,
                    ) as usize;
                    chars[spot] = word[0];
                    valid = word_found(&chars, rows, cols, &word);
                }
                if valid {
                    embed(&mut chars, rows, cols, &word, rng);
                    valid = true;
                }
            }
            tokens(&mut result, &chars);
            values = chars.iter().map(|c| *c as i64).collect();
            extra["word"] = json!(word.iter().collect::<String>());
            extra["valid"] = json!(valid);
        }
        "unique-paths" => {
            values = (0..rows * cols)
                .map(|_| if rng.sample() < 0.25 { 1 } else { 0 })
                .collect();
            values[0] = 0;
            *values.last_mut().unwrap() = 0;
        }
        "lcs-length" | "edit-distance" => {
            let (m, n) = if difficulty == "easy" {
                (3, 3)
            } else if difficulty == "hard" {
                (4, 4)
            } else {
                (3, 4)
            };
            let s = letters(m, rng);
            let t = letters(n, rng);
            rows = m + 1;
            cols = n + 1;
            let mut chars = vec![];
            for r in 0..rows {
                for c in 0..cols {
                    let bit = if r > 0 && c > 0 && s[r - 1] == t[c - 1] {
                        1
                    } else {
                        0
                    };
                    values.push(bit);
                    chars.push(if r == 0 && c == 0 {
                        '•'
                    } else if r == 0 {
                        t[c - 1]
                    } else if c == 0 {
                        s[r - 1]
                    } else if bit == 1 {
                        '1'
                    } else {
                        '0'
                    });
                }
            }
            result["tokens"] = json!(chars.iter().map(char::to_string).collect::<Vec<_>>());
            extra["s"] = json!(s.iter().collect::<String>());
            extra["t"] = json!(t.iter().collect::<String>());
        }
        _ => {
            let n = n.max(4);
            values = (0..n as i64).collect();
            let mut seen = HashSet::new();
            let mut edges = vec![];
            let weighted = id != "union-find-connect";
            if weighted {
                for i in 1..n {
                    let parent = int(rng, 0, i as i64 - 1);
                    seen.insert((parent, i as i64));
                    edges.extend([parent, i as i64, 1 + int(rng, 0, 8)]);
                }
            }
            let m = n + if id == "kruskal-mst" { 2 } else { 1 };
            let width = if weighted { 3 } else { 2 };
            let guard = if weighted { 300 } else { 200 };
            for _ in 0..guard {
                if edges.len() >= width * m {
                    break;
                }
                let (mut u, mut v) = (int(rng, 0, n as i64 - 1), int(rng, 0, n as i64 - 1));
                if u == v {
                    continue;
                }
                let key = if id == "network-delay-time" {
                    (u, v)
                } else {
                    (u.min(v), u.max(v))
                };
                if !seen.insert(key) {
                    continue;
                }
                if id == "kruskal-mst" {
                    (u, v) = key;
                }
                edges.extend([u, v]);
                if weighted {
                    edges.push(1 + int(rng, 0, 8));
                }
            }
            extra["edges"] = json!(edges);
            if id == "network-delay-time" {
                extra["source"] = json!(0);
            }
            rows = 0;
        }
    }
    if rows > 0 {
        extra["rows"] = json!(rows);
        extra["cols"] = json!(cols);
        extra["gridCols"] = json!(cols);
    }
    result["slots"] = slots(values.len());
    result["values"] = json!(values);
    result["extras"] = extra;
    result
}
fn trie(seed: f64, difficulty: &str, rng: &mut Rng) -> Value {
    let core1 = letters(1, rng)[0];
    let mut core2 = letters(1, rng)[0];
    while core1 == core2 {
        core2 = letters(1, rng)[0];
    }
    let want1 = 2 + (rng.sample() * 2.0).floor() as usize;
    let want2 = 2 + (rng.sample() * 2.0).floor() as usize;
    let mut words = std::collections::BTreeSet::new();
    for (core, want) in [(core1, want1), (core2, want2)] {
        for _ in 0..60 {
            if words
                .iter()
                .filter(|w: &&String| w.starts_with(core))
                .count()
                >= want
            {
                break;
            }
            let len = int(rng, 1, 3) as usize;
            let word = std::iter::once(core)
                .chain(letters(len, rng))
                .collect::<String>();
            words.insert(word);
        }
    }
    let words: Vec<_> = words.into_iter().collect();
    let mut nodes = vec![json!({"id":"t0","ch":""})];
    let mut links = vec![];
    let mut children = HashMap::new();
    let mut ends = vec![];
    for word in &words {
        let mut cur = "t0".to_owned();
        for ch in word.chars() {
            let key = (cur.clone(), ch);
            let next = children
                .entry(key)
                .or_insert_with(|| {
                    let id = format!("t{}", nodes.len());
                    nodes.push(json!({"id":id,"ch":ch.to_string()}));
                    links.push(json!({"from":cur,"to":id}));
                    id
                })
                .clone();
            cur = next;
        }
        if !ends.contains(&cur) {
            ends.push(cur);
        }
    }
    let mut counts = std::collections::BTreeMap::new();
    for word in &words {
        for i in 1..word.len() {
            *counts.entry(word[..i].to_owned()).or_insert(0) += 1;
        }
    }
    let mut pool: Vec<_> = counts
        .iter()
        .filter(|(_, c)| **c >= 2)
        .map(|(p, _)| p.clone())
        .collect();
    if pool.is_empty() {
        pool = counts.into_keys().collect();
    }
    let query = pool[(rng.sample() * pool.len() as f64).floor() as usize].clone();
    let completions: Vec<_> = words.iter().filter(|w| w.starts_with(&query)).collect();
    let values: Vec<_> = nodes
        .iter()
        .map(|n| {
            n["ch"]
                .as_str()
                .unwrap()
                .chars()
                .next()
                .map(|c| c as u32)
                .unwrap_or(0)
        })
        .collect();
    let tokens: Vec<_> = nodes
        .iter()
        .map(|n| {
            if n["ch"] == "" {
                json!("·")
            } else {
                n["ch"].clone()
            }
        })
        .collect();
    json!({"problemId":"trie-prefix-search","seed":number(seed),"values":values,"slots":slots(values.len()),"tokens":tokens,"extras":{"difficulty":difficulty,"trieNodes":nodes,"trieLinks":links,"ends":ends,"words":words,"query":query,"completions":completions}})
}
