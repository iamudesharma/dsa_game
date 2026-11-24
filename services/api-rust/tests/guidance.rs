//! Node guidance fixtures exercised through the production Rust module.
use dsa_api::guidance::{de_jargon, derive_feedback, derive_turn_prompt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Copied verbatim from `tests/hints.rs:3-16`. Sorting keys makes the digest
/// blind to key order, which is exactly why `bytes` exists.
fn stable(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(stable).collect()),
        Value::Object(o) => {
            let sorted: std::collections::BTreeMap<_, _> =
                o.into_iter().map(|(k, v)| (k, stable(v))).collect();
            Value::Object(sorted.into_iter().collect())
        }
        v => v,
    }
}
fn digest(v: Value) -> String {
    format!("{:x}", Sha256::digest(stable(v).to_string().as_bytes()))
}

const FIXTURE: &str = include_str!("fixtures/guidance.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("guidance fixture parses")
}

fn section<'a>(root: &'a Value, name: &str) -> &'a Vec<Value> {
    root[name]
        .as_array()
        .unwrap_or_else(|| panic!("fixture section {name} is not an array"))
}

/// `outcome`/`frame` are only ever read through optional chaining, so a JSON
/// `null` means "not supplied".
fn optional(value: &Value) -> Option<&Value> {
    (!value.is_null()).then_some(value)
}

/// A JSON `null` frame means `frame === null`, which `frame?.x` treats exactly
/// like an absent frame.
fn frame(value: &Value) -> Option<&Value> {
    optional(value)
}

#[test]
fn guidance_module_compiles_through_library() {
    // Reach the module through the library rather than a `#[path]` copy, so this
    // fails if `lib.rs` stops registering it. The assertions are minimal on
    // purpose — parity is the sweep's job.
    let state = dsa_api::runtime::init("binary-search", 31337.0, "easy").unwrap();
    let spec = fixture()["bytes"][0]["spec"].clone();
    let prompt = derive_turn_prompt(&state, &spec);
    assert!(prompt["instruction"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));
    // `get`, not `Index`: an absent key and an explicit null both index to
    // `Value::Null`, so `prompt["phase"] == json!(null)` would pass either way.
    assert!(
        prompt.get("phase").is_none(),
        "a TurnPrompt has no phase key"
    );
    assert_eq!(prompt["mechanic"], json!("selectObject"));
    assert_eq!(
        prompt["nudge"],
        json!(null),
        "nudge is a real null, not absent"
    );
}

#[test]
fn turn_prompt_and_feedback_match_node_at_every_played_state() {
    let root = fixture();
    let cases = section(&root, "cases");
    // Asserted so a shrunken fixture fails loudly instead of passing on less
    // evidence. 45 oracles x 3 difficulties, and 3,247 canonical moves.
    assert_eq!(cases.len(), 135, "expected 135 guidance journeys");
    assert_eq!(
        cases
            .iter()
            .map(|c| c["moves"].as_array().unwrap().len())
            .sum::<usize>(),
        3247,
        "expected 3247 played states"
    );

    let invalid = json!({"type": "assignValue", "targetId": "missing", "value": "wrong"});
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let difficulty = case["difficulty"].as_str().unwrap();
        let spec = &case["spec"];
        let mut current = dsa_api::runtime::init(id, 7.0, difficulty).unwrap();
        for step in case["moves"].as_array().unwrap() {
            // The rejected turn runs against the same board, and the engine drops
            // its trace frame, so `frame: null` is genuinely reachable.
            let rejected = dsa_api::runtime::apply(&current, &invalid);
            let stale = current["trace"]
                .as_array()
                .and_then(|t| t.last())
                .cloned()
                .unwrap_or(Value::Null);
            let applied = dsa_api::runtime::apply(&current, &step["action"]);
            let next = applied["state"].clone();
            let outcome = applied["outcome"].clone();
            let latest = next["trace"]
                .as_array()
                .and_then(|t| t.last())
                .cloned()
                .unwrap_or(Value::Null);
            let label = format!("{id}/{difficulty}");

            assert_eq!(
                digest(derive_turn_prompt(&current, spec)),
                step["prompt"],
                "{label} turn prompt"
            );
            assert_eq!(
                digest(derive_feedback(&next, &outcome, frame(&latest), spec)),
                step["feedback"],
                "{label} feedback with frame"
            );
            assert_eq!(
                digest(derive_feedback(&next, &outcome, None, spec)),
                step["feedbackNoFrame"],
                "{label} feedback without frame"
            );
            assert_eq!(
                digest(derive_feedback(
                    &rejected["state"],
                    &rejected["outcome"],
                    None,
                    spec
                )),
                step["illegal"],
                "{label} illegal feedback, no frame"
            );
            assert_eq!(
                digest(derive_feedback(
                    &rejected["state"],
                    &rejected["outcome"],
                    frame(&stale),
                    spec
                )),
                step["illegalStale"],
                "{label} illegal feedback, stale frame"
            );
            current = next;
        }
        assert_eq!(
            digest(derive_turn_prompt(&current, spec)),
            case["terminal"],
            "{id}/{difficulty} terminal prompt"
        );
    }
}

#[test]
fn de_jargon_matches_node_with_and_without_a_spec() {
    let root = fixture();
    let entries = section(&root, "deJargon");
    assert_eq!(entries.len(), 22, "expected 22 deJargon texts");
    let spec = root["bytes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["name"] == "deJargon-bytes")
        .map(|b| b["spec"].clone())
        .expect("the spec used for the deJargon corpus");
    for entry in entries {
        let text = entry["text"].as_str().unwrap();
        // Both the digest and the raw string: the digest proves equality with
        // Node's recorded value, the raw string makes a failure readable.
        assert_eq!(
            digest(json!(de_jargon(text, Some(&spec)))),
            entry["spec"],
            "spec-gated deJargon({text:?})"
        );
        assert_eq!(
            json!(de_jargon(text, Some(&spec))).to_string(),
            entry["rawSpec"].as_str().unwrap(),
            "spec-gated deJargon({text:?}) raw"
        );
        assert_eq!(
            digest(json!(de_jargon(text, None))),
            entry["bare"],
            "bare deJargon({text:?})"
        );
        assert_eq!(
            json!(de_jargon(text, None)).to_string(),
            entry["rawBare"].as_str().unwrap(),
            "bare deJargon({text:?}) raw"
        );
    }
}

#[test]
fn synthetic_oracle_cases_match_node() {
    let root = fixture();
    let entries = section(&root, "synthetic");
    let mut checked = 0usize;
    let mut node_only = Vec::new();
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        // `null` means the case has no reachable Rust equivalent, because Rust
        // calls `oracle_plan::legal` directly and has no oracle-injection seam.
        // Those are asserted separately, against Node's recorded raw output.
        if entry["rustEquivalent"].is_null() {
            node_only.push(name.to_owned());
            continue;
        }
        let state = &entry["state"];
        let spec = &entry["spec"];
        match entry["rustEquivalent"].as_str().unwrap() {
            "digest" => {
                assert_eq!(
                    derive_turn_prompt(state, spec).to_string(),
                    entry["prompt"].as_str().unwrap(),
                    "{name} prompt"
                );
                checked += 1;
            }
            "substitute" => {
                // D3: Node throws here. Rust must not panic, and must produce a
                // usable prompt built from `selectObject`'s instruction.
                assert!(
                    entry["threw"]
                        .as_str()
                        .is_some_and(|t| t.contains("TypeError")),
                    "{name} should record Node's TypeError, got {:?}",
                    entry["threw"]
                );
                let prompt = derive_turn_prompt(state, spec);
                // The doctored mechanic has an EMPTY authored label, so
                // `buildInstruction` falls through to the generated imperative,
                // and `banana` is not in `MECHANIC_INSTRUCTION`, so Rust
                // substitutes `selectObject`'s: "Check beacon 25."
                assert_eq!(
                    prompt["instruction"].as_str().unwrap(),
                    "Check beacon 25.",
                    "{name} substitutes selectObject's instruction"
                );
                assert_eq!(
                    prompt["mechanic"],
                    json!("banana"),
                    "{name} keeps the unvalidated mechanic id, as Node would"
                );
                checked += 1;
            }
            "feedback" => {
                assert_eq!(
                    derive_feedback(state, &entry["outcome"], frame(&entry["frame"]), spec)
                        .to_string(),
                    entry["feedback"].as_str().unwrap(),
                    "{name} feedback"
                );
                checked += 1;
            }
            "panic" => {
                let mut broken = entry["state"].clone();
                broken["problemId"] = json!(entry["problemId"].clone());
                assert!(
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        derive_turn_prompt(&broken, spec)
                    }))
                    .is_err(),
                    "{name} must propagate the panic, not degrade"
                );
                checked += 1;
            }
            "code-line" => {
                let fb = derive_feedback(state, &entry["outcome"], frame(&entry["frame"]), spec);
                // `oracle.code('javascript')` panics on an unregistered id, so the
                // try/catch must degrade `codeLineText` to the empty string.
                assert_eq!(
                    fb["codeLineText"],
                    json!(""),
                    "{name} degrades codeLineText to empty"
                );
                assert_eq!(fb["verdict"], json!("correct"));
                checked += 1;
            }
            other => panic!("{name} has an unknown rustEquivalent {other:?}"),
        }
    }
    assert_eq!(checked, 12, "expected 12 Rust-assertable synthetic cases");
    assert_eq!(
        node_only,
        vec![
            "stub-legal-undefined",
            "stub-legal-empty",
            "stub-legal-not-an-array",
            "stub-legal-throws",
            "stub-answer-target-null",
            "stub-assignment-targets-empty",
            "stub-answer-target-empty-string",
            "stub-code-throws",
        ],
        "the Node-only cases must stay exactly the stub-oracle ones"
    );
}

#[test]
fn node_only_stub_cases_pin_the_arms_rust_cannot_reach() {
    let root = fixture();
    let by_name = |name: &str| -> Value {
        section(&root, "synthetic")
            .iter()
            .find(|s| s["name"] == name)
            .cloned()
            .unwrap_or_else(|| panic!("missing synthetic case {name}"))
    };
    // The three degenerations of `oracle.legalActions?.(state)` are
    // indistinguishable, which is what licenses one Rust state to stand in for
    // all three.
    let empty = digest(json!(by_name("stub-legal-empty")["prompt"].clone()));
    assert_eq!(
        empty,
        digest(json!(by_name("stub-legal-undefined")["prompt"].clone()))
    );
    assert_eq!(
        empty,
        digest(json!(by_name("stub-legal-not-an-array")["prompt"].clone()))
    );
    assert_eq!(
        empty,
        digest(json!(by_name("no-legal-actions")["prompt"].clone()))
    );
    // A throwing `legalActions` propagates; Node does not guard it.
    assert_eq!(
        by_name("stub-legal-throws")["threw"],
        json!("Error: guidance probe")
    );
    // `assignmentTargetIds` uses ARRAY TRUTHINESS, so `[]` is emitted empty.
    // A `!ids.is_empty()` guard would drop the key and fail here.
    assert!(
        by_name("stub-assignment-targets-empty")["prompt"]
            .as_str()
            .unwrap()
            .contains("\"assignmentTargetIds\":[]"),
        "assignmentTargetIds must be present and empty"
    );
    // `answerTargetId` uses `??`, so `''` is emitted as `''` rather than falling
    // back to `'answer'`.
    assert!(
        by_name("stub-answer-target-empty-string")["prompt"]
            .as_str()
            .unwrap()
            .contains("\"answerTargetId\":\"\""),
        "an empty answerTargetId must be emitted as an empty string"
    );
    // A nonvisual answer destination survives: `'null'` is emitted verbatim and
    // the targets collapse to `[]`.
    let null_case = by_name("stub-answer-target-null");
    assert!(null_case["prompt"]
        .as_str()
        .unwrap()
        .contains("\"answerTargetId\":\"null\""));
    assert!(null_case["prompt"]
        .as_str()
        .unwrap()
        .contains("\"targets\":[]"));
    // A throwing `oracle.code('javascript')` degrades `codeLineText` to ''.
    assert_eq!(by_name("stub-code-throws")["codeLineText"], json!(""));
}

#[test]
fn serialized_key_order_matches_node_bytes() {
    let root = fixture();
    let entries = section(&root, "bytes");
    assert_eq!(entries.len(), 16, "expected 16 byte-order cases");
    let mut prompt_cases = 0usize;
    let mut feedback_cases = 0usize;
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        // `stateDigest` pins the EMBEDDED board's serialization: it fails if this
        // file's copy is edited. It does NOT prove which state Node fed guidance —
        // that would need a digest of Node's own output. What it does establish is
        // that Rust is replaying the exact board recorded beside the expected
        // string, rather than one re-derived here and silently different.
        if !entry["stateDigest"].is_null() {
            assert_eq!(
                digest(entry["state"].clone()),
                entry["stateDigest"],
                "{name} state digest"
            );
        }
        if let Some(expected) = optional(&entry["prompt"]) {
            assert_eq!(
                derive_turn_prompt(&entry["state"], &entry["spec"]).to_string(),
                expected.as_str().unwrap(),
                "{name} serialized turn prompt"
            );
            prompt_cases += 1;
        } else if let Some(expected) = optional(&entry["feedback"]) {
            assert_eq!(
                derive_feedback(
                    &entry["state"],
                    &entry["outcome"],
                    frame(&entry["frame"]),
                    &entry["spec"]
                )
                .to_string(),
                expected.as_str().unwrap(),
                "{name} serialized feedback"
            );
            feedback_cases += 1;
        } else if let Some(texts) = optional(&entry["texts"]) {
            let spec = &entry["spec"];
            for row in texts.as_array().unwrap() {
                let text = row["text"].as_str().unwrap();
                assert_eq!(
                    json!(de_jargon(text, Some(spec))).to_string(),
                    row["spec"].as_str().unwrap(),
                    "{name}: {text:?} with spec"
                );
                assert_eq!(
                    json!(de_jargon(text, None)).to_string(),
                    row["bare"].as_str().unwrap(),
                    "{name}: {text:?} without spec"
                );
            }
        } else {
            panic!("byte case {name} carries no prompt, feedback or texts");
        }
    }
    assert_eq!(prompt_cases, 10, "expected 10 prompt byte cases");
    assert_eq!(feedback_cases, 5, "expected 5 feedback byte cases");
}

#[test]
fn optional_keys_and_absent_keys_are_byte_exact() {
    let root = fixture();
    let bytes = section(&root, "bytes");
    let find = |name: &str| -> Value {
        bytes
            .iter()
            .find(|b| b["name"] == name)
            .cloned()
            .unwrap_or_else(|| panic!("missing byte case {name}"))
    };
    let text = |name: &str| find(name)["prompt"].as_str().unwrap().to_owned();

    // Both optional keys, in position: after `targets`, before `reason`.
    let assign = text("playing-assign");
    assert!(assign.contains(r#""targets":[{"id":"target","label":"the wanted beacon","hint":"pick this one","role":"candidate"}],"assignmentTargetIds":["need"],"reason":"#));
    // `submitAnswer` never emits `assignmentTargetIds`.
    let submit = text("playing-submit");
    assert!(submit.contains(r#","answerTargetId":"v2","reason":"#));
    assert!(!submit.contains("assignmentTargetIds"));
    // The `?? 'answer'` arm of the same key.
    assert!(
        text("playing-submit-answer-fallback").contains(r#","answerTargetId":"answer","reason":"#)
    );
    // `expected.dsaOp` wins over the mechanic's own op, so `reason` is the
    // terminate text on a `choosePath` turn.
    let override_case = text("playing-compare-terminate");
    assert!(override_case.contains(r#""mechanic":"choosePath","dsaOp":"terminate""#));
    assert!(
        override_case.contains(r#""reason":"Finishing is how the program reports its result.""#)
    );
    // A plain turn carries neither optional key.
    let select = text("playing-select");
    assert!(!select.contains("assignmentTargetIds") && !select.contains("answerTargetId"));
    // Terminal prompts have neither optional key and a real `null` nudge.
    for phase in ["won", "lost"] {
        let terminal = text(&format!("terminal-{phase}"));
        assert!(
            terminal.ends_with(r#""nudge":null}"#),
            "terminal-{phase}: {terminal}"
        );
        assert!(!terminal.contains("assignmentTargetIds"));
        assert!(!terminal.contains("answerTargetId"));
    }
    // Indicator shape `label, progress, detail`.
    assert!(text("indicator-empty")
        .contains(r#""indicator":{"label":"beacon row","progress":1,"detail":"nothing left"}"#));
    // Illegal feedback has no `encourage` and keeps `nextStep`.
    assert!(!find("feedback-illegal")["feedback"]
        .as_str()
        .unwrap()
        .contains("encourage"));
    // Wrong feedback: `nextStep` present, then `encourage` after `didWhat`.
    assert!(find("feedback-wrong")["feedback"]
        .as_str()
        .unwrap()
        .contains(r#""nextStep":"The program wanted beacon 25.","codeLine":7,"codeLineText":"    if (a[mid] < target) {","didWhat":"compared two beacons","encourage":"Mistakes here are how the pattern shows up."}"#));
    // The same board with `expected` dropped: `nextStep` is an ABSENT key.
    assert!(!find("feedback-wrong-no-next")["feedback"]
        .as_str()
        .unwrap()
        .contains("nextStep"));
    // Correct feedback never has `nextStep`; `encourage` needs `steps > 2`.
    assert!(!find("feedback-correct")["feedback"]
        .as_str()
        .unwrap()
        .contains("nextStep"));
    assert!(find("feedback-correct")["feedback"]
        .as_str()
        .unwrap()
        .contains(r#""didWhat":"read one beacon","encourage":"No wrong turns yet — that halving is doing its job."}"#));
    assert!(!find("feedback-correct-early")["feedback"]
        .as_str()
        .unwrap()
        .contains("encourage"));
}

#[test]
fn legal_actions_is_not_guarded_but_code_is() {
    let root = fixture();
    let spec = root["synthetic"][0]["spec"].clone();
    let state = dsa_api::runtime::init("binary-search", 31337.0, "easy").unwrap();

    // `guidance.ts:157` has no try/catch. `problemId: 7` makes
    // `oracle_plan::legal` unwrap `as_str()`, which is the reachable equivalent
    // of a throwing `legalActions`, so the panic must reach the caller.
    let mut throwing = state.clone();
    throwing["problemId"] = json!(7);
    let propagated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        derive_turn_prompt(&throwing, &spec)
    }));
    assert!(
        propagated.is_err(),
        "a throwing legalActions must propagate, not degrade"
    );

    // `guidance.ts:445-449` DOES guard. An unregistered id makes
    // `oracle_plan::code` panic, and the feedback must still come back.
    let mut unregistered = state.clone();
    unregistered["problemId"] = json!("guidance-probe");
    let outcome = json!({"correct": true, "feedback": "ok", "dsaOp": "read", "traceStep": 0});
    let frame = json!({"dsaOp": "read", "codeLine": 1, "codeLineText": "", "note": ""});
    let fb = derive_feedback(&unregistered, &outcome, Some(&frame), &spec);
    assert_eq!(fb["codeLineText"], json!(""));
    assert_eq!(fb["verdict"], json!("correct"));
}

#[test]
fn frameless_feedback_always_describes_a_read() {
    let root = fixture();
    let spec = root["cases"][0]["spec"].clone();
    let state = dsa_api::runtime::init("binary-search", 31337.0, "easy").unwrap();
    // `deriveFeedback` passes a `DsaOp` to `opForActionType`
    // (`guidance.ts:440`), and `isActionType` rejects all thirteen of them, so
    // this ALWAYS resolves to `'read'`. With no frame, every verdict describes a
    // read — even when `outcome.dsaOp` says `compare`.
    let correct = derive_feedback(
        &state,
        &json!({"correct": true, "feedback": "fine", "dsaOp": "compare", "traceStep": 0}),
        None,
        &spec,
    );
    assert_eq!(correct["headline"], json!("Locked on."));
    assert_eq!(correct["didWhat"], json!("read one beacon"));
    let wrong = derive_feedback(
        &state,
        &json!({"correct": false, "feedback": "nope", "dsaOp": "compare", "traceStep": 0}),
        None,
        &spec,
    );
    // `headlineForWrong` has no `read` arm.
    assert_eq!(wrong["headline"], json!("Not this one."));
    assert_eq!(wrong["didWhat"], json!("read one beacon"));

    // And over a real played line, every frameless verdict is a read.
    let mut current = state;
    let mut compared = 0usize;
    for action in dsa_api::oracle_binary::canonical(&current, None)
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["action"].clone())
        .collect::<Vec<_>>()
    {
        let applied = dsa_api::runtime::apply(&current, &action);
        let frameless = derive_feedback(&applied["state"], &applied["outcome"], None, &spec);
        assert!(
            frameless["didWhat"]
                .as_str()
                .is_some_and(|d| d.starts_with("read one ")),
            "frameless didWhat was {:?}",
            frameless["didWhat"]
        );
        assert!(frameless["codeLineText"]
            .as_str()
            .is_some_and(|t| !t.is_empty()));
        compared += 1;
        current = applied["state"].clone();
    }
    assert!(
        compared > 3,
        "expected a real played line, got {compared} moves"
    );
}

#[test]
fn prototype_member_lookups_return_object_prototype() {
    let root = fixture();
    let entry = section(&root, "synthetic")
        .iter()
        .find(|s| s["name"] == "prototype-member-next-step")
        .cloned()
        .expect("the prototype case is recorded");
    let state = &entry["state"];
    let spec = &entry["spec"];
    let fb = derive_feedback(state, &entry["outcome"], frame(&entry["frame"]), spec);
    assert_eq!(
        fb.to_string(),
        entry["feedback"].as_str().unwrap(),
        "prototype-member feedback"
    );
    // `objectMap` builds a plain `{}`, so `state.objects['constructor']` is
    // `Object.prototype.constructor`: truthy, with every field `undefined`. The
    // result is a client-visible string.
    assert_eq!(
        fb["nextStep"],
        json!("The program wanted undefined."),
        "the prototype lookup must survive the port"
    );
    // Every one of the twelve prototype names behaves the same way.
    for name in [
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
    ] {
        let fb = derive_feedback(
            state,
            &json!({
                "correct": false,
                "feedback": "nope",
                "dsaOp": "read",
                "expected": {"type": "selectObject", "objectId": name},
                "traceStep": 0,
            }),
            None,
            spec,
        );
        assert_eq!(
            fb["nextStep"],
            json!("The program wanted undefined."),
            "{name} is an Object.prototype member"
        );
    }
}

/// Every branch the canonical sweep cannot reach, compared against Node's own
/// serialized output.
///
/// The sweep produces no `wrong` verdict at all — across 3,247 played states the
/// verdicts are `{correct: 6494, illegal: 6494}` — and `nudge` is `null` in all of
/// them. So `derive_nudge`, `headline_for_wrong`'s choose-path arm, three
/// `operation_name` arms, the `relation` and fallback arms of
/// `next_step_for_expected`, and the whole `teach` fallback chain would otherwise
/// ship with no committed Node-derived assertion at all. A 29-defect mutation run
/// proved that: twelve injected defects survived, every one of them in here.
#[test]
fn every_gap_branch_matches_node() {
    let root = fixture();
    let entries = section(&root, "gaps");
    let mut replayed = 0usize;
    let mut recorded = Vec::new();
    for entry in entries {
        let name = entry["name"].as_str().unwrap();
        if entry["rustEquivalent"].is_null() {
            // Recorded, not replayed. Three or more targets need a legal
            // descriptor with four `objectIds` on a non-`selectObject`,
            // non-`choosePath` mechanic; no registered oracle emits one and there is
            // no injection seam. `recorded` is asserted in the test below so this
            // cannot quietly become a silent skip.
            recorded.push(name.to_owned());
            continue;
        }
        let mine = match entry["kind"].as_str().unwrap() {
            "prompt" => derive_turn_prompt(&entry["state"], &entry["spec"]).to_string(),
            "feedback" => derive_feedback(
                &entry["state"],
                &entry["outcome"],
                frame(&entry["frame"]),
                &entry["spec"],
            )
            .to_string(),
            other => panic!("{name}: unknown kind {other:?}"),
        };
        assert_eq!(mine, entry["output"].as_str().unwrap(), "{name}");
        replayed += 1;
    }
    assert_eq!(replayed, 30, "expected 30 replayed gap branches");
    assert_eq!(
        recorded,
        vec!["describe-three-targets-node-only"],
        "only describeTargets' 3+ arm is Node-only; a new one needs a reason"
    );
}

#[test]
fn the_recorded_gap_branches_keep_their_node_values() {
    let root = fixture();
    let find = |name: &str| -> Value {
        section(&root, "gaps")
            .iter()
            .find(|g| g["name"] == name)
            .cloned()
            .unwrap_or_else(|| panic!("missing gap case {name}"))
    };
    // `describeTargets` with three or more targets ignores the labels entirely and
    // names the plural noun.
    assert!(
        find("describe-three-targets-node-only")["output"]
            .as_str()
            .unwrap()
            .contains(r#""instruction":"Check one of the beacons.""#),
        "three or more targets must use the objectPlural"
    );
    // `fallbackOp`'s last-mechanic arm: with every `boundDsaOp` already in the
    // trace, the LAST mechanic's op wins.
    let fallback = find("fallback-op-last-mechanic");
    assert_eq!(fallback["dsaOp"], json!("terminate"));
    assert_eq!(fallback["mechanic"], json!("submitAnswer"));
    // And Rust reaches it — the case is replayed above, so the output string here
    // is a cross-check that the board is the same one.
    assert!(
        fallback["output"]
            .as_str()
            .unwrap()
            .contains(r#""mechanic":"submitAnswer""#),
        "the recorded string must name the last mechanic"
    );
}

/// The fixture's own count table is committed evidence, so a silently shrunken or
/// padded fixture fails here as well as in the sweep.
#[test]
fn the_committed_count_table_matches_the_capture() {
    let counts = fixture()["counts"].clone();
    assert_eq!(counts["cases"]["expected"], json!(135));
    assert_eq!(counts["playedStates"]["expected"], json!(3247));
    assert_eq!(section(&fixture(), "cases").len(), 135);
    assert_eq!(
        section(&fixture(), "cases")
            .iter()
            .map(|c| c["moves"].as_array().unwrap().len())
            .sum::<usize>(),
        3247
    );
    assert_eq!(section(&fixture(), "deJargon").len(), 22);
    assert_eq!(section(&fixture(), "synthetic").len(), 20);
    assert_eq!(section(&fixture(), "bytes").len(), 16);
    assert_eq!(section(&fixture(), "gaps").len(), 31);
    // Every drift from the plan must carry a stated reason.
    for (name, planned, drift) in [
        ("deJargon", 21, "COVERAGE WIN"),
        ("synthetic", 15, "COVERAGE WIN"),
        ("gaps", 20, "NEW BLOCK"),
    ] {
        assert_eq!(
            counts[name]["planned"],
            json!(planned),
            "{name} drift must record the planned count"
        );
        assert!(
            counts[name]["drift"]
                .as_str()
                .unwrap_or_default()
                .contains(drift),
            "{name} drift must state '{drift}'"
        );
    }
}
