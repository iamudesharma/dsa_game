//! Zero-I/O fallback spec generation. Authored text is static data, not executable code.
use serde_json::{json, Map, Value};
use std::sync::OnceLock;
pub fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/templates.json")).unwrap())
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn fill(template: &str, slots: &Map<String, Value>) -> String {
    let mut out = template.to_string();
    for (key, value) in slots {
        out = out.replace(&format!("{{{key}}}"), text(value));
    }
    out
}
pub fn choose(allowed: &[Value], required: &[Value], difficulty: &str) -> Option<Vec<Value>> {
    if allowed.is_empty() || required.iter().any(|id| !allowed.contains(id)) {
        return None;
    }
    let mut chosen = Vec::new();
    for id in required {
        if !chosen.contains(id) {
            chosen.push(id.clone());
        }
    }
    let submit = json!("submitAnswer");
    if allowed.contains(&submit) && !chosen.contains(&submit) {
        chosen.push(submit);
    }
    let want = chosen.len().max(
        allowed
            .len()
            .min(data()["MECHANICS_WANTED"][difficulty].as_u64()? as usize),
    );
    for id in allowed {
        if chosen.len() >= want {
            break;
        }
        if !chosen.contains(id) {
            chosen.push(id.clone());
        }
    }
    Some(
        allowed
            .iter()
            .filter(|id| chosen.contains(id))
            .cloned()
            .collect(),
    )
}
fn label(id: &str, t: &Value) -> String {
    let object = text(&t["object"]);
    let plural = text(&t["objectPlural"]);
    let article = if crate::compat::trim(object)
        .starts_with(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U'])
    {
        "an"
    } else {
        "a"
    };
    match id {
        "selectObject" => format!("take {article} {object} in hand"),
        "moveObject" => format!("shift {article} {object} to another spot"),
        "swapPair" => format!("trade places between two {plural}"),
        "comparePair" => format!("{} two {plural} against each other", text(&t["actionVerb"])),
        "pushPop" => format!("stack or unstack {article} {object}"),
        "choosePath" => format!("decide which side of the {} stays open", text(&t["place"])),
        "traverseNode" => format!("advance to the next {object}"),
        "connectNodes" => format!("rewire the pointer between two {plural}"),
        "assignValue" => format!("write a value into the {} slot", text(&t["target"])),
        "submitAnswer" => format!("commit the {}", text(&t["target"])),
        _ => String::new(),
    }
}
pub fn build(
    problem: &Value,
    instance: &Value,
    seed: f64,
    difficulty: &str,
    language: Option<&str>,
) -> Option<Value> {
    let d = data();
    let themes = d["themes"].as_array()?;
    let mut rng = crate::compat::Rng::new(seed);
    let theme = &themes[(rng.sample() * themes.len() as f64).floor() as usize];
    let tails = theme["titleTails"].as_array()?;
    let tail = text(&tails[(rng.sample() * tails.len() as f64).floor() as usize]);
    let n = instance["values"].as_array().map_or(0, Vec::len);
    let n = if n > 0 {
        n
    } else {
        instance["list"].as_array().map_or(0, Vec::len)
    };
    let mut slots = Map::new();
    for (key, source) in [
        ("object", "object"),
        ("objectPlural", "objectPlural"),
        ("place", "place"),
        ("action", "actionVerb"),
        ("target", "target"),
        ("lower", "lowerWord"),
        ("equal", "equalWord"),
        ("higher", "higherWord"),
    ] {
        slots.insert(key.into(), theme[source].clone());
    }
    slots.insert("n".into(), json!(n.to_string()));
    slots.insert(
        "problem".into(),
        d["topicLabels"][text(&problem["topic"])].clone(),
    );
    let title = format!("{} — {tail}", fill(text(&theme["titleTemplate"]), &slots));
    let story = fill(text(&theme["storyTemplate"]), &slots);
    let place = text(&theme["place"]);
    let object = text(&theme["object"]);
    let plural = text(&theme["objectPlural"]);
    let target = text(&theme["target"]);
    let clause = instance.get("target").map_or_else(String::new, |v| {
        format!(" The {target} reads {v}, and it is in there somewhere.")
    });
    let intro = format!("{story} Right now the {place} holds {n} {plural}.{clause} Work one at a time; the hints spell out the plan if you want them.");
    let objective = text(&problem["learningObjective"]);
    let mut chars = objective.chars();
    let lower = chars.next().map_or_else(String::new, |c| {
        format!("{}{}", c.to_lowercase(), chars.as_str())
    });
    let required = problem["requiredMechanics"].as_array()?;
    let allowed = problem["allowedMechanics"].as_array()?;
    let mut ops = Vec::new();
    for id in required {
        let op = text(&d["mechanics"][text(id)]["op"]);
        if !ops.contains(&op) {
            ops.push(op);
        }
    }
    let mut hints = Vec::new();
    for rung in 0..3 {
        for op in &ops {
            if hints.len() >= 6 {
                break;
            }
            if let Some(line) = d["HINT_LADDER"][*op][rung].as_str() {
                let line = fill(line, &slots);
                if !hints.contains(&line) {
                    hints.push(line);
                }
            }
        }
    }
    let mut meanings = Map::new();
    let mechanics: Vec<_> = choose(allowed,required,difficulty)?.iter().map(|id| {
        let def = &d["mechanics"][text(id)];let name = label(text(id),theme);let op = text(&def["op"]);
        meanings.insert(text(id).into(),json!(format!("{name} — the {op} operation. Mechanically: {}",text(&def["description"]))));
        json!({"id":id,"boundDsaOp":op,"label":name,"hint":format!("{name} — the {op} step of the algorithm.")})
    }).collect();
    let time = text(&problem["complexity"]["time"]);
    let space = text(&problem["complexity"]["space"]);
    let win = format!("The {target} gives. Every {object} in the {place} was handled in the order the plan demanded — {time} in the worst case, {space} of extra space, and not one step spent that the algorithm did not require.");
    let lose = format!("The {target} stays shut. The {place} resets, but the {plural} are exactly where you left them, and so is the plan. Same rules, different order.");
    let summary = format!("You worked the {place} one {object} at a time until the {target} resolved. What this problem is built to teach: {objective} The run is bounded by {time} time and {space} extra space, and that bound comes from the algorithm rather than from how carefully you played.");
    let mapping = json!([
        {"gameTerm":object,"algorithmTerm":"a single data element — one array slot or one node value"},
        {"gameTerm":plural,"algorithmTerm":d["CONTAINER_TERM"][text(&problem["topic"])]},
        {"gameTerm":place,"algorithmTerm":d["SCOPE_TERM"][text(&problem["topic"])]},
        {"gameTerm":format!("{} / {} / {}",text(&theme["lowerWord"]),text(&theme["equalWord"]),text(&theme["higherWord"])),"algorithmTerm":"the three outcomes of a comparison: less than, equal, greater than"}
    ]);
    let vocabulary: Map<_, _> = [
        "object",
        "objectPlural",
        "place",
        "actionVerb",
        "target",
        "lowerWord",
        "equalWord",
        "higherWord",
    ]
    .iter()
    .map(|k| ((*k).to_string(), theme[*k].clone()))
    .collect();
    let seed = if seed.fract() == 0.0 && seed >= 0.0 && seed <= u32::MAX as f64 {
        json!(seed as u64)
    } else {
        json!(seed)
    };
    Some(
        json!({"specVersion":1,"problemId":problem["id"],"seed":seed,"language":language.unwrap_or("en"),"objective":format!("In the {place}, {lower}"),"theme":{"title":title,"story":story,"genre":theme["genre"],"tone":theme["tone"]},"visual":{"palette":theme["palette"],"objectGlyphs":theme["glyphs"].as_object()?.values().cloned().collect::<Vec<_>>(),"boardLabel":theme["boardLabel"]},"vocabulary":vocabulary,"mechanics":mechanics,"narration":{"intro":intro,"hintPool":hints,"win":win,"lose":lose,"correctFlavour":[format!("The {object} settles into place."),format!("One down in the {place}."),format!("The {place} exhales.")]},"debrief":{"summary":summary,"actionMeaning":meanings,"mapping":mapping,"codeLanguages":["javascript","python"]},"generatedBy":"template"}),
    )
}
