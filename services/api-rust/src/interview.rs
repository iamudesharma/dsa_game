//! Seeded interview templates and reference/fabrication validation.
use crate::{
    account, auth, compat::Rng, contracts, error::ApiError, now_ms, provider::ChatError, text,
    AppState,
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
    collections::HashSet,
    sync::OnceLock,
    time::{Duration, Instant},
};

pub fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/account.json")).unwrap())
}
pub fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn company(target: &Value) -> Value {
    if let Some(found) = crate::reference()["companies"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == target["companyId"])
    {
        return found.clone();
    }
    let mut custom = data()["customCompany"].clone();
    let label = string(target, "customCompany").trim();
    if !label.is_empty() {
        custom["label"] = json!(label);
    }
    custom
}
pub fn source_ids(resume: &Value) -> HashSet<String> {
    let mut ids = HashSet::from(["general".to_owned()]);
    for name in ["experience", "skills", "projects", "education"] {
        for v in array(resume, name) {
            ids.insert(string(v, "id").into());
        }
    }
    ids
}
fn pick(rng: &mut Rng, pool: &[Value], n: usize) -> Vec<Value> {
    let mut pool = pool.to_vec();
    let mut out = Vec::new();
    while !pool.is_empty() && out.len() < n {
        let index = (rng.sample() * pool.len() as f64).floor() as usize;
        out.push(pool.remove(index));
    }
    out
}
fn add(questions: &mut Vec<Value>, mut q: Value) {
    q["id"] = json!(format!("q-{}", questions.len() + 1));
    questions.push(q);
}
pub fn template(
    resume: &Value,
    target: &Value,
    seed: f64,
    new_angle: bool,
) -> Result<Value, Vec<Value>> {
    let company = company(target);
    let label = string(&company, "label");
    let mut rng = Rng::new(seed + if new_angle { 1013904223.0 } else { 0.0 });
    let mut questions = Vec::new();
    let exps: Vec<_> = array(resume, "experience").iter().take(3).collect();
    for e in &exps {
        let bullet = array(e, "bullets")
            .first()
            .and_then(Value::as_str)
            .unwrap_or("");
        let start = if bullet.is_empty() {
            String::new()
        } else {
            format!(" Start with: \"{}\".", text::slice(bullet, 140))
        };
        add(
            &mut questions,
            json!({"type":"resume-deep-dive","prompt":format!("Walk through your work as {} at {}.{start} What was the hardest technical decision, and what did you rule out?",string(e,"title"),string(e,"company")),"whyItFits":format!("Anchored in your {} role so the answer is a story you actually lived.",string(e,"title")),"sourceRef":e["id"],"difficulty":"medium","followUps":["What would you do differently with twice the time?","How did you know it worked?"],"listeningFor":"A specific decision, the alternatives considered, and how the outcome was verified."}),
        );
    }
    let axes = array(&company, "hiringAxes");
    let axis = axes
        .iter()
        .find(|a| array(a, "categories").iter().any(|c| c == "coding"))
        .unwrap_or(&axes[0]);
    let pool = data()["coding"]
        .get(string(axis, "id"))
        .unwrap_or(&data()["coding"]["coding"])
        .as_array()
        .unwrap();
    let general = [json!({"id":"general","name":"general"})];
    let skills = if array(resume, "skills").is_empty() {
        &general[..]
    } else {
        array(resume, "skills")
    };
    for item in pick(&mut rng, pool, 3) {
        let Some(problem) = crate::reference()["problems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == item["problemId"])
        else {
            continue;
        };
        let skill = &skills[(rng.sample() * skills.len() as f64).floor() as usize];
        add(
            &mut questions,
            json!({"type":"coding","prompt":item["prompt"],"whyItFits":format!("{} Fits the {} axis at {label}.",string(&item,"why"),string(axis,"label")),"sourceRef":skill["id"],"difficulty":"medium","followUps":["What is the time and space cost, and why?","What breaks first on adversarial input?"],"listeningFor":format!("A working approach for {}, stated complexity, and one edge case.",string(problem,"title").to_lowercase()),"practice":{"problemId":problem["id"]}}),
        );
    }
    let value = array(&company, "values")
        .first()
        .and_then(Value::as_str)
        .unwrap_or("Ownership");
    add(
        &mut questions,
        json!({"type":"behavioral","prompt":format!("Tell me about a time you demonstrated {}. What was the situation, what did you personally do, and what changed because of it?",value.to_lowercase()),"whyItFits":format!("Directly probes the {label} value: {value}."),"sourceRef":exps.first().map(|e|string(e,"id")).unwrap_or("general"),"difficulty":"easy","followUps":["What feedback did you get afterwards?"],"listeningFor":"A specific situation, personal actions (not \"we\"), and a measurable outcome."}),
    );
    let needs = |category: &str| {
        axes.iter()
            .any(|a| array(a, "categories").iter().any(|c| c == category))
    };
    let (kind, pool, why, reference, difficulty, follow) = if needs("system-design") {
        (
            "system-design",
            "system",
            format!("Covers the system-design axis at {label}."),
            "general",
            "hard",
            "How do you monitor it in production?",
        )
    } else if needs("ml") {
        (
            "ml",
            "ml",
            format!("Covers the ML axis at {label}."),
            array(resume, "skills")
                .first()
                .map(|s| string(s, "id"))
                .unwrap_or("general"),
            "medium",
            "What did the error analysis show?",
        )
    } else {
        (
            "concepts",
            "concepts",
            "Probes transferable fundamentals behind the coding rounds.".into(),
            "general",
            "medium",
            "Give a concrete example from your own work.",
        )
    };
    let q = pick(&mut rng, data()[pool].as_array().unwrap(), 1).remove(0);
    add(
        &mut questions,
        json!({"type":kind,"prompt":q["prompt"],"whyItFits":why,"sourceRef":reference,"difficulty":difficulty,"followUps":[follow],"listeningFor":q["listeningFor"]}),
    );
    if let Some(project) = array(resume, "projects").first() {
        if questions.len() < 12 {
            add(
                &mut questions,
                json!({"type":"resume-deep-dive","prompt":format!("Walk through {}. What was the hardest part to get right, and how is it architected?",string(project,"name")),"whyItFits":"Projects reveal taste and follow-through beyond day-job roles.","sourceRef":project["id"],"difficulty":"medium","followUps":["What would you rebuild first?"],"listeningFor":"Architecture overview, one genuinely hard part, and honest limitations."}),
            );
        }
    }
    while questions.len() < 4 {
        let pool = data()["concepts"].as_array().unwrap();
        let q = &pool[questions.len() % pool.len()];
        add(
            &mut questions,
            json!({"type":"concepts","prompt":q["prompt"],"whyItFits":"Fundamentals every onsite probes.","sourceRef":"general","difficulty":"easy","followUps":[],"listeningFor":q["listeningFor"]}),
        );
    }
    questions.truncate(12);
    contracts::parse(
        "InterviewKit",
        json!({"version":1,"target":target,"questions":questions,"generatedBy":"template"}),
    )
}
pub fn validate(raw: Value, resume: &Value) -> Result<Value, Vec<String>> {
    let kit = contracts::parse("InterviewKit", raw).map_err(|issues| {
        issues
            .into_iter()
            .take(12)
            .map(|i| {
                let at = i["path"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| {
                        p.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| p.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join(".");
                format!(
                    "{}: {}",
                    if at.is_empty() { "<root>" } else { &at },
                    string(&i, "message")
                )
            })
            .collect::<Vec<_>>()
    })?;
    let mut issues = Vec::new();
    let ids = source_ids(resume);
    for q in array(&kit, "questions") {
        let id = string(q, "id");
        let reference = string(q, "sourceRef");
        if !ids.contains(reference) {
            issues.push(format!(
                "question {id}: sourceRef '{reference}' is not in the resume"
            ));
        }
        if let Some(practice) = q.get("practice") {
            let problem = string(practice, "problemId");
            if !crate::reference()["problems"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == problem)
            {
                issues.push(format!(
                    "question {id}: practice.problemId '{problem}' is not in the catalogue"
                ));
            } else if !data()["playable"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == problem)
            {
                issues.push(format!(
                    "question {id}: practice.problemId '{problem}' has no oracle yet"
                ));
            }
        }
    }
    let text = array(&kit, "questions")
        .iter()
        .map(|q| {
            format!(
                "{}\n{}\n{}\n{}",
                string(q, "prompt"),
                string(q, "whyItFits"),
                string(q, "listeningFor"),
                array(q, "followUps")
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        data()["fabrication"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let source = string(p, "source")
                    .replace(r"\b", r"(?-u:\b)")
                    .replace(r"\d", "[0-9]");
                regex::Regex::new(&format!(
                    "{}{source}",
                    if string(p, "flags").contains('i') {
                        "(?i)"
                    } else {
                        ""
                    }
                ))
                .unwrap()
            })
            .collect()
    });
    for (pattern, p) in patterns
        .iter()
        .zip(data()["fabrication"].as_array().unwrap())
    {
        if pattern.is_match(&text) {
            issues.push(format!(
                "fabrication:{}: {}",
                string(p, "id"),
                string(p, "reason")
            ));
        }
    }
    if issues.is_empty() {
        Ok(kit)
    } else {
        Err(issues)
    }
}
pub fn resume_to_text(resume: &Value, max: usize) -> String {
    let mut lines = Vec::new();
    if !string(resume, "summary").is_empty() {
        lines.push(format!("Summary: {}", string(resume, "summary")));
    }
    for e in array(resume, "experience") {
        lines.push(format!(
            "Experience: {} at {} ({} - {})",
            string(e, "title"),
            string(e, "company"),
            string(e, "start"),
            string(e, "end")
        ));
        for b in array(e, "bullets").iter().take(6) {
            lines.push(format!("- {}", b.as_str().unwrap_or("")));
        }
    }
    for p in array(resume, "projects") {
        let tech = array(p, "tech")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "Project: {}: {}{}",
            string(p, "name"),
            text::slice(string(p, "description"), 300),
            if tech.is_empty() {
                String::new()
            } else {
                format!(" [{tech}]")
            }
        ));
    }
    for e in array(resume, "education") {
        lines.push(
            format!(
                "Education: {} {} at {}",
                string(e, "degree"),
                string(e, "field"),
                string(e, "school")
            )
            .trim()
            .into(),
        );
    }
    if !array(resume, "skills").is_empty() {
        lines.push(format!(
            "Skills: {}",
            array(resume, "skills")
                .iter()
                .map(|s| string(s, "name"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    text::slice(&lines.join("\n"), max)
}
fn prompt(resume: &Value, target: &Value) -> Value {
    let c = company(target);
    let mut ids: Vec<_> = source_ids(resume).into_iter().collect();
    ids.sort();
    let mut playable: Vec<_> = data()["playable"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    playable.sort();
    let system=["You write interview-prep questions as strict JSON. No prose outside the JSON object.","RULES:","- Every question.sourceRef MUST be one of the allowed ids listed by the user. Never invent an id.","- Every question.practice.problemId, when present, MUST be one of the allowed catalogue ids. Never invent one.","- Never assert facts about the company hiring process: no percentages, no \"always asks\", no named proprietary rounds, no interviewer names, no compensation figures, no guaranteed outcomes.","- question.listeningFor must describe what an interviewer listens for in plain terms, grounded in the company values given.","- question.difficulty MUST be exactly easy, medium, or hard.","- question.type MUST be exactly behavioral, coding, concepts, system-design, resume-deep-dive, or ml.","- question.practice, when present, is an object with only problemId.","- Keep each prompt under 800 characters."].join("\n");
    let values = array(&c, "values")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("; ");
    let axes = array(&c, "hiringAxes")
        .iter()
        .map(|a| {
            format!(
                "{} ({})",
                string(a, "label"),
                array(a, "categories")
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("/")
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let rounds = array(&c, "rounds")
        .iter()
        .map(|r| format!("{}: {}", string(r, "name"), string(r, "focus")))
        .collect::<Vec<_>>()
        .join("; ");
    let focus = array(target, "focusAreas")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    let user=[format!("GOAL: {}",string(target,"goal")),format!("COMPANY: {}",string(&c,"label")),format!("VALUES: {}",if values.is_empty(){"none listed"}else{&values}),format!("HIRING AXES: {axes}"),format!("ROUNDS: {}",if rounds.is_empty(){"standard screen + onsite"}else{&rounds}),format!("SENIORITY: {}",string(target,"seniority")),format!("FOCUS AREAS: {}",if focus.is_empty(){"general"}else{&focus}),String::new(),"CANDIDATE (only facts you may reference):".into(),resume_to_text(resume,4000),String::new(),format!("ALLOWED sourceRef ids: {}",ids.join(", ")),format!("ALLOWED practice.problemId values: {}",playable.join(", ")),String::new(),"Return a JSON object with exactly this shape:".into(),"{ \"version\": 1, \"target\": {goal, companyId, customCompany, seniority, focusAreas}, \"questions\": [{id, type, prompt, whyItFits, sourceRef, difficulty, followUps, listeningFor, practice?}], \"generatedBy\": \"model\" }".into(),format!("The target object must equal: {target}"),"Write 8 questions covering: 2 resume-deep-dive, 3 coding (each with a practice.problemId), 1 behavioral, and 2 from concepts/system-design/ml matching the hiring axes.".into()].join("\n");
    json!([{"role":"system","content":system},{"role":"user","content":user}])
}
pub async fn generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let (owner, _) = auth::resolve(&state, &headers).await?;
    if !state
        .rates
        .lock()
        .map_err(ApiError::internal)?
        .check_window(
            format!("interview:{owner}"),
            20,
            Duration::from_secs(3600),
            Instant::now(),
        )
    {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many interview kits. Try again later.".into(),
        ));
    }
    let input=match contracts::parse("InterviewGenerate",serde_json::from_slice(&body).unwrap_or_else(|_|json!({}))){Ok(v)=>v,Err(e)=>return Ok((StatusCode::BAD_REQUEST,Json(json!({"error":{"code":"BAD_REQUEST","message":"Invalid interview request","details":e}}))).into_response())};
    let user = owner.clone();
    let requested = input.get("target").cloned();
    let (resume,target)=state.db.call(move|db| {
  let resume=account::read_profile(db,&user,"resume")?;
  let target=match requested {Some(v)=>{
   db.execute("INSERT INTO targets(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at",params![user,v.to_string(),now_ms()]).map_err(ApiError::internal)?;v
  },None=>account::read_profile(db,&user,"target")?};Ok((resume,target))
 }).await?;
    if target.is_null() {
        return Ok((StatusCode::BAD_REQUEST,Json(json!({"error":{"code":"BAD_REQUEST","message":"Set your goal and target company first.","details":{"missing":"target"}}}))).into_response());
    }
    let seed = input["seed"]
        .as_f64()
        .unwrap_or((now_ms() % 2147483648) as f64);
    let mut notes = Vec::new();
    let mut model_kit = None;
    let mut used_tier = "template";
    if let Some(id) = state.transport.chat_id() {
        match state
            .transport
            .chat(prompt(&resume, &target), 4000, 0.7)
            .await
        {
            Ok(text) => {
                if let Some(raw) = text::extract_json(&text) {
                    match validate(raw, &resume) {
                        Ok(mut kit) => {
                            kit["generatedBy"] = json!(id);
                            model_kit = Some(kit);
                            used_tier = id;
                        }
                        Err(issues) => notes.push(format!(
                            "model kit rejected ({}); used deterministic template",
                            issues.into_iter().take(3).collect::<Vec<_>>().join("; ")
                        )),
                    }
                } else {
                    notes.push(format!(
                        "transport '{id}' returned non-JSON; used deterministic template"
                    ));
                }
            }
            Err(ChatError::Busy) => return Err(ApiError::busy()),
            Err(error) => notes.push(format!(
                "model call failed ({}); used deterministic template",
                text::slice(&error.to_string(), 200)
            )),
        }
    } else {
        notes.push("no model transport configured; used deterministic template".into());
    }
    let kit = match model_kit {
        Some(v) => v,
        None => template(
            &resume,
            &target,
            seed,
            input["newAngle"].as_bool().unwrap_or(false),
        )
        .map_err(|_| ApiError::internal("Invalid interview template"))?,
    };
    let questions = kit["questions"].clone();
    state.db.call(move|db| {
  use rand::RngCore;
  let id=format!("kit_{:016x}{:016x}",rand::rngs::OsRng.next_u64(),rand::rngs::OsRng.next_u64());let created=now_ms();
  db.execute("INSERT INTO interview_kits(id,user_id,target_json,questions_json,used_tier,created_at) VALUES(?,?,?,?,?,?)",params![id,owner,target.to_string(),questions.to_string(),used_tier,created]).map_err(ApiError::internal)?;
  Ok(Json(json!({"kitId":id,"target":target,"questions":questions,"usedTier":used_tier,"notes":notes,"createdAt":created})).into_response())
 }).await
}
