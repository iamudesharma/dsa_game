//! Player-facing turn guidance: what to do next, and what just happened.
//!
//! Ported from `packages/game-engine/src/guidance.ts`. The oracle decides WHAT;
//! this module decides HOW IT IS SAID. Everything JavaScript-shaped here is
//! deliberate, not incidental: UTF-16 indexing, `undefined` versus `null` keys,
//! array truthiness, `Math.min`/`max` NaN propagation, prototype-chain lookups,
//! and the asymmetry between a guarded and an unguarded oracle call. Each is
//! marked with the `guidance.ts` line it preserves.
//!
//! No database, no provider, no clock, no RNG. The oracle is reached through
//! `state.problemId`, exactly as `runtime.rs:172` already does.
//!
//! # Caller invariant: `spec` and `state` must belong together
//!
//! Node takes `(state, oracle, spec)` and `deriveTurnPrompt` calls
//! `oracle.legalActions(state)` on the oracle it was **given**. This port infers
//! the oracle from `state.problemId` instead, because `legalActions` is the only
//! external dependency and no seam exists to pass one. The consequence is a
//! contract the caller must honour:
//!
//! > the `spec` passed here must be the spec generated for the oracle registered
//! > under `state.problemId`.
//!
//! Breaking it is not a no-op. A doctored-state sweep found **307 of 3,283**
//! states (9.3%) diverge from `problemId` mutation alone: renaming `problemId`
//! without regenerating the spec changes `mechanic` (via `fallback_mechanic`'s
//! `boundDsaOp` lookup), `goal` (via `spec.objective`), every `reason` string and
//! every target label, because the vocabulary no longer matches the board. The
//! module cannot detect this — it has no way to learn which spec belongs to which
//! oracle — so the invariant is documented rather than enforced.
//!
//! `game_routes.rs` honours it: it carries the spec alongside the session state
//! that `oracle_plan::init` produced.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::sync::OnceLock;

// -------------------------------------------------------------- static tables

/// `OPERATION_REASON` (`guidance.ts:44-58`).
const OPERATION_REASON: [(&str, &str); 13] = [
    (
        "read",
        "Looking at one element is how the program checks a single value.",
    ),
    (
        "compare",
        "A comparison tells the program which way to go next.",
    ),
    (
        "choose-path",
        "Throwing away part of the options is what makes the next step cheaper.",
    ),
    (
        "move",
        "Moving an element puts it where the algorithm expects it to be.",
    ),
    (
        "insert",
        "Adding a value keeps the collection usable for the next step.",
    ),
    ("swap", "A swap puts two values in each other’s place."),
    (
        "push",
        "Pushing adds a value on the end so it can be taken out again.",
    ),
    ("pop", "Popping takes the most recent value back off."),
    (
        "traverse",
        "Following a link is the only way to reach the next value.",
    ),
    (
        "link",
        "Re-wiring the link changes where the traversal will go next.",
    ),
    (
        "assign",
        "Saving a value means the program can use it again without recomputing.",
    ),
    (
        "terminate",
        "Finishing is how the program reports its result.",
    ),
    (
        "unlink",
        "Cutting a link removes that route from the structure.",
    ),
];

/// `MECHANIC_IDS` (`mechanics.ts:8-19`) and `ACTION_TYPES` (`action.ts:95-106`)
/// are the same ten strings, and `MECHANICS` has an entry for every one, so this
/// single list answers both `isActionType` and `mechanicForType`'s
/// `MECHANICS[type] ? type : null`.
const MECHANIC_IDS: [&str; 10] = [
    "selectObject",
    "moveObject",
    "comparePair",
    "swapPair",
    "pushPop",
    "choosePath",
    "traverseNode",
    "connectNodes",
    "assignValue",
    "submitAnswer",
];

fn is_action_type(value: &str) -> bool {
    MECHANIC_IDS.contains(&value)
}

fn operation_reason(op: &Value) -> Option<&'static str> {
    op.as_str()
        .and_then(|k| OPERATION_REASON.iter().find(|(id, _)| *id == k))
        .map(|(_, reason)| *reason)
}

/// `spec.vocabulary[key]` (`guidance.ts:113`, `:210`, `:284`).
///
/// Accepted divergence D5: a **missing or non-string** vocabulary field. In
/// `deJargon` the lookup is `words[code] ?? code` (`guidance.ts:519`), so a spec
/// without `vocabulary.lowerWord` keeps the raw `"lt"` in the output, whereas
/// this helper renders the empty string and the output loses the code entirely.
/// Everywhere else the read feeds a template literal, where JavaScript renders
/// the absent field as `"undefined"`, so the divergence there is `"undefined"`
/// versus `""`. Every committed spec is `GameSpecSchema.parse`d, which requires
/// all nine fields, so neither is reachable from the registered paths;
/// `de_jargon` reaches it only with a hand-authored spec.
fn vocab<'a>(spec: &'a Value, key: &str) -> &'a str {
    spec["vocabulary"][key].as_str().unwrap_or("")
}

// --------------------------------------------------- JavaScript value helpers

/// ECMAScript truthiness (`guidance.ts:119`, `:124`, `:492`). Arrays and objects
/// are always truthy, including `[]` and `{}`.
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => false,
        // serde_json cannot hold a NaN, so `as_f64` covers every number.
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `typeof value === 'number'`, expressed as an `Option<f64>`. Identical to
/// `value.as_f64()` on every JSON value — a JSON number is the only JSON value
/// that satisfies both — but named for the JavaScript predicate it stands in
/// for, because the call sites read `typeof lo !== 'number'`.
fn js_number(value: &Value) -> Option<f64> {
    value.as_f64()
}

/// `Math.min`: NaN poisons the result. `f64::min` is IEEE `minNum`, which returns
/// the non-NaN operand, so it is the wrong function (`guidance.ts:390`).
///
/// **The NaN arm at `build_indicator`'s call site is dead.** `progress` is
/// `live.len() / all.len()` over two `usize`s and `all.len() >= 1` there, so it is
/// always finite and in `[0, 1]`. It is written anyway because silently coercing
/// NaN to `0` is the exact bug the trap describes, and because
/// `js_min_and_max_propagate_nan` pins the primitive. Note that `json!(f64::NAN)`
/// does **not** panic — `serde_json::Number::from_f64` returns `None` and the
/// `json!` macro yields `Value::Null`, which would silently emit
/// `"progress": null`. That is a second reason the arm must stay unreachable.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// `arr[codeLine - 1]` (`guidance.ts:446`): only a positive integer yields an
/// element. `0`, `-1` and `1.5` all index to `undefined`.
fn js_index(code_line: f64) -> Option<usize> {
    (code_line.is_finite() && code_line >= 1.0 && code_line.fract() == 0.0)
        .then(|| code_line as usize - 1)
}

/// `Array.prototype.sort`'s comparator. JavaScript tolerates a NaN comparison and
/// treats it as 0; `partial_cmp` returns `None`, so it must not be unwrapped.
fn js_cmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// `String(value)` inside a template literal. `serde_json` prints an f64 as
/// `1.0` where JavaScript prints `1` (`guidance.ts:284`, `:297`, `:318`).
fn js_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                return i.to_string();
            }
            if let Some(u) = n.as_u64() {
                return u.to_string();
            }
            let f = n.as_f64().unwrap_or(f64::NAN);
            if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e21 {
                return format!("{f:.0}");
            }
            n.to_string()
        }
        _ => String::new(),
    }
}

/// `JSON.stringify` of a number. serde_json renders the f64 `1.0` as `1.0`,
/// while JavaScript renders it as `1`, so an integral `progress` must be emitted
/// as an integer or the wire bytes differ (`guidance.ts:127`, `:387`).
fn js_json_number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e21 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

/// A JavaScript property-key coercion, for `state.objects[id]` and for
/// `Set.has`, which compares primitives by value.
fn js_property_key(value: &Value) -> String {
    js_to_string(value)
}

/// `Object.values(state.objects)`. `runtime::coerce` sorts the object keys on
/// the way in (`runtime.rs:61`), so insertion order here IS Node's
/// sorted-key order. Do not re-sort: `buildTargets`' last step,
/// `branchTargets`' `live[live.length - 1]` and `occupantOfSlot`'s `find` all
/// depend on it.
///
/// Accepted divergence D2: `Object.values(undefined)` throws in Node. A
/// `GameState` without `objects` is unreachable (`runtime::coerce` always emits
/// one) and the empty case is already handled by `build_indicator`'s
/// `all.length === 0` branch, so Rust returns empty.
fn object_values(objects: &Value) -> Vec<&Value> {
    objects
        .as_object()
        .map(|m| m.values().collect())
        .unwrap_or_default()
}

/// Every member `Object.prototype` puts on a plain object literal. `objectMap`
/// builds `{}` (`runtime.ts:592`), so `state.objects['constructor']` is TRUTHY
/// with every field read `undefined` (`guidance.ts:311`, `:344`, `:583`).
const PROTOTYPE_MEMBERS: [&str; 12] = [
    "constructor",
    "__defineGetter__",
    "__defineSetter__",
    "hasOwnProperty",
    "__lookupGetter__",
    "__lookupSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "__proto__",
    "toLocaleString",
];

/// `container[key]`. `Some(None)` is the prototype-chain case: the lookup
/// succeeded, but reading a field from it yields `undefined`.
fn js_get<'a>(container: &'a Value, key: &str) -> Option<Option<&'a Value>> {
    match container.as_object().and_then(|m| m.get(key)) {
        Some(value) => Some(Some(value)),
        None if PROTOTYPE_MEMBERS.contains(&key) => Some(None),
        None => None,
    }
}

fn js_get_truthy(slot: &Option<Option<&Value>>) -> bool {
    match slot {
        None => false,
        // A prototype member exists, so it is truthy even though it has no fields.
        Some(None) => true,
        Some(Some(value)) => js_truthy(value),
    }
}

/// A field read on an object obtained from `js_get`. `None` is `undefined` — a
/// missing key, or a prototype member. A real `null` stays `Some(Value::Null)`.
fn member<'a>(slot: &Option<Option<&'a Value>>, key: &str) -> Option<&'a Value> {
    match slot {
        Some(Some(object)) => object.get(key),
        _ => None,
    }
}

/// `(o.value ?? 0)` (`guidance.ts:291-292`).
fn value_or_zero(object: &Value) -> f64 {
    object.get("value").and_then(Value::as_f64).unwrap_or(0.0)
}

/// A field read interpolated into a template literal. `None` is `undefined`,
/// which a template literal renders as the four letters `"undefined"` — NOT as
/// `"null"`. Reading the missing key through `serde_json`'s `Index` yields
/// `Value::Null`, so the two cases must be distinguished by the `Option`, not by
/// the JSON value.
fn js_template(read: Option<&Value>) -> String {
    read.map_or_else(|| "undefined".into(), js_to_string)
}

/// The `toTarget` label precedence (`guidance.ts:314-319`). `None` means the read
/// yields `undefined`: `JSON.stringify` drops the key, while a template literal
/// renders it as `"undefined"`. The distinction is the whole observable
/// difference at `guidance.ts:311-319`.
fn target_label(slot: &Option<Option<&Value>>, spec: &Value) -> Option<Value> {
    if member(slot, "kind").and_then(Value::as_str) == Some("target") {
        return Some(json!(format!("the {}", vocab(spec, "target"))));
    }
    match member(slot, "value") {
        Some(value) => Some(json!(format!(
            "{} {}",
            vocab(spec, "object"),
            js_to_string(value)
        ))),
        None => member(slot, "label").cloned(),
    }
}

// ------------------------------------------------------ mechanics and DsaOps

fn mechanic_for_type(kind: &str) -> Option<&str> {
    is_action_type(kind).then_some(kind)
}

/// `opForActionType` (`guidance.ts:171-174`), resolved through the already-ported
/// `runtime::op` table rather than a third copy of it.
///
/// `deriveFeedback` passes a `DsaOp` here, not an action type
/// (`guidance.ts:440`). `isActionType` rejects all thirteen `DsaOp` values, so
/// this ALWAYS returns `'read'`: with no frame, every verdict describes a read.
/// That is a Node behaviour, preserved rather than fixed.
fn op_for_action_type(kind: &str) -> &'static str {
    match mechanic_for_type(kind) {
        Some(_) => crate::runtime::op(kind),
        None => "read",
    }
}

fn fallback_mechanic(spec: &Value, dsa_op: &Value) -> String {
    let mechanics = spec["mechanics"].as_array();
    if let Some(bound) = mechanics.and_then(|m| m.iter().find(|x| x["boundDsaOp"] == *dsa_op)) {
        return bound["id"].as_str().unwrap_or_default().to_owned();
    }
    // `spec.mechanics[0]?.id` is NOT re-validated against the catalog.
    mechanics
        .and_then(|m| m.first())
        .and_then(|m| m["id"].as_str())
        .unwrap_or("selectObject")
        .to_owned()
}

/// `fallbackOp` (`guidance.ts:183-188`): the first mechanic whose `boundDsaOp` is
/// not already in the trace, else the LAST mechanic's, else `'read'`.
fn fallback_op(state: &Value, spec: &Value) -> Value {
    let used: HashSet<String> = state["trace"]
        .as_array()
        .map(|frames| {
            frames
                .iter()
                .map(|f| js_property_key(&f["dsaOp"]))
                .collect()
        })
        .unwrap_or_default();
    let mechanics = spec["mechanics"].as_array();
    if let Some(next) = mechanics.and_then(|m| {
        m.iter()
            .find(|x| !used.contains(&js_property_key(&x["boundDsaOp"])))
    }) {
        return next["boundDsaOp"].clone();
    }
    mechanics
        .and_then(|m| m.last())
        .map(|m| m["boundDsaOp"].clone())
        .filter(|op| !op.is_null())
        .unwrap_or_else(|| json!("read"))
}

/// `MECHANIC_INSTRUCTION` (`guidance.ts:61-72`) as a function. A mechanic outside
/// the table makes Node throw `TypeError: build is not a function`; the module's
/// stated contract is total, so Rust substitutes `selectObject`'s instruction
/// (accepted divergence D3, closed by `tests/guidance.rs`).
fn mechanic_instruction(mechanic: &str, verb: &str, target: &str) -> String {
    match mechanic {
        "selectObject" | "comparePair" => format!("{verb} {target}."),
        "moveObject" => format!("{verb} {target} to where it belongs."),
        "swapPair" => format!("{verb} {target} and the other one."),
        "pushPop" => format!("{verb} the value on and off the stack."),
        "choosePath" => format!("{verb} the part worth keeping."),
        "traverseNode" => format!("{verb} the next one along."),
        "connectNodes" => format!("{verb} the two together."),
        "assignValue" => format!("{verb} the value down."),
        "submitAnswer" => format!("{verb} your answer."),
        _ => format!("{verb} {target}."),
    }
}

/// `buildInstruction` (`guidance.ts:190-211`). The LLM's themed label wins; the
/// oracle's `expected.label` is deliberately never surfaced, because it names the
/// position and on the winning turn the position IS the answer.
fn build_instruction(spec: &Value, mechanic: &str, verb: &str, target_phrase: &str) -> String {
    let authored = spec["mechanics"]
        .as_array()
        .and_then(|m| m.iter().find(|x| x["id"].as_str() == Some(mechanic)))
        .and_then(|x| x["label"].as_str())
        .map(crate::compat::trim)
        .filter(|label| !label.is_empty());
    match authored {
        Some(label) => label.to_owned(),
        None => mechanic_instruction(mechanic, &capitalise(verb), target_phrase),
    }
}

// ------------------------------------------------------------------- the turn

/// The action the oracle says is legal right now, if it tells us
/// (`guidance.ts:156-162`).
///
/// Node has NO try/catch here, and neither does this. A throwing `legalActions`
/// must propagate: `oracle_plan::legal` unwraps `as_str()` on `problemId`, so a
/// numeric `problemId` panics, which is the reachable equivalent. Contrast
/// `hints.rs:127`, which guards `legal` because `hints.ts` guards it.
///
/// Reaching "no legal actions" in Rust needs BOTH an unregistered `problemId` and
/// an `internal.planIndex` past the end of the plan. `oracle_plan::legal` falls
/// through to the planned branch, where `plan_index` defaults to 0 and
/// `plan.get(0)` succeeds, so a renamed `problemId` on its own still yields a
/// `selectObject` descriptor.
fn expected_action(state: &Value) -> Option<Value> {
    let legal = crate::oracle_plan::legal(state);
    legal
        .as_array()
        .filter(|actions| !actions.is_empty())
        .map(|actions| actions[0].clone())
}

/// `buildTargets` (`guidance.ts:213-256`), as ordered fallbacks.
fn build_targets(state: &Value, spec: &Value, expected: Option<&Value>, mechanic: &str) -> Value {
    let legal: Vec<&Value> = expected
        .and_then(|e| e["options"]["objectIds"].as_array())
        .map(|a| a.iter().collect())
        .unwrap_or_default();

    // "Legal" is not "do this". When the mechanic is point-at-one, the
    // algorithm's own pointer is the recommendation and it wins over the legal
    // set, which for binary search is the whole window.
    if mechanic == "selectObject" {
        if let Some(pointed) = object_at_cursor(state) {
            let allowed =
                legal.is_empty() || legal.iter().any(|id| id.as_str() == Some(pointed.as_str()));
            if allowed {
                return match to_target(state, spec, &pointed, "current") {
                    Some(target) => json!([target]),
                    None => json!([]),
                };
            }
        }
    }

    if mechanic == "choosePath" {
        let branches = branch_targets(state, spec);
        if !branches.as_array().is_some_and(|b| b.is_empty()) {
            return branches;
        }
    }

    if !legal.is_empty() {
        return Value::Array(
            legal
                .iter()
                .filter_map(|id| {
                    let id = js_property_key(id);
                    let role = role_for(&id, state, expected, mechanic);
                    to_target(state, spec, &id, &role)
                })
                .collect(),
        );
    }

    // No legal-action hint: fall back to the state itself, which is enough for
    // the pointer-driven mechanics.
    if let Some(slot) = state["cursor"]["midSlotId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
    {
        if let Some(id) = occupant_of_slot(state, &slot) {
            return match to_target(state, spec, &id, "current") {
                Some(target) => json!([target]),
                None => json!([]),
            };
        }
    }
    match object_values(&state["objects"])
        .first()
        .and_then(|o| o["id"].as_str())
    {
        Some(id) => match to_target(state, spec, id, "candidate") {
            Some(target) => json!([target]),
            None => json!([]),
        },
        None => json!([]),
    }
}

/// `branchTargets` (`guidance.ts:271-303`). Every emitted id is a real board
/// object id; an earlier version minted synthetic `__branch_high_v3` ids that
/// highlighted nothing.
///
/// `state === 'matched'` is deliberately NOT excluded from `live` here, unlike in
/// `build_indicator` — this function filters only on `kind`, `state ===
/// 'eliminated'` and the presence of `value` (`guidance.ts:272-274`).
/// `state.slots[o.slotId].index` is read by `build_indicator`, not here.
///
/// `live` itself is never sorted; only the filtered copy `higher` is, so
/// `live[live.length - 1]` still names the last object in `Object.values` order.
fn branch_targets(state: &Value, spec: &Value) -> Value {
    let live: Vec<&Value> = object_values(&state["objects"])
        .into_iter()
        .filter(|o| {
            o["kind"].as_str() != Some("target")
                && o["state"].as_str() != Some("eliminated")
                && o.get("value").is_some()
        })
        .collect();
    if live.len() < 2 {
        return json!([]);
    }
    let mid = match object_at_cursor(state).filter(|id| !id.is_empty()) {
        Some(id) => js_get(&state["objects"], &id),
        None => None,
    };
    if !js_get_truthy(&mid) || member(&mid, "value").is_none() {
        return json!([]);
    }
    // The guards above imply the object is a real board object, not a prototype
    // member, so this never fails — but a `let else` keeps the panic out.
    let Some(Some(mid_object)) = mid else {
        return json!([]);
    };
    let mid_value = mid_object["value"].clone();
    let mid_number = mid_value.as_f64().unwrap_or(0.0);

    let mut out = vec![json!({
        "id": mid_object["id"].clone(),
        "label": format!("{} than {} {}", vocab(spec, "lowerWord"), vocab(spec, "object"), js_to_string(&mid_value)),
        "hint": format!("if the {} is on the {} side", vocab(spec, "target"), vocab(spec, "lowerWord")),
        "role": "current",
    })];

    // Named `higher`, but it is the SMALLEST strictly greater live value; ties
    // break on sort stability, which preserves `Object.values` order. Only the
    // FILTERED COPY is sorted: `live` must keep its order so
    // `live[live.length - 1]` is the same element JavaScript picks.
    let mut higher: Vec<&Value> = live
        .iter()
        .copied()
        .filter(|o| value_or_zero(o) > mid_number)
        .collect();
    higher.sort_by(|a, b| js_cmp(value_or_zero(a), value_or_zero(b)));
    let higher_id = higher
        .first()
        .and_then(|o| o["id"].as_str())
        .or_else(|| live.last().and_then(|o| o["id"].as_str()))
        .map(str::to_owned)
        .filter(|id| !id.is_empty());
    if let Some(id) = higher_id {
        out.push(json!({
            "id": id,
            "label": format!("{} than {} {}", vocab(spec, "higherWord"), vocab(spec, "object"), js_to_string(&mid_value)),
            "hint": format!("if the {} is on the {} side", vocab(spec, "target"), vocab(spec, "higherWord")),
            "role": "candidate",
        }));
    }
    Value::Array(out)
}

/// `toTarget` (`guidance.ts:305-321`). Key order `id, label, hint, role`; the
/// `label` key is dropped entirely when the read yields `undefined`, which
/// happens for an `Object.prototype` member id.
fn to_target(state: &Value, spec: &Value, object_id: &str, role: &str) -> Option<Value> {
    let object = js_get(&state["objects"], object_id);
    if !js_get_truthy(&object) {
        return None;
    }
    let mut out = Map::new();
    out.insert("id".into(), json!(object_id));
    if let Some(label) = target_label(&object, spec) {
        out.insert("label".into(), label);
    }
    out.insert("hint".into(), json!(role_hint(role, spec)));
    out.insert("role".into(), json!(role));
    Some(Value::Object(out))
}

fn role_hint(role: &str, spec: &Value) -> String {
    match role {
        "current" => "the one the program is looking at".into(),
        "target" => format!("the {} to find", vocab(spec, "target")),
        "excluded" => "already ruled out".into(),
        "answer" => "where the answer goes".into(),
        _ => "pick this one".into(),
    }
}

/// `roleFor` (`guidance.ts:338-352`). The order is load-bearing.
fn role_for(id: &str, state: &Value, expected: Option<&Value>, mechanic: &str) -> String {
    let object = js_get(&state["objects"], id);
    if !js_get_truthy(&object) {
        return "candidate".into();
    }
    if member(&object, "kind").and_then(Value::as_str) == Some("target") {
        return "target".into();
    }
    if member(&object, "state").and_then(Value::as_str) == Some("eliminated") {
        return "excluded".into();
    }
    if mechanic == "submitAnswer" {
        return "answer".into();
    }
    if object_at_cursor(state).as_deref() == Some(id) {
        return "current".into();
    }
    if expected.and_then(|e| {
        e["options"]["objectIds"]
            .get(0usize)
            .and_then(Value::as_str)
    }) == Some(id)
    {
        return "current".into();
    }
    "candidate".into()
}

/// `objectAtCursor` (`guidance.ts:354-359`). `cursor.loSlotId`, `hiSlotId` and
/// `prevNodeId` are never read by guidance.
fn object_at_cursor(state: &Value) -> Option<String> {
    let cursor = &state["cursor"];
    let slot = cursor["midSlotId"]
        .as_str()
        .or_else(|| cursor["iSlotId"].as_str())
        .or_else(|| cursor["jSlotId"].as_str())
        .filter(|s| !s.is_empty());
    if let Some(slot) = slot {
        return occupant_of_slot(state, slot);
    }
    cursor["bestObjectId"]
        .as_str()
        .or_else(|| cursor["nodeId"].as_str())
        .map(str::to_owned)
}

/// `occupantOfSlot` (`guidance.ts:361-365`). `find` runs in `Object.values` order,
/// so it is the first object in iteration order whose `slotId` matches.
fn occupant_of_slot(state: &Value, slot_id: &str) -> Option<String> {
    if js_truthy(&state["slots"][slot_id]["occupantId"]) {
        return state["slots"][slot_id]["occupantId"]
            .as_str()
            .map(str::to_owned);
    }
    object_values(&state["objects"])
        .into_iter()
        .find(|o| o["slotId"] == *slot_id)
        .and_then(|o| o["id"].as_str())
        .map(str::to_owned)
}

/// `describeTargets` (`guidance.ts:367-372`). A missing `label` stringifies to
/// `"undefined"`, exactly as a template literal does.
fn describe_targets(targets: &[Value], spec: &Value) -> String {
    // `targets[i].label` is `undefined` when `toTarget` dropped the key, which
    // happens for an `Object.prototype` member id. A template literal renders
    // that as `"undefined"`, so `js_to_string(Value::Null)` — `"null"` — would be
    // a divergence. `get` keeps the two cases apart.
    let label = |i: usize| js_template(targets[i].get("label"));
    match targets.len() {
        0 => "the board".into(),
        1 => label(0),
        2 => format!("{} and {}", label(0), label(1)),
        _ => format!("one of the {}", vocab(spec, "objectPlural")),
    }
}

/// `buildIndicator` (`guidance.ts:380-393`). "How much is left", expressed as
/// surviving elements rather than `lo`/`mid`/`hi`, because the narrowing window
/// is the idea and `lo <= hi` is the notation.
fn build_indicator(state: &Value, spec: &Value) -> Value {
    let all: Vec<&Value> = object_values(&state["objects"])
        .into_iter()
        .filter(|o| o["kind"].as_str() != Some("target"))
        .collect();
    if all.is_empty() {
        return json!({"label": vocab(spec, "place"), "progress": 1, "detail": "nothing left"});
    }
    // Node's guard is `typeof lo !== 'number'`. On every JSON value that is the
    // same predicate as `as_f64().is_some()`: a JSON number is the only thing
    // that is both a JSON number and `typeof 'number'`, and a numeric STRING is
    // neither. `js_number` exists so that equivalence is asserted rather than
    // assumed — `a_numeric_lo_is_not_a_number_lo` is the closing test.
    let lo = js_number(&state["variables"]["lo"]);
    let hi = js_number(&state["variables"]["hi"]);
    // `o.slotId &&` is truthiness, so an object with a missing or empty `slotId`
    // drops out of `live` entirely.
    let in_window = |o: &Value| {
        if o["state"].as_str() == Some("eliminated") || o["state"].as_str() == Some("matched") {
            return false;
        }
        if state["problemId"] != "rotated-search" || lo.is_none() || hi.is_none() {
            return true;
        }
        let slot_id = o["slotId"].as_str().unwrap_or_default();
        if !js_truthy(&o["slotId"]) {
            return false;
        }
        let index = state["slots"][slot_id]["index"].as_f64().unwrap_or(-1.0);
        match (lo, hi) {
            (Some(lo), Some(hi)) => index >= lo && index <= hi,
            // Unreachable: the `lo.is_none() || hi.is_none()` guard above already
            // returned. Written as a `match` so no `expect` can panic here.
            _ => true,
        }
    };
    let live: Vec<&Value> = all.iter().copied().filter(|o| in_window(o)).collect();
    // The `all.length === 0 ? 0 :` arm is dead: it returned above.
    let progress = js_max(0.0, js_min(1.0, live.len() as f64 / all.len() as f64));
    json!({
        "label": format!("still in play in the {}", vocab(spec, "place")),
        "progress": js_json_number(progress),
        "detail": format!(
            "{} of {} {} left",
            live.len(),
            all.len(),
            if all.len() == 1 { vocab(spec, "object") } else { vocab(spec, "objectPlural") },
        ),
    })
}

/// `legal[0]` read with JavaScript truthiness, applied ONCE. Node has a single
/// `expected` binding used as both `expected ? … : …` and `expected?.…`, so a
/// falsy descriptor — `null`, `undefined`, `0`, `''` — takes the fallback arms
/// everywhere at the same time. Proven in Node: `legalActions: () => [null]`,
/// `() => [undefined]` and `() => [0]` all yield the same prompt.
fn truthy_expected(legal: Option<Value>) -> Option<Value> {
    legal.filter(js_truthy)
}

/// `expected?.dsaOp ?? (expected && isActionType(expected.type)
///     ? opForActionType(expected.type) : fallbackOp(state, spec))`
/// (`guidance.ts:103-105`). `expected.dsaOp` wins even when it is not a valid
/// `DsaOp`, and is then used as a raw map key.
fn select_dsa_op(expected: Option<&Value>, state: &Value, spec: &Value) -> Value {
    // The same truthiness filter as `select_mechanic`, for symmetry and to keep the
    // two selectors honest about what `expected` means. It is REDUNDANT here: a
    // falsy `Value` has no `dsaOp` to read (`Null.get(..)` is `None`) and no
    // `type` (`Null["type"].as_str()` is `None`), so the unfiltered version reaches
    // `fallbackOp` anyway. It is kept because relying on that coincidence is how
    // `select_mechanic` got its bug — there, reading `type` off a falsy value
    // yields `selectObject`, which is a real divergence. A perturbation that drops
    // this filter SURVIVES the suite, and that is correct: it is not a defect.
    let expected = expected.filter(|e| js_truthy(e));
    if let Some(op) = expected
        .and_then(|e| e.get("dsaOp"))
        .filter(|op| !op.is_null())
    {
        return op.clone();
    }
    match expected.filter(|e| e["type"].as_str().is_some_and(is_action_type)) {
        Some(e) => json!(op_for_action_type(e["type"].as_str().unwrap_or_default())),
        None => fallback_op(state, spec),
    }
}

/// `expected ? (mechanicForType(expected.type) ?? 'selectObject')
///     : fallbackMechanic(spec, dsaOp)` (`guidance.ts:107-109`). An unknown
/// ACTION TYPE yields `selectObject`, which is NOT the same as having no
/// `expected` at all — that takes the spec-derived mechanic.
fn select_mechanic(expected: Option<&Value>, spec: &Value, dsa_op: &Value) -> String {
    // The truthiness filter lives HERE rather than only at the call site, so this
    // function is correct for any `Option` it is handed. Node's own guard is
    // `expected ? … : fallbackMechanic(…)`, and `legal[0]` can be `null`,
    // `undefined`, `0` or `''`; a `Some(Value::Null)` that reached the first arm
    // would read `expected.type` as `undefined` and yield `selectObject` instead
    // of the spec-derived mechanic.
    match expected.filter(|e| js_truthy(e)) {
        Some(e) => e["type"]
            .as_str()
            .and_then(mechanic_for_type)
            .unwrap_or("selectObject")
            .to_owned(),
        None => fallback_mechanic(spec, dsa_op),
    }
}

/// `...(mechanic === 'assignValue' && expected?.options?.targetIds
///     ? { assignmentTargetIds: expected.options.targetIds } : {})` (`guidance.ts:124`).
///
/// The test is **ARRAY TRUTHINESS**, not emptiness: `[]` is truthy in
/// JavaScript, so `targetIds: []` emits the key present-and-empty. A
/// `!ids.is_empty()` guard would drop the key and silently change the wire
/// shape. `None` means "do not emit the key at all".
///
/// No registered oracle emits `targetIds: []`, so the committed sweep cannot
/// reach the `[]` arm; `optional_key_presence_follows_array_truthiness` drives it
/// directly, and the Node-only stub cases carry the differential evidence.
fn assignment_target_ids(expected: Option<&Value>, mechanic: &str) -> Option<Value> {
    if mechanic != "assignValue" {
        return None;
    }
    Some(
        expected
            .and_then(|e| e["options"].get("targetIds"))
            .filter(|ids| js_truthy(ids))?
            .clone(),
    )
}

/// `...(mechanic === 'submitAnswer'
///     ? { answerTargetId: expected?.options?.objectIds?.[0] ?? 'answer' } : {})`
/// (`guidance.ts:125`).
///
/// `??`, so `''` is emitted as `''` and a JSON `null` falls back to `'answer'`.
/// The key is ALWAYS present on a `submitAnswer` turn, which is why the caller
/// inserts whatever this returns.
fn answer_target_id(expected: Option<&Value>, mechanic: &str) -> Option<Value> {
    if mechanic != "submitAnswer" {
        return None;
    }
    Some(
        expected
            .and_then(|e| e["options"]["objectIds"].get(0usize))
            .filter(|id| !id.is_null())
            .cloned()
            .unwrap_or_else(|| json!("answer")),
    )
}

/// `deriveNudge` (`guidance.ts:401-423`). The tone is about the situation, never
/// the person, and it never says whether an action was right.
fn derive_nudge(state: &Value) -> Value {
    let frames = state["trace"].as_array();
    let recent: Vec<&Value> = frames
        .map(|frames| frames.iter().skip(frames.len().saturating_sub(2)).collect())
        .unwrap_or_default();
    // `recent.every((f) => !f.correct)` is ECMAScript truthiness, not `!== true`.
    // `{correct: 1}` and `{correct: 'x'}` are TRUTHY and therefore clear the
    // streak; `{correct: 0}` and `{correct: ''}` do not.
    let consecutive_wrong = !recent.is_empty() && recent.iter().all(|f| !js_truthy(&f["correct"]));
    let mistakes = state["progress"]["mistakes"].as_f64().unwrap_or(0.0);
    if mistakes >= 4.0 && consecutive_wrong {
        return json!({"tone": "urgent", "message": "Take a breath and read the highlighted ones only — the rest are already gone."});
    }
    if mistakes >= 2.0 && consecutive_wrong {
        return json!({"tone": "gentle", "message": "Two in a row. Look at the one marked as the middle, and compare just that one."});
    }
    if consecutive_wrong {
        return json!({"tone": "gentle", "message": "Not this time. Try the highlighted one."});
    }
    Value::Null
}

/// `terminalPrompt` (`guidance.ts:133-153`). No optional keys at all, and a real
/// `null` nudge — not an absent one.
fn terminal_prompt(state: &Value) -> Value {
    let won = state["phase"] == "won";
    json!({
        "goal": if won { "You finished the round." } else { "The round ended without a match." },
        "instruction": if won { "Look at what your moves did." } else { "See where the search went." },
        "mechanic": "submitAnswer",
        "dsaOp": "terminate",
        "targets": [],
        "reason": if won {
            "The program found it because each of your moves threw away something it no longer needed."
        } else {
            "Every move that ruled out the right place also rules out the answer."
        },
        "progress": 1,
        "indicator": {
            "label": "search space",
            "progress": 1,
            "detail": if won { "empty — the target was here" } else { "empty — nothing left to check" },
        },
        "nudge": Value::Null,
    })
}

/// Build the "your turn" instruction (`deriveTurnPrompt`).
///
/// Total by construction: an oracle without `legalActions`, a spec without a
/// matching mechanic binding, or an unrecognised action type all degrade to a
/// generic instruction rather than throwing.
///
/// `GuidanceInput.band` is accepted and IGNORED by Node (`guidance.ts:79`
/// declares it, `:91` destructures only `{state, oracle, spec}`). There is
/// deliberately no `band` parameter here, which is the strongest form of
/// "accepted and ignored": a caller cannot accidentally start using it.
pub fn derive_turn_prompt(state: &Value, spec: &Value) -> Value {
    if state["phase"] != "playing" {
        return terminal_prompt(state);
    }

    // Node reads `expected` in two shapes: `expected ? A : B` and
    // `expected?.x`. Both treat a FALSY `expected` as absent — `legal[0]` can be
    // `null`, `undefined`, `0` or `''`, and all four take the `fallbackOp` /
    // `fallbackMechanic` arms. Funnelling through one predicate keeps `dsaOp`,
    // `mechanic` and `buildTargets` on the same truthiness, which is what Node
    // does because it has a single `expected` binding.
    let legal = expected_action(state);
    let dsa_op = select_dsa_op(legal.as_ref(), state, spec);
    let mechanic = select_mechanic(legal.as_ref(), spec, &dsa_op);

    // `build_targets` also needs the filtered binding: Node reads
    // `expected?.options?.objectIds`, which is `undefined` for a falsy descriptor.
    let expected = truthy_expected(legal);
    let targets = build_targets(state, spec, expected.as_ref(), &mechanic);
    let indicator = build_indicator(state, spec);
    let verb = vocab(spec, "actionVerb");
    let found: &[Value] = match targets.as_array() {
        Some(list) => list,
        None => &[],
    };
    let target_phrase = describe_targets(found, spec);
    let instruction = build_instruction(spec, &mechanic, verb, &target_phrase);

    let mut out = Map::new();
    // `firstSentence(spec.objective) || verb`: `||`, so an empty first sentence
    // falls back to the action verb.
    let objective = first_sentence(spec["objective"].as_str().unwrap_or_default());
    out.insert(
        "goal".into(),
        json!(if objective.is_empty() {
            verb
        } else {
            &objective
        }),
    );
    out.insert("instruction".into(), json!(instruction));
    out.insert("mechanic".into(), json!(mechanic));
    out.insert("dsaOp".into(), dsa_op.clone());
    out.insert("targets".into(), targets);
    // Optional keys land AFTER `targets` and BEFORE `reason`.
    if let Some(ids) = assignment_target_ids(expected.as_ref(), &mechanic) {
        out.insert("assignmentTargetIds".into(), ids);
    }
    if let Some(id) = answer_target_id(expected.as_ref(), &mechanic) {
        out.insert("answerTargetId".into(), id);
    }
    out.insert(
        "reason".into(),
        json!(operation_reason(&dsa_op).unwrap_or("This is one of the steps the program takes.")),
    );
    // `progress` is `indicator.progress`, not a recomputation.
    out.insert("progress".into(), indicator["progress"].clone());
    out.insert("indicator".into(), indicator);
    out.insert("nudge".into(), derive_nudge(state));
    Value::Object(out)
}

// ----------------------------------------------------------------- feedback

/// `try { codeLineText = oracle.code('javascript')[codeLine - 1] ?? '' }
///  catch { codeLineText = '' }` (`guidance.ts:445-449`). The guard wraps the
/// CALL AND THE INDEX. A panic is the analogue of a JavaScript throw, so
/// `catch_unwind` is the analogue of `try`/`catch`.
///
/// Deliberately **not** wrapped in `AssertUnwindSafe`: the closure borrows only
/// `&Value` and `&Value` is `RefUnwindSafe`, so the compiler enforces the property
/// here instead of it being asserted in prose. If a future edit introduces shared
/// mutable state into the closure, this stops compiling rather than silently
/// becoming unsound.
fn code_line_text(state: &Value, code_line: &Value) -> String {
    std::panic::catch_unwind(|| {
        let id = state["problemId"].as_str().unwrap_or_default();
        let index = js_index(code_line.as_f64().unwrap_or(f64::NAN))?;
        let lines = crate::oracle_plan::code(id, "javascript");
        let line: &str = lines.get(index)?.as_str();
        Some(line.to_owned())
    })
    .ok()
    .flatten()
    .unwrap_or_default()
}

fn headline_for_correct(dsa_op: &Value, spec: &Value) -> String {
    match dsa_op.as_str().unwrap_or_default() {
        "compare" => "Compared.".into(),
        "choose-path" => "Half the board gone.".into(),
        "read" => "Locked on.".into(),
        "terminate" => format!("Found the {}.", vocab(spec, "target")),
        _ => "Right move.".into(),
    }
}

fn headline_for_wrong(dsa_op: &Value, spec: &Value) -> String {
    match dsa_op.as_str().unwrap_or_default() {
        "compare" => "Not what the program sees.".into(),
        "choose-path" => format!("That threw away the {}.", vocab(spec, "target")),
        _ => "Not this one.".into(),
    }
}

fn operation_name(dsa_op: &Value, spec: &Value) -> String {
    match dsa_op.as_str().unwrap_or_default() {
        "compare" => format!("compared two {}", vocab(spec, "objectPlural")),
        "choose-path" => format!("kept part of the {}", vocab(spec, "place")),
        "read" => format!("read one {}", vocab(spec, "object")),
        "terminate" => "finished the search".into(),
        "swap" => "swapped two values".into(),
        "push" => "pushed a value".into(),
        "pop" => "popped a value".into(),
        "traverse" => "followed a link".into(),
        "link" => "wired two nodes".into(),
        "assign" => "saved a value".into(),
        "move" => "moved a value".into(),
        "insert" => "inserted a value".into(),
        "unlink" => "cut a link".into(),
        _ => "made a move".into(),
    }
}

/// `encourageFor` (`guidance.ts:640-644`). `steps <= 2` and any mistake at all
/// leave `encourage` undefined, which `JSON.stringify` drops.
fn encourage_for(state: &Value) -> Option<String> {
    if state["progress"]["steps"].as_f64().unwrap_or(0.0) <= 2.0 {
        return None;
    }
    if state["progress"]["mistakes"].as_f64().unwrap_or(0.0) == 0.0 {
        return Some("No wrong turns yet — that halving is doing its job.".into());
    }
    None
}

/// `nextStepForExpected` (`guidance.ts:568-605`). Only `objectId`, `aId` and
/// `relation` are consulted; `bId`, `fromId`, `pathId`, `targetId` and
/// `toSlotId` are ignored.
fn next_step_for_expected(expected: &Value, state: &Value, spec: &Value) -> Option<String> {
    if !js_truthy(expected) {
        return None;
    }
    let kind = expected.get("type").and_then(Value::as_str)?;
    if !is_action_type(kind) {
        return None;
    }
    // `if (objectId)` is truthiness, so `''` falls through to `relation`.
    let object_id = match expected.get("objectId").and_then(Value::as_str) {
        Some(id) => Some(id),
        None => expected.get("aId").and_then(Value::as_str),
    };
    if let Some(object_id) = object_id.filter(|id| !id.is_empty()) {
        let object = js_get(&state["objects"], object_id);
        if js_get_truthy(&object) {
            // An `Object.prototype` member id renders as "undefined" here — a
            // client-visible string, which is why the prototype case matters.
            // Same helper `describe_targets` uses.
            let label = js_template(target_label(&object, spec).as_ref());
            return Some(format!("The program wanted {label}."));
        }
    }
    if let Some(relation) = expected.get("relation").and_then(Value::as_str) {
        let word = match relation {
            "lt" => vocab(spec, "lowerWord"),
            "eq" => vocab(spec, "equalWord"),
            "gt" => vocab(spec, "higherWord"),
            other => other,
        };
        return Some(format!("The program saw them as {word}."));
    }
    Some("The program wanted a different one.".into())
}

/// `a || b || c`, evaluated in order. JavaScript string falsiness is emptiness.
fn first_non_empty(candidates: &[Option<String>]) -> String {
    candidates
        .iter()
        .flatten()
        .find(|value| !value.is_empty())
        .cloned()
        .unwrap_or_default()
}

/// Explanatory feedback (`deriveFeedback`). The `teach` line is present on EVERY
/// verdict, including success, because "correct" alone teaches nothing.
///
/// The frameless case passes a `DsaOp` to `op_for_action_type`, which resolves
/// to `'read'` for all thirteen ops. See that function.
pub fn derive_feedback(
    state: &Value,
    outcome: &Value,
    frame: Option<&Value>,
    spec: &Value,
) -> Value {
    let frame_field = |key: &str| {
        frame
            .and_then(|f| f.get(key))
            .filter(|v| !v.is_null())
            .cloned()
    };
    let dsa_op = frame_field("dsaOp").unwrap_or_else(|| {
        json!(op_for_action_type(
            outcome["dsaOp"].as_str().unwrap_or_default()
        ))
    });
    let code_line = frame_field("codeLine").unwrap_or_else(|| json!(1));

    let mut text = frame_field("codeLineText")
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if text.is_empty() {
        text = code_line_text(state, &code_line);
    }

    let mut out = Map::new();
    if js_truthy(&outcome["illegal"]) {
        out.insert("verdict".into(), json!("illegal"));
        out.insert("headline".into(), json!("That one is not available yet."));
        out.insert(
            "teach".into(),
            json!(
                "The program has to do its steps in order, so this move does not apply right now."
            ),
        );
        out.insert(
            "nextStep".into(),
            json!("Follow the instruction at the top of the board."),
        );
        out.insert("codeLine".into(), code_line);
        out.insert("codeLineText".into(), json!(text));
        out.insert("didWhat".into(), json!("nothing yet"));
        return Value::Object(out);
    }

    let player_text = de_jargon(outcome["feedback"].as_str().unwrap_or_default(), Some(spec));
    if !js_truthy(&outcome["correct"]) {
        out.insert("verdict".into(), json!("wrong"));
        out.insert("headline".into(), json!(headline_for_wrong(&dsa_op, spec)));
        out.insert(
            "teach".into(),
            json!(first_non_empty(&[
                Some(player_text),
                operation_reason(&dsa_op).map(str::to_owned),
                Some("That was not the move the program wanted.".into()),
            ])),
        );
        // The key is always present in the object literal; `undefined` is what
        // `JSON.stringify` drops.
        let next_step = match js_truthy(&outcome["expected"]) {
            true => next_step_for_expected(&outcome["expected"], state, spec),
            false => None,
        };
        if let Some(next_step) = next_step {
            out.insert("nextStep".into(), json!(next_step));
        }
        out.insert("codeLine".into(), code_line);
        out.insert("codeLineText".into(), json!(text));
        out.insert("didWhat".into(), json!(operation_name(&dsa_op, spec)));
        out.insert(
            "encourage".into(),
            json!("Mistakes here are how the pattern shows up."),
        );
        return Value::Object(out);
    }

    out.insert("verdict".into(), json!("correct"));
    out.insert(
        "headline".into(),
        json!(headline_for_correct(&dsa_op, spec)),
    );
    // `frame.note` is the oracle's own trace annotation — "mid = 3",
    // "keep right, window [4, 7]" — which is exactly the notation a learner
    // should not be reading. `outcome.feedback` wins; the note is a last resort.
    // The `frame?.note` gate is TRUTHINESS, and `normalize_frame` produces `note:
    // ""` for every frame without one, so an empty note must skip `deJargon`.
    let note = frame
        .filter(|f| js_truthy(&f["note"]))
        .map(|f| de_jargon(f["note"].as_str().unwrap_or_default(), Some(spec)));
    out.insert(
        "teach".into(),
        json!(first_non_empty(&[
            Some(player_text),
            operation_reason(&dsa_op).map(str::to_owned),
            note,
            Some("That is the move.".into()),
        ])),
    );
    out.insert("codeLine".into(), code_line);
    out.insert("codeLineText".into(), json!(text));
    out.insert("didWhat".into(), json!(operation_name(&dsa_op, spec)));
    if let Some(encourage) = encourage_for(state) {
        out.insert("encourage".into(), json!(encourage));
    }
    Value::Object(out)
}

// ------------------------------------------------------------------ deJargon

/// JavaScript uses ASCII `\d`/`\b`/`\s` boundaries but its own Unicode
/// whitespace set: `\s` EXCLUDES `U+0085` and INCLUDES `U+FEFF`, which Rust's
/// `\p{White_Space}` does the opposite of. Copied verbatim from `hints.rs:7-11`;
// §7.4 of the plan defers promoting either copy into `compat.rs`.
fn js_regex(pattern: &str) -> Regex {
    Regex::new(&js_pattern(pattern)).expect("static JavaScript-compatible guidance pattern")
}

/// The ECMAScript `\s` set, as a group that keeps unicode mode ON.
///
/// NOT VALID INSIDE A CHARACTER CLASS. The class parser reads `(?u:` as the
/// literal characters `(`, `?`, `u` and `:` and the following `[` as a literal
/// `[`, so a class containing `\s` silently gains those four characters and ends
/// early. Rule 12 spells its class out instead, and
/// `no_pattern_substitutes_whitespace_inside_a_character_class` is the guard.
const JS_WHITESPACE: &str = r"(?u:[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}])";

fn js_pattern(pattern: &str) -> String {
    pattern.replace(r"\s", JS_WHITESPACE)
}

/// `firstSentence`'s `/^[^.!?]+[.!?]?/` (`guidance.ts:655`). Deliberately NOT
/// wrapped in `-u`: JavaScript's negated class matches any code unit, so `-u`
/// would truncate the goal at the first non-ASCII character — an em dash or an
/// accented word in an objective would be cut off.
fn first_sentence_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| js_regex(r"^[^.!?]+[.!?]?"))
}

/// `deJargon`'s nine unconditional rules, in source order. The order is
/// load-bearing: rule 5 must consume "the midpoint of [...]" before rule 6 can
/// match "midpoint of [...]", and rules 4-7 must run before rule 8 strips the
/// assignments out from under them.
fn jargon_rules() -> &'static [Regex; 9] {
    static RULES: OnceLock<[Regex; 9]> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            // Rules 4-8 carry `i`. `-u` makes `\b` and `\d` ASCII-only, as in
            // JavaScript, and disables Unicode case folding, which is what the
            // JavaScript `i` flag without `u` does.
            // The `(?:...)` wrappers are mandatory, not decoration: with `-u` a
            // NEGATED class becomes byte-oriented, so a bare `[^\]]` can match
            // invalid UTF-8 and `Regex::new` rejects the entire pattern with
            // "pattern can match invalid UTF-8". `(?:...)` restores unicode mode
            // for the negated classes only, leaving `\b`, `\d` and case folding
            // ASCII as JavaScript has them. `hints.rs` never needed this because
            // none of its patterns contains a negated class.
            js_regex(r"(?i-u:\bwindow\s*\[(?u:[^\]])*\])"),
            js_regex(r"(?i-u:\bthe midpoint of \[(?u:[^\]])*\])"),
            js_regex(r"(?i-u:\bmidpoint of \[(?u:[^\]])*\])"),
            js_regex(r"(?i-u:\bindex\s+(-?\d+)\b)"),
            js_regex(r"(?i-u:\b(lo|hi|mid|i|j)\s*=\s*-?\d+)"),
            // Rules 9-12 have no `i`.
            js_regex(r"(?-u:\[\s*-?\d+\s*,\s*-?\d+\s*\])"),
            js_regex(r"(?-u:\s{2,})"),
            js_regex(r"(?-u:\s+([.,;]))"),
            // Rule 12 carries no `i` and no `g`: anchored, first match only. It
            // spells its class out because `\s` inside a class cannot take the
            // `(?u:...)` substitution — see `js_pattern`.
            js_regex(r"^[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff},;.]+"),
        ]
    })
}

fn jargon_spec_rules() -> &'static [Regex; 3] {
    static RULES: OnceLock<[Regex; 3]> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            // Rule 1 has NO `i` flag (`guidance.ts:519`), so a quoted `"GT"` survives
            // untouched while rules 2-3 lowercase their capture before lookup.
            js_regex(r#"(?-u:"(lt|eq|gt)")"#),
            js_regex(r"(?i-u:\bthe relation is (lt|eq|gt)\b)"),
            js_regex(r"(?i-u:\b(lt|eq|gt) declared\b)"),
        ]
    })
}

/// Strip the notation an oracle might leak into player-facing text
/// (`guidance.ts:510-540`). `window [4, 7]`, `mid = 3`, `Index 3`, `lo=0 hi=7`
/// are the algorithm's internals, and the relation codes `lt / eq / gt` are raw
/// enum values that the theme's own words replace.
pub fn de_jargon(text: &str, spec: Option<&Value>) -> String {
    let mut out = text.to_owned();
    if let Some(spec) = spec {
        let word = |code: &str| -> String {
            match code {
                "lt" => vocab(spec, "lowerWord").to_owned(),
                "eq" => vocab(spec, "equalWord").to_owned(),
                "gt" => vocab(spec, "higherWord").to_owned(),
                other => other.to_owned(),
            }
        };
        let rules = jargon_spec_rules();
        out = rules[0]
            .replace_all(&out, |c: &regex::Captures<'_>| {
                format!("\"{}\"", word(&c[1]))
            })
            .into_owned();
        out = rules[1]
            .replace_all(&out, |c: &regex::Captures<'_>| {
                format!("it is {}", word(&c[1].to_lowercase()))
            })
            .into_owned();
        // Consumes the trailing "declared", so "gt declared, lt is the truth"
        // becomes "stronger declared, lt is the truth" — asymmetric, and
        // produced live by `binary-search.ts:1007`.
        out = rules[2]
            .replace_all(&out, |c: &regex::Captures<'_>| {
                format!("{} declared", word(&c[1].to_lowercase()))
            })
            .into_owned();
    }
    let rules = jargon_rules();
    out = rules[0]
        .replace_all(&out, "the rest of the board")
        .into_owned();
    out = rules[1]
        .replace_all(&out, "the middle of what is left")
        .into_owned();
    out = rules[2]
        .replace_all(&out, "the middle of what is left")
        .into_owned();
    // `$1` in a literal replacement would parse `$1` followed by a digit as
    // `$10`, so the capture goes through a closure: `&c[1]` is byte-identical to
    // JavaScript's `$1`.
    out = rules[3]
        .replace_all(&out, |c: &regex::Captures<'_>| {
            format!("position {}", &c[1])
        })
        .into_owned();
    out = rules[4].replace_all(&out, "").into_owned();
    out = rules[5].replace_all(&out, "what is left").into_owned();
    out = rules[6].replace_all(&out, " ").into_owned();
    out = rules[7]
        .replace_all(&out, |c: &regex::Captures<'_>| c[1].to_string())
        .into_owned();
    // Rule 12 has NO `g` flag, so it replaces the FIRST match only. `Regex::replace`
    // is first-match-only and `replace_all` is the `g`-flag equivalent; using the
    // wrong one here silently strips every leading comma in the string.
    out = rules[8].replace(&out, "").into_owned();
    crate::compat::trim(&out).to_owned()
}

// -------------------------------------------------------------------- helpers

/// `firstSentence` (`guidance.ts:654-657`): `value.match(/^[^.!?]+[.!?]?/)`, then
/// `(match?.[0] ?? value).trim()`. The `?? value` arm is what makes an empty or
/// punctuation-only objective fall through to `actionVerb` at the call site.
fn first_sentence(value: &str) -> String {
    crate::compat::trim(
        first_sentence_regex()
            .find(value)
            .map_or(value, |matched| matched.as_str()),
    )
    .to_owned()
}

/// `capitalise` (`guidance.ts:648-652`).
///
/// Node indexes **UTF-16 code units**: `trimmed[0]`, then `trimmed.slice(1)`. For
/// an astral first character `trimmed[0]` is a LONE HIGH SURROGATE, and no
/// surrogate has a Unicode case mapping, so its `toUpperCase()` is itself;
/// `slice(1)` then drops the high surrogate and keeps the low one, and the
/// concatenation reproduces the original astral character. So Node returns an
/// astral first character **unchanged**.
///
/// `chars().next()` returns the whole code point and *would* uppercase it, which
/// diverges for all 307 astral code points that have a case mapping (Deseret
/// U+10428..U+1044D, Adlam, Osage, Warang Citi and so on: U+10428 uppercases to
/// U+10400 in Rust, and Node leaves U+10428 alone). So the astral case has to be
/// short-circuited explicitly.
///
/// `'ß'` is BMP and uppercases to `'SS'` on both sides, via `to_uppercase()`'s
/// multi-character mapping.
fn capitalise(value: &str) -> String {
    let trimmed = crate::compat::trim(value);
    let mut chars = trimmed.chars();
    match chars.next() {
        None => "Do".into(),
        // `len_utf16() == 2` means Node would have taken a lone high surrogate
        // here, whose `toUpperCase()` is identity. Uppercasing it would be wrong.
        Some(first) if first.len_utf16() == 2 => trimmed.to_owned(),
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every pattern `de_jargon` and `first_sentence` compile, with the flag set
    /// JavaScript uses for that rule. `-u` disables Unicode case folding and
    /// makes the perl classes ASCII, so each rule must carry the flags that
    /// reproduce the JavaScript flag set — and `first_sentence` must carry
    /// NEITHER `i` nor `-u`.
    const PATTERNS: [&str; 13] = [
        r#"(?-u:"(lt|eq|gt)")"#,
        r"(?i-u:\bthe relation is (lt|eq|gt)\b)",
        r"(?i-u:\b(lt|eq|gt) declared\b)",
        r"(?i-u:\bwindow\s*\[(?u:[^\]])*\])",
        r"(?i-u:\bthe midpoint of \[(?u:[^\]])*\])",
        r"(?i-u:\bmidpoint of \[(?u:[^\]])*\])",
        r"(?i-u:\bindex\s+(-?\d+)\b)",
        r"(?i-u:\b(lo|hi|mid|i|j)\s*=\s*-?\d+)",
        r"(?-u:\[\s*-?\d+\s*,\s*-?\d+\s*\])",
        r"(?-u:\s{2,})",
        r"(?-u:\s+([.,;]))",
        r"^[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff},;.]+",
        r"^[^.!?]+[.!?]?",
    ];

    #[test]
    fn js_regex_substitutes_the_javascript_whitespace_set() {
        // U+0085 is NOT JavaScript `\s`; U+FEFF IS.
        let re = js_regex(r"(?-u:a\sb)");
        assert!(re.is_match("a\u{feff}b"));
        assert!(!re.is_match("a\u{0085}b"));
        assert!(re.is_match("a\u{00a0}b"));
        assert!(re.is_match("a\u{3000}b"));
    }

    #[test]
    fn no_pattern_contains_an_escaped_backslash_or_a_bare_dot() {
        for pattern in PATTERNS {
            // `js_regex` substitutes `\s` TEXTUALLY, so a literal escaped
            // backslash in a pattern would be rewritten by a rule that cannot
            // mean it. No pattern needs one.
            assert!(
                !pattern.contains(r"\\"),
                "pattern {pattern:?} contains an escaped backslash"
            );
            // A bare `.` diverges in the OPPOSITE direction from the obvious
            // reading. JavaScript's `.` (no `s` flag) excludes LF, CR, U+2028 and
            // U+2029 — four characters. Rust's `.` excludes ONLY LF, so it MATCHES
            // CR, U+2028 and U+2029 where JavaScript does not. A pattern relying
            // on `.` would therefore match across a line separator in Rust and
            // stop at it in Node. No `deJargon` rule needs one, so they are
            // banned outside a character class and the guard below fails loudly
            // if a future rule adds one.
            let mut in_class = false;
            for c in pattern.chars() {
                match c {
                    '[' => in_class = true,
                    ']' => in_class = false,
                    '.' => assert!(in_class, "pattern {pattern:?} has a bare dot"),
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn no_pattern_substitutes_whitespace_inside_a_character_class() {
        for pattern in PATTERNS {
            // `js_pattern` injects a `(?u:...)` group. Inside a character class
            // that is not a group: the parser takes `(`, `?`, `u` and `:` as
            // literals and the `[` as a literal `[`, so the class silently gains
            // those four characters and ends early.
            let mut in_class = false;
            let mut escaped = false;
            for c in pattern.chars() {
                if escaped {
                    escaped = false;
                    continue;
                }
                match c {
                    '\\' => escaped = true,
                    '[' => in_class = true,
                    ']' => in_class = false,
                    's' if in_class => {
                        panic!("pattern {pattern:?} puts a class escape inside a class")
                    }
                    _ => {}
                }
            }
        }
        // And the substitution is still applied outside classes.
        assert!(js_pattern(r"(?-u:a\sb)").contains("(?u:["));
    }

    #[test]
    fn capitalise_passes_astral_cased_letters_through_unchanged() {
        // Node takes `trimmed[0]`, the first UTF-16 CODE UNIT. For an astral
        // character that is a lone high surrogate, which has no Unicode case
        // mapping, so `toUpperCase()` is identity and `slice(1)` puts the low
        // surrogate back: the string comes out unchanged. `chars().next()` hands
        // back the whole code point, and `to_uppercase()` WOULD fold it. All 307
        // astral code points with a case mapping diverge if the short-circuit is
        // removed; these are the first of them (Deseret, Adlam, Osage,
        // Warang Citi, Medefaidrin, ...).
        for (astral, folded) in [
            ('\u{10428}', '\u{10400}'), // DESERET CAPITAL LETTER LONG I
            ('\u{10429}', '\u{10401}'),
            ('\u{1042a}', '\u{10402}'),
            // Adlam: capital forms map down into the lowercase block.
            ('\u{1e900}', '\u{1e922}'),
            // Osage.
            ('\u{104b0}', '\u{104ae}'),
        ] {
            let input = format!("{astral}a rest");
            assert_eq!(
                capitalise(&input),
                input,
                "astral {astral:?} must pass through unchanged, not become {folded:?}"
            );
        }
        // A BMP cased letter still uppercases, and the multi-char mapping still
        // applies.
        assert_eq!(capitalise("check"), "Check");
        assert_eq!(capitalise("\u{df}eta"), "SSeta");
        // The short-circuit only applies to the FIRST character.
        assert_eq!(capitalise("x\u{10428}"), "X\u{10428}");
    }

    #[test]
    fn describe_targets_renders_an_absent_label_as_undefined() {
        // `toTarget` omits `label` for an `Object.prototype` member id, and
        // `${targets[0]!.label}` renders the resulting `undefined` as the literal
        // string "undefined" — not "null".
        let spec = json!({"vocabulary": {
            "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        let missing =
            vec![json!({"id": "constructor", "hint": "pick this one", "role": "candidate"})];
        assert_eq!(describe_targets(&missing, &spec), "undefined");
        assert_eq!(
            describe_targets(&[missing[0].clone(), missing[0].clone()], &spec),
            "undefined and undefined"
        );
        // Three or more uses the plural noun, so the labels are not read at all.
        let three = vec![missing[0].clone(), missing[0].clone(), missing[0].clone()];
        assert_eq!(describe_targets(&three, &spec), "one of the beacons");
        // A present label is unaffected.
        assert_eq!(
            describe_targets(&[json!({"id": "v0", "label": "beacon 25"})], &spec),
            "beacon 25"
        );
        assert_eq!(describe_targets(&[], &spec), "the board");
    }

    #[test]
    fn derive_nudge_uses_truthiness_not_an_equality_check() {
        // Node's predicate is `recent.every((f) => !f.correct)`, so a TRUTHY
        // non-boolean `correct` clears the streak. `{correct: 1}` and
        // `{correct: 'x'}` are truthy; `{correct: 0}` and `{correct: ''}` are not.
        let nudge = |frames: Value, mistakes: u64| {
            derive_nudge(&json!({
                "trace": frames,
                "progress": {"steps": 9, "mistakes": mistakes},
            }))
        };
        assert!(nudge(json!([{"correct": true}, {"correct": true}]), 9).is_null());
        assert!(nudge(json!([{"correct": 1}, {"correct": ""}]), 9).is_null());
        assert!(nudge(json!([{"correct": "x"}, {"correct": "y"}]), 9).is_null());
        assert!(nudge(json!([{"correct": {}}, {"correct": []}]), 9).is_null());
        assert_eq!(
            nudge(json!([{"correct": false}, {"correct": false}]), 9)["tone"],
            json!("urgent")
        );
        assert_eq!(
            nudge(json!([{"correct": 0}, {"correct": 0}]), 9)["tone"],
            json!("urgent")
        );
        assert_eq!(
            nudge(json!([{"correct": ""}, {"correct": ""}]), 9)["tone"],
            json!("urgent")
        );
        assert_eq!(
            nudge(json!([{"correct": null}, {"correct": null}]), 2)["tone"],
            json!("gentle")
        );
        // A frame with no `correct` key reads as `undefined`, which is falsy.
        assert_eq!(nudge(json!([{}, {}]), 2)["tone"], json!("gentle"));
    }

    #[test]
    fn a_falsy_expected_action_takes_the_spec_derived_mechanic() {
        // `legal[0]` can be `null`, `undefined`, `0` or `''`. Node's
        // `expected ? mechanicForType(expected.type) ?? 'selectObject'
        // : fallbackMechanic(spec, dsaOp)` takes the SECOND arm for all of them,
        // which is not the same as `selectObject`. A spec whose only mechanic is
        // bound to `move` separates the two arms.
        let spec = json!({
            "objective": "Find it.",
            "vocabulary": {
                "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
                "actionVerb": "check", "target": "wanted beacon",
                "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
            },
            "mechanics": [{"id": "moveObject", "boundDsaOp": "move", "label": ""}],
        });
        let dsa_op = json!("move");
        // A falsy descriptor is discarded by the single truthiness filter, so all
        // three selectors see the same thing Node sees.
        for falsy in [
            Value::Null,
            json!(""),
            json!(0),
            json!(false),
            Value::Number(0u64.into()),
        ] {
            assert_eq!(
                truthy_expected(Some(falsy.clone())),
                None,
                "{falsy} is falsy"
            );
            assert_eq!(
                select_mechanic(
                    truthy_expected(Some(falsy.clone())).as_ref(),
                    &spec,
                    &dsa_op
                ),
                "moveObject",
                "{falsy} must take fallbackMechanic, not selectObject"
            );
        }
        assert_eq!(
            truthy_expected(Some(json!({"type": "selectObject"}))),
            Some(json!({"type": "selectObject"}))
        );
        assert_eq!(
            select_mechanic(Some(&json!({"type": "comparePair"})), &spec, &dsa_op),
            "comparePair"
        );
        // The selectors apply the truthiness filter THEMSELVES, so they are correct
        // for any `Option` a caller hands them — including an unfiltered one. This
        // is what makes the fix hold at the call site: `derive_turn_prompt` passes
        // the raw `expected_action` result straight in.
        let empty = json!({"trace": [], "progress": {"mistakes": 0}});
        // Only the values a LEGAL DESCRIPTOR can actually take: an array or object
        // is truthy in JavaScript, so `legal[0]` being one of those is a different
        // situation (Node would read `.type` off it) and is covered separately.
        for falsy in [Value::Null, json!(""), json!(0), json!(false)] {
            assert_eq!(
                select_mechanic(Some(&falsy), &spec, &dsa_op),
                "moveObject",
                "{falsy} must take fallbackMechanic, not selectObject"
            );
            // And with no `expected` at all, `fallbackOp` finds the first unused
            // mechanic's op, which here is the only mechanic's `move`.
            assert_eq!(
                select_dsa_op(Some(&falsy), &empty, &spec),
                json!("move"),
                "{falsy} must take fallbackOp"
            );
        }
        // A real descriptor is untouched: `expected.dsaOp` still wins even when it
        // is not a valid DsaOp, and is then used as a raw map key.
        assert_eq!(
            select_dsa_op(
                Some(&json!({"type": "selectObject", "dsaOp": "not-an-op"})),
                &empty,
                &spec
            ),
            json!("not-an-op")
        );
        assert_eq!(
            select_dsa_op(Some(&json!({"type": "comparePair"})), &empty, &spec),
            json!("compare")
        );
        // An object with an unrecognised type yields `selectObject`, NOT the
        // spec-derived mechanic.
        assert_eq!(
            select_mechanic(Some(&json!({"type": "nope"})), &spec, &dsa_op),
            "selectObject"
        );
        assert_eq!(select_mechanic(None, &spec, &dsa_op), "moveObject");
    }

    #[test]
    fn a_numeric_lo_is_not_a_number_lo() {
        // `buildIndicator`'s guard is Node's `typeof lo !== 'number'`, not
        // JavaScript numeric coercion: a numeric STRING is not a number, so it
        // short-circuits the window filter and every object stays live.
        for (value, is_number) in [
            (json!(0), true),
            (json!(3.5), true),
            (json!(-1), true),
            (json!("3"), false),
            (json!(""), false),
            (json!(true), false),
            (json!(null), false),
            (json!([]), false),
            (json!({}), false),
        ] {
            assert_eq!(js_number(&value).is_some(), is_number, "{value}");
        }
        let spec = json!({"vocabulary": {
            "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        let board = |lo: Value| {
            build_indicator(
                &json!({
                    "problemId": "rotated-search",
                    "variables": {"lo": lo, "hi": 1},
                    "slots": {"s0": {"id": "s0", "index": 0}, "s1": {"id": "s1", "index": 1}},
                    "objects": {
                        "v0": {"id": "v0", "kind": "number", "value": 1, "slotId": "s0"},
                        "v1": {"id": "v1", "kind": "number", "value": 2, "slotId": "s1"},
                    },
                }),
                &spec,
            )
        };
        // A numeric `lo` narrows the window; a numeric STRING does not, which is
        // exactly Node's `typeof` short-circuit.
        assert_eq!(board(json!(1))["detail"], json!("1 of 2 beacons left"));
        assert_eq!(board(json!("1"))["detail"], json!("2 of 2 beacons left"));
        assert_eq!(board(json!(null))["detail"], json!("2 of 2 beacons left"));
    }

    #[test]
    fn optional_key_presence_follows_array_truthiness() {
        // `assignmentTargetIds` is gated on ARRAY TRUTHINESS, so `[]` emits the
        // key present-and-empty; no registered oracle produces it, so this is the
        // only Rust-side guard for the plan's top risk.
        let expected = |target_ids: Value| json!({"type": "assignValue", "options": {"targetIds": target_ids}});
        // `[]` is truthy: the key IS emitted, empty.
        assert_eq!(
            assignment_target_ids(Some(&expected(json!([]))), "assignValue"),
            Some(json!([])),
            "an empty array is truthy and must be emitted"
        );
        assert_eq!(
            assignment_target_ids(Some(&expected(json!(["dp_0"]))), "assignValue"),
            Some(json!(["dp_0"]))
        );
        // `undefined`/`null` are falsy: the key is ABSENT.
        assert_eq!(
            assignment_target_ids(Some(&expected(Value::Null)), "assignValue"),
            None
        );
        assert_eq!(
            assignment_target_ids(Some(&json!({"type": "assignValue"})), "assignValue"),
            None
        );
        assert_eq!(
            assignment_target_ids(Some(&expected(json!([]))), "submitAnswer"),
            None
        );
        assert_eq!(assignment_target_ids(None, "assignValue"), None);

        // `answerTargetId` uses `??`: always present on a submitAnswer turn, with
        // `''` kept and a JSON null falling back to `'answer'`.
        let submit =
            |first: Value| json!({"type": "submitAnswer", "options": {"objectIds": [first]}});
        assert_eq!(
            answer_target_id(Some(&submit(json!("v2"))), "submitAnswer"),
            Some(json!("v2"))
        );
        assert_eq!(
            answer_target_id(Some(&submit(json!(""))), "submitAnswer"),
            Some(json!("")),
            "an empty string is not nullish and must be emitted as \"\""
        );
        assert_eq!(
            answer_target_id(Some(&submit(Value::Null)), "submitAnswer"),
            Some(json!("answer"))
        );
        assert_eq!(
            answer_target_id(Some(&json!({"type": "submitAnswer"})), "submitAnswer"),
            Some(json!("answer"))
        );
        assert_eq!(
            answer_target_id(None, "submitAnswer"),
            Some(json!("answer"))
        );
        assert_eq!(
            answer_target_id(Some(&submit(json!("v2"))), "assignValue"),
            None
        );
        // An array holding only null still takes element 0, which is nullish.
        assert_eq!(
            answer_target_id(
                Some(&json!({"type": "submitAnswer", "options": {"objectIds": [null]}})),
                "submitAnswer"
            ),
            Some(json!("answer"))
        );
    }

    #[test]
    fn de_jargon_keeps_a_leading_open_bracket() {
        // Regression: `js_pattern`'s `(?u:...)` cannot be substituted inside a
        // character class, so rule 12 once read `[\s,;.]` as a class containing
        // the literal characters `(`, `?`, `u` and `:`. Every rule-12 text starting
        // with `(` lost it, silently and everywhere.
        assert_eq!(de_jargon("( goes", None), "( goes");
        assert_eq!(
            de_jargon("( goes onto the top of the stack.", None),
            "( goes onto the top of the stack."
        );
        // A real oracle trace note that starts with a bracket.
        assert_eq!(de_jargon("Push (.", None), "Push (.");
        // Rule 12 still strips the characters it is supposed to.
        assert_eq!(de_jargon("... .kept", None), "kept");
    }

    #[test]
    fn branch_targets_falls_back_to_the_last_object_in_iteration_order() {
        // Risk 2 from the plan: sorting `live` instead of the filtered copy
        // silently changes `live[live.length - 1]`. The swept corpus almost never
        // reaches the fallback — the `higher` filter nearly always finds
        // something — so this pins it directly. `v0` holds the largest value and
        // is the cursor object, so `higher` is empty; the fallback must be the
        // LAST object in `Object.values` order (`v2`), not the largest (`v0`).
        let state = json!({
            "objects": {
                "v0": {"id": "v0", "kind": "number", "value": 30},
                "v1": {"id": "v1", "kind": "number", "value": 10},
                "v2": {"id": "v2", "kind": "number", "value": 20},
            },
            "cursor": {"bestObjectId": "v0"},
        });
        let spec = json!({"vocabulary": {
            "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        let targets = branch_targets(&state, &spec);
        assert_eq!(targets[0]["id"], json!("v0"));
        assert_eq!(targets[0]["role"], json!("current"));
        assert_eq!(
            targets[1]["id"],
            json!("v2"),
            "fallback must be live[live.length-1]"
        );
        assert_eq!(targets[1]["role"], json!("candidate"));
        assert_eq!(targets[1]["label"], json!("stronger than beacon 30"));

        // Now the `higher` branch: the SMALLEST strictly greater live value, even
        // though the name says otherwise.
        let state = json!({
            "objects": {
                "v0": {"id": "v0", "kind": "number", "value": 10},
                "v1": {"id": "v1", "kind": "number", "value": 30},
                "v2": {"id": "v2", "kind": "number", "value": 20},
            },
            "cursor": {"bestObjectId": "v0"},
        });
        let targets = branch_targets(&state, &spec);
        assert_eq!(
            targets[1]["id"],
            json!("v2"),
            "the smallest strictly greater"
        );
    }

    #[test]
    fn build_indicator_keeps_the_window_and_the_empty_branch_distinct() {
        let spec = json!({"vocabulary": {
            "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        // `objects: {}` takes the `all.length === 0` branch: a bare place, and the
        // literal detail. Progress is the INTEGER 1, so it serialises as `1`.
        let empty = build_indicator(&json!({"objects": {}}), &spec);
        assert_eq!(
            empty.to_string(),
            r#"{"label":"beacon row","progress":1,"detail":"nothing left"}"#
        );
        // A `target`-kind object never counts towards `all`.
        let only_target = build_indicator(
            &json!({"objects": {"target": {"id": "target", "kind": "target", "value": 1}}}),
            &spec,
        );
        assert_eq!(only_target.to_string(), empty.to_string());
        // `matched` objects leave `live`; the singular noun appears at `all === 1`.
        let one = build_indicator(
            &json!({"objects": {"v0": {"id": "v0", "kind": "number", "value": 1}}}),
            &spec,
        );
        assert_eq!(one["detail"], json!("1 of 1 beacon left"));
        // `rotated-search` drops an object whose `slotId` is empty, because
        // `o.slotId &&` is truthiness.
        let rotated = build_indicator(
            &json!({
                "problemId": "rotated-search",
                "variables": {"lo": 0, "hi": 1},
                "slots": {"s0": {"id": "s0", "index": 0}, "s1": {"id": "s1", "index": 1}},
                "objects": {
                    "v0": {"id": "v0", "kind": "number", "value": 1, "slotId": "s0"},
                    "v1": {"id": "v1", "kind": "number", "value": 2, "slotId": "s1"},
                    "v2": {"id": "v2", "kind": "number", "value": 3, "slotId": ""},
                },
            }),
            &spec,
        );
        assert_eq!(rotated["detail"], json!("2 of 3 beacons left"));
    }

    #[test]
    fn derive_nudge_needs_consecutive_wrong_moves_not_just_a_counter() {
        // An empty trace never nudges, however doctored the counter is.
        let empty = json!({"trace": [], "progress": {"steps": 9, "mistakes": 9}});
        assert!(derive_nudge(&empty).is_null());
        // Two consecutive wrong frames at `mistakes >= 2` take the "Two in a row" arm,
        // because the two conditions are tested in that order.
        let wrong = json!({
            "trace": [{"correct": false}, {"correct": false}],
            "progress": {"steps": 2, "mistakes": 2},
        });
        assert_eq!(derive_nudge(&wrong)["tone"], json!("gentle"));
        assert_eq!(
            derive_nudge(&wrong)["message"],
            json!("Two in a row. Look at the one marked as the middle, and compare just that one.")
        );
        // With a doctored counter below 2 the plain arm is reached instead. A
        // consistent engine never gets here, which is why the corpus cannot.
        let plain = json!({
            "trace": [{"correct": false}, {"correct": false}],
            "progress": {"steps": 2, "mistakes": 1},
        });
        assert_eq!(
            derive_nudge(&plain)["message"],
            json!("Not this time. Try the highlighted one.")
        );
        // Four mistakes escalate to urgent.
        let urgent = json!({
            "trace": [{"correct": false}, {"correct": false}],
            "progress": {"steps": 4, "mistakes": 4},
        });
        assert_eq!(derive_nudge(&urgent)["tone"], json!("urgent"));
        // A correct frame anywhere in the window clears it.
        let mixed = json!({
            "trace": [{"correct": false}, {"correct": true}],
            "progress": {"steps": 4, "mistakes": 4},
        });
        assert!(derive_nudge(&mixed).is_null());
    }

    #[test]
    fn every_pattern_compiles() {
        // A negated class under `-u` is rejected outright with "pattern can
        // match invalid UTF-8", so forcing the lazy tables is a build-time canary
        // for the wrappers in `PATTERNS` as much as a regression guard.
        assert_eq!(jargon_rules().len(), 9);
        assert_eq!(jargon_spec_rules().len(), 3);
        assert!(first_sentence_regex().is_match("a."));
        for pattern in PATTERNS {
            js_regex(pattern);
        }
        // The audit table must BE the compiled patterns. Without this the table
        // can drift away from the code and the audits above pass while the live
        // patterns are wrong — which is exactly how a `(?u:...)` wrapper or a
        // flag set can be dropped without any test noticing.
        let live: Vec<String> = jargon_spec_rules()
            .iter()
            .map(|r| r.as_str().to_owned())
            .chain(jargon_rules().iter().map(|r| r.as_str().to_owned()))
            .chain(std::iter::once(first_sentence_regex().as_str().to_owned()))
            .collect();
        assert_eq!(live.len(), PATTERNS.len());
        for (index, (compiled, audited)) in live.iter().zip(PATTERNS).enumerate() {
            assert_eq!(
                compiled,
                &js_pattern(audited),
                "PATTERNS[{index}] no longer matches the compiled pattern"
            );
        }
        // Rules 4-6 must keep their `(?u:...)` around the negated class.
        for pattern in &PATTERNS[3..6] {
            assert!(
                pattern.contains(r"(?u:[^\]])"),
                "{pattern:?} lost its negated-class wrapper"
            );
        }
    }

    #[test]
    fn the_first_sentence_pattern_carries_no_flags() {
        // `-u` would make `[^.!?]` ASCII-only and truncate an objective at the
        // first em dash or accented character.
        let re = first_sentence_regex();
        assert!(re.is_match("\u{2014} dash"));
        assert!(!first_sentence_regex().as_str().contains("-u"));
        assert!(!first_sentence_regex().as_str().contains("(?i"));
    }

    #[test]
    fn js_truthy_matches_ecmascript() {
        for value in [json!(null), json!(false), json!(0), json!("")] {
            assert!(!js_truthy(&value), "{value} should be falsy");
        }
        // Arrays and objects are ALWAYS truthy, including empty ones.
        for value in [json!([]), json!({}), json!(1), json!(" "), json!(-1.0)] {
            assert!(js_truthy(&value), "{value} should be truthy");
        }
    }

    #[test]
    fn js_index_rejects_everything_but_a_positive_integer() {
        assert_eq!(js_index(1.0), Some(0));
        assert_eq!(js_index(4.0), Some(3));
        assert_eq!(js_index(0.0), None);
        assert_eq!(js_index(-1.0), None);
        assert_eq!(js_index(1.5), None);
        assert_eq!(js_index(f64::NAN), None);
        assert_eq!(js_index(f64::INFINITY), None);
    }

    #[test]
    fn capitalise_preserves_the_javascript_string_semantics() {
        assert_eq!(capitalise(""), "Do");
        assert_eq!(capitalise("check"), "Check");
        assert_eq!(capitalise("  check"), "Check");
        // `'ß'.toUpperCase()` is `'SS'` in both languages.
        assert_eq!(capitalise("\u{df}eta"), "SSeta");
        // An astral first character with NO case mapping passes through on both
        // sides: U+1D518 MATHEMATICAL BOLD FRAKTUR CAPITAL U maps to itself, so
        // this case cannot fail and is kept only as a regression anchor.
        assert_eq!(capitalise("\u{1d518}nicode rest"), "\u{1d518}nicode rest");
        // U+FEFF is ECMAScript whitespace, so it is trimmed; U+0085 is not, so it
        // survives, becomes the first character, and uppercases to itself.
        assert_eq!(capitalise("\u{feff}check"), "Check");
        assert_eq!(capitalise("\u{0085}check"), "\u{0085}check");
        assert_eq!(capitalise("\u{00a0}check"), "Check");
    }

    #[test]
    fn js_min_and_max_propagate_nan() {
        // `Math.min(1, NaN)` is NaN; `f64::min` returns the non-NaN operand.
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert!(js_max(0.0, f64::NAN).is_nan());
        assert_eq!(js_min(1.0, 0.5), 0.5);
        assert_eq!(js_max(0.0, 1.0), 1.0);
        assert_eq!(js_min(-0.0, 0.0), -0.0);
        assert_eq!(js_max(0.0, 0.0), 0.0);
        // A NaN comparison sorts as 0 in JavaScript, so it must not panic.
        assert_eq!(js_cmp(f64::NAN, 1.0), std::cmp::Ordering::Equal);
    }

    #[test]
    fn first_sentence_keeps_non_ascii_objectives_whole() {
        // Without `-u`, a negated class matches any code point, so an em dash
        // does not truncate the goal.
        assert_eq!(
            first_sentence("Find it — then stop."),
            "Find it — then stop."
        );
        assert_eq!(first_sentence("Über all. Then stop."), "Über all.");
        assert_eq!(first_sentence("  spaced out. "), "spaced out.");
        assert_eq!(first_sentence("no terminator"), "no terminator");
        assert_eq!(first_sentence(""), "");
        assert_eq!(first_sentence("."), ".");
    }

    #[test]
    fn prototype_members_are_truthy_but_fieldless() {
        let objects = json!({"v0": {"id": "v0", "value": 3}});
        // A real hit.
        let real = js_get(&objects, "v0");
        assert!(js_get_truthy(&real));
        assert_eq!(member(&real, "value").and_then(Value::as_f64), Some(3.0));
        // A plain miss.
        assert!(!js_get_truthy(&js_get(&objects, "nope")));
        // Every `Object.prototype` member: truthy, no fields.
        for name in PROTOTYPE_MEMBERS {
            let slot = js_get(&objects, name);
            assert!(js_get_truthy(&slot), "{name} should be truthy");
            assert!(member(&slot, "kind").is_none());
            assert!(member(&slot, "value").is_none());
            assert!(member(&slot, "label").is_none());
        }
        // A JSON `null` is falsy in JavaScript.
        let nulled = json!({"v0": null});
        assert!(!js_get_truthy(&js_get(&nulled, "v0")));
    }

    #[test]
    fn prototype_member_targets_drop_the_label_key() {
        let state = json!({"objects": {}});
        let spec = json!({"vocabulary": {
            "object": "beacon", "objectPlural": "beacons", "place": "row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        let target = to_target(&state, &spec, "constructor", "candidate").expect("prototype hit");
        // `label` is `undefined`, so `JSON.stringify` drops it and the key order
        // becomes id, hint, role.
        assert_eq!(
            target.to_string(),
            r#"{"id":"constructor","hint":"pick this one","role":"candidate"}"#
        );
    }

    #[test]
    fn unknown_mechanics_substitute_instead_of_panicking() {
        // D3: Node throws `TypeError: build is not a function`.
        assert_eq!(
            mechanic_instruction("banana", "Check", "beacon 25"),
            "Check beacon 25."
        );
        assert_eq!(
            mechanic_instruction("selectObject", "Check", "beacon 25"),
            "Check beacon 25."
        );
    }

    #[test]
    fn op_for_action_type_rejects_every_dsa_op() {
        // The `deriveFeedback` asymmetry: a `DsaOp` never resolves.
        for op in [
            "read",
            "compare",
            "choose-path",
            "move",
            "insert",
            "swap",
            "push",
            "pop",
            "traverse",
            "link",
            "assign",
            "terminate",
            "unlink",
        ] {
            assert_eq!(
                op_for_action_type(op),
                "read",
                "{op} should resolve to read"
            );
        }
        // An action type still resolves, so a malformed `outcome.dsaOp` that
        // happens to be one does the right thing.
        assert_eq!(op_for_action_type("comparePair"), "compare");
        assert_eq!(op_for_action_type("submitAnswer"), "terminate");
    }

    /// A board whose legal-action list is empty. An unregistered `problemId`
    /// alone is NOT enough: `oracle_plan::legal` falls through to the planned
    /// branch, `plan_index` defaults to 0 and `plan.get(0)` succeeds. The index
    /// has to be past the end of the plan as well.
    fn no_legal_actions() -> Value {
        let mut state = crate::runtime::init("binary-search", 31337.0, "easy").unwrap();
        state["problemId"] = json!("guidance-probe");
        state["internal"]["planIndex"] = json!(1_000_000);
        assert!(crate::oracle_plan::legal(&state)
            .as_array()
            .unwrap()
            .is_empty());
        state
    }

    fn vocabulary() -> Value {
        json!({
            "object": "beacon", "objectPlural": "beacons", "place": "beacon row",
            "actionVerb": "check", "target": "wanted beacon",
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        })
    }

    #[test]
    fn optional_keys_follow_javascripts_nullish_versus_truthy_rules() {
        let state = no_legal_actions();
        let assign = json!({
            "objective": "Find it.",
            "vocabulary": vocabulary(),
            "mechanics": [{"id": "assignValue", "boundDsaOp": "read", "label": ""}],
        });
        let prompt = derive_turn_prompt(&state, &assign);
        // No `expected`, so `expected?.options?.targetIds` is `undefined` and the
        // key is ABSENT. A stub oracle that returned `targetIds: []` would emit the
        // key present-and-empty instead, because `[]` is truthy; that arm has no
        // oracle-injection seam in Rust and is covered from `Node` instead.
        assert!(prompt.get("assignmentTargetIds").is_none());
        assert_eq!(prompt["dsaOp"], json!("read"));

        let submit = json!({
            "objective": "Find it.",
            "vocabulary": vocabulary(),
            "mechanics": [{"id": "submitAnswer", "boundDsaOp": "terminate", "label": ""}],
        });
        let prompt = derive_turn_prompt(&state, &submit);
        // `??` rather than `||`, so the key IS present with the fallback value. A
        // stub returning `objectIds: ['']` emits `""` instead — the same `??`
        // operator, a different arm.
        assert_eq!(prompt["answerTargetId"], json!("answer"));
        assert!(prompt.get("assignmentTargetIds").is_none());
    }

    #[test]
    fn an_unregistered_problem_id_alone_still_offers_a_legal_action() {
        // Guards the correction in `expected_action`: without the out-of-range
        // `planIndex` the state is NOT the "no legal actions" state.
        let mut state = crate::runtime::init("binary-search", 31337.0, "easy").unwrap();
        state["problemId"] = json!("guidance-probe");
        assert!(!crate::oracle_plan::legal(&state)
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn de_jargon_keeps_the_rule_order_and_the_missing_i_flag() {
        let spec = json!({"vocabulary": {
            "lowerWord": "weaker", "equalWord": "matching", "higherWord": "stronger",
        }});
        // Rule 1 has no `i`, so quoted "GT" survives; rules 2-3 have `i`.
        assert_eq!(de_jargon("\"gt\"", Some(&spec)), "\"stronger\"");
        assert_eq!(de_jargon("\"GT\"", Some(&spec)), "\"GT\"");
        assert_eq!(de_jargon("\"GT\"", None), "\"GT\"");
        // Rule 2 emits a single literal space and lowercases its capture.
        assert_eq!(
            de_jargon("the relation is \"gt\"", Some(&spec)),
            "the relation is \"stronger\""
        );
        assert_eq!(
            de_jargon("the relation is gt", Some(&spec)),
            "it is stronger"
        );
        // Rule 3 consumes the trailing "declared" and leaves the rest alone.
        assert_eq!(
            de_jargon("gt declared, lt is the truth", Some(&spec)),
            "stronger declared, lt is the truth"
        );
        // Rule 12 has no `g`: it strips the leading run once and leaves the
        // interior comma alone. With `g` this would read "kept.x".
        assert_eq!(de_jargon(", .kept , .x", None), "kept,.x");
        assert_eq!(de_jargon(", ; . . kept", None), "kept");
        // Rule 7's `$1` survives a following digit (`$10` would not).
        assert_eq!(de_jargon("Choose index 12", None), "Choose position 12");
        // Rule 11 keeps the punctuation it strips whitespace away from.
        assert_eq!(de_jargon("value 3 , and 4 .", None), "value 3, and 4.");
        // Without a spec, rules 1-3 are skipped and 4-13 still run.
        assert_eq!(
            de_jargon("keeping window [4, 7]", None),
            "keeping the rest of the board"
        );
        assert_eq!(de_jargon("the relation is gt", None), "the relation is gt");
        // U+0085 is not ECMAScript whitespace, so the final trim keeps it.
        assert_eq!(de_jargon("\u{0085}mid=3", None), "\u{0085}");
    }
}
