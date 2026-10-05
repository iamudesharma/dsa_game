//! Expected values captured from the existing TypeScript implementation.
use dsa_api::{interview, resume};
use serde_json::{json, Value};
fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/account.json")).unwrap()
}
fn normalize(mut v: Value) -> Value {
    match &mut v {
        Value::Array(a) => {
            for item in a {
                *item = normalize(item.take());
            }
        }
        Value::Object(o) => {
            for (key, item) in o {
                if key == "id" {
                    if let Some(s) = item.as_str() {
                        if ["exp:", "edu:", "proj:", "skill:"]
                            .iter()
                            .any(|prefix| s.starts_with(prefix))
                        {
                            *item = json!(format!("{}:fixture", s.split(':').next().unwrap()));
                            continue;
                        }
                    }
                }
                *item = normalize(item.take());
            }
        }
        _ => {}
    }
    v
}
#[test]
fn deterministic_resume_parser_matches_node() {
    for row in fixtures()["parses"].as_array().unwrap() {
        let text = row["text"].as_str().unwrap();
        let (parsed, unparsed) = resume::parse(text);
        assert_eq!(
            normalize(json!({"resume":parsed,"unparsed":unparsed})),
            row["result"],
            "input: {text}"
        );
    }
}
#[test]
fn seeded_interviews_match_node_every_company_and_rotation() {
    for row in fixtures()["kits"].as_array().unwrap() {
        let kit = interview::template(
            &row["resume"],
            &row["target"],
            row["seed"].as_f64().unwrap(),
            row["newAngle"].as_bool().unwrap(),
        )
        .unwrap();
        assert_eq!(
            kit, row["result"],
            "company: {}, seed: {}, angle: {}",
            row["target"]["companyId"], row["seed"], row["newAngle"]
        );
    }
}
#[test]
fn resume_grounding_and_merge_match_node() {
    let fixtures = fixtures();
    for row in fixtures["groundings"].as_array().unwrap() {
        let (ok, r, rejected) =
            resume::grounded(row["raw"].clone(), row["source"].as_str().unwrap()).unwrap();
        assert_eq!(
            json!({"ok":ok,"resume":r,"rejected":rejected}),
            row["result"]
        );
    }
    for row in fixtures["merges"].as_array().unwrap() {
        assert_eq!(
            resume::merge(&row["model"], &row["fallback"]).unwrap(),
            row["result"]
        );
    }
    for row in fixtures["digest"].as_array().unwrap() {
        assert_eq!(
            interview::resume_to_text(&row["resume"], 4000),
            row["result"].as_str().unwrap()
        );
    }
}
#[test]
fn interview_reference_and_fabrication_checks_match_node() {
    for row in fixtures()["validations"].as_array().unwrap() {
        let result = match interview::validate(row["raw"].clone(), &row["resume"]) {
            Ok(kit) => json!({"ok":true,"kit":kit,"issues":[]}),
            Err(issues) => json!({"ok":false,"kit":null,"issues":issues}),
        };
        assert_eq!(result, row["result"], "raw: {}", row["raw"]);
    }
}
