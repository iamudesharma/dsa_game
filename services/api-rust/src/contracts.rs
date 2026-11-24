//! Development-time exports of shared schemas. Schema lengths follow the installed Zod's Unicode code-point semantics.
use serde_json::{json, Value};
use std::sync::OnceLock;

fn schemas() -> &'static Value {
    static SCHEMAS: OnceLock<Value> = OnceLock::new();
    SCHEMAS.get_or_init(|| serde_json::from_str(include_str!("../data/contracts.json")).unwrap())
}
pub fn parse(name: &str, mut value: Value) -> Result<Value, Vec<Value>> {
    parse_in_place(name, &mut value)?;
    Ok(value)
}
/// Validate a mutable native record without copying its complete board/history.
pub fn parse_in_place(name: &str, value: &mut Value) -> Result<(), Vec<Value>> {
    let schemas = schemas();
    let mut issues = Vec::new();
    validate(&schemas[name], value, &mut Vec::new(), &mut issues);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}
fn validate(s: &Value, v: &mut Value, path: &mut Vec<Value>, issues: &mut Vec<Value>) {
    if let Some(variants) = s["oneOf"].as_array() {
        if variants
            .iter()
            .all(|s| s["properties"]["type"].get("const").is_some())
        {
            if !v.is_object() {
                issues.push(json!({"code":"invalid_type","expected":"object","path":path,"message":format!("Invalid input: expected object, received {}",if v.is_null(){"null"}else if v.is_array(){"array"}else if v.is_string(){"string"}else if v.is_boolean(){"boolean"}else{"number"})}));
                return;
            }
            if let Some(variant) = variants
                .iter()
                .find(|s| s["properties"]["type"]["const"] == v["type"])
            {
                validate(variant, v, path, issues);
                return;
            }
            let options: Vec<_> = variants
                .iter()
                .map(|s| s["properties"]["type"]["const"].clone())
                .collect();
            let mut at = path.clone();
            at.push(json!("type"));
            issues.push(json!({"code":"invalid_union","errors":[],"note":"No matching discriminator","discriminator":"type","options":options,"path":at,"message":format!("Invalid discriminator value. Expected {}",options.iter().map(|v|format!("'{}'",v.as_str().unwrap())).collect::<Vec<_>>().join(" | "))}));
            return;
        }
        let mut union_errors = Vec::new();
        for variant in variants {
            let mut candidate = v.clone();
            let mut errors = Vec::new();
            validate(variant, &mut candidate, path, &mut errors);
            if errors.is_empty() {
                *v = candidate;
                return;
            }
            union_errors.push(errors);
        }
        issues.push(json!({"code":"invalid_union","errors":union_errors,"path":path,"message":"Invalid input"}));
        return;
    }
    if let Some(choices) = s["enum"].as_array() {
        if !choices.contains(v) {
            issues.push(json!({"code":"invalid_value","values":choices,"path":path,"message":format!("Invalid option: expected one of {}", choices.iter().map(Value::to_string).collect::<Vec<_>>().join("|"))}));
        }
        return;
    }
    if let Some(expected) = s.get("const") {
        if expected != v {
            issues.push(json!({"code":"invalid_value","values":[expected],"path":path,"message":format!("Invalid input: expected {expected}")}));
        }
        return;
    }
    let kind = s["type"].as_str().unwrap_or("");
    let expected_kind = if kind == "object" && s["propertyNames"].is_object() {
        "record"
    } else if kind == "integer" {
        if v.is_number() {
            "int"
        } else {
            "number"
        }
    } else {
        kind
    };
    let matches = match kind {
        "object" => v.is_object(),
        "array" => v.is_array(),
        "string" => v.is_string(),
        "number" => v.is_number(),
        "integer" => v.as_f64().is_some_and(|n| n.fract() == 0.0),
        "boolean" => v.is_boolean(),
        "null" => v.is_null(),
        "" => true,
        _ => false,
    };
    if !matches {
        let received = if v.is_null() {
            "null"
        } else if v.is_array() {
            "array"
        } else if v.is_object() {
            "object"
        } else if v.is_boolean() {
            "boolean"
        } else if v.is_string() {
            "string"
        } else {
            "number"
        };
        if kind == "integer" && v.is_number() {
            issues.push(json!({"expected":"int","format":"safeint","code":"invalid_type","path":path,"message":"Invalid input: expected int, received number"}));
        } else {
            issues.push(json!({"expected":expected_kind,"code":"invalid_type","path":path,"message":format!("Invalid input: expected {expected_kind}, received {received}")}));
        }
        return;
    }
    let measure = match kind {
        "string" => v.as_str().map(|t| t.chars().count() as f64),
        "array" => v.as_array().map(|a| a.len() as f64),
        "number" | "integer" => v.as_f64(),
        _ => None,
    };
    if let Some(size) = measure {
        for (key, too_small) in [
            (
                if kind == "string" {
                    "minLength"
                } else if kind == "array" {
                    "minItems"
                } else {
                    "minimum"
                },
                true,
            ),
            (
                if kind == "string" {
                    "maxLength"
                } else if kind == "array" {
                    "maxItems"
                } else {
                    "maximum"
                },
                false,
            ),
        ] {
            if let Some(bound) = s[key].as_f64() {
                if (too_small && size < bound) || (!too_small && size > bound) {
                    let code = if too_small { "too_small" } else { "too_big" };
                    let adjective = if too_small { "small" } else { "big" };
                    let verb = if too_small { ">=" } else { "<=" };
                    let unit = if kind == "string" {
                        " characters"
                    } else if kind == "array" {
                        " items"
                    } else {
                        ""
                    };
                    let safe_int = kind == "integer" && bound.abs() == 9007199254740991.0;
                    let origin = if safe_int {
                        "int"
                    } else if kind == "integer" {
                        "number"
                    } else {
                        kind
                    };
                    if safe_int {
                        issues.push(json!({"code":code,(if too_small {"minimum"}else{"maximum"}):s[key],"note":"Integers must be within the safe integer range.","origin":"int","inclusive":true,"path":path,"message":format!("Too {adjective}: expected int to be {verb}{bound}")}));
                        continue;
                    }
                    let issue = json!({"origin":origin,"code":code,(if too_small {"minimum"}else{"maximum"}):s[key].clone(),"inclusive":true,"path":path,"message":format!("Too {adjective}: expected {} to {} {verb}{bound}{unit}",if kind=="integer" {"number"}else{kind},if matches!(kind,"number"|"integer") {"be"}else{"have"})});
                    issues.push(issue);
                }
            }
        }
    }
    if let Some(object) = v.as_object_mut() {
        if let Some(properties) = s["properties"].as_object() {
            for (key, schema) in properties {
                if !object.contains_key(key) {
                    if let Some(default) = schema.get("default") {
                        object.insert(key.clone(), default.clone());
                    } else if s["required"]
                        .as_array()
                        .is_some_and(|r| r.contains(&json!(key)))
                    {
                        let expected =
                            if schema["type"] == "object" && schema["propertyNames"].is_object() {
                                "record"
                            } else if schema["type"] == "integer" {
                                "number"
                            } else if schema["oneOf"]
                                .as_array()
                                .is_some_and(|a| a.iter().all(|s| s["type"] == "object"))
                            {
                                "object"
                            } else {
                                schema["type"].as_str().unwrap_or("unknown")
                            };
                        let mut at = path.clone();
                        at.push(json!(key));
                        if schema["enum"].is_array() || schema.get("const").is_some() {
                            validate(schema, &mut Value::Null, &mut at, issues);
                        } else {
                            issues.push(json!({"expected":expected,"code":"invalid_type","path":at,"message":format!("Invalid input: expected {expected}, received undefined")}));
                        }
                    }
                }
                if let Some(value) = object.get_mut(key) {
                    path.push(json!(key));
                    validate(schema, value, path, issues);
                    path.pop();
                }
            }
        }
        let extras: Vec<_> = object
            .keys()
            .filter(|key| s["properties"].get(*key).is_none())
            .cloned()
            .collect();
        // Zod's ordinary object strips unknown fields. Its input JSON Schema
        // omits additionalProperties; strict objects explicitly emit false.
        if s["properties"].is_object() && s.get("additionalProperties").is_none() {
            for key in &extras {
                object.remove(key);
            }
        }
        if s["additionalProperties"] == false && !extras.is_empty() {
            issues.push(json!({"code":"unrecognized_keys","keys":extras,"path":path,"message":format!("Unrecognized key{}: {}",if extras.len()==1 {""}else{"s"},extras.iter().map(|s|format!("\"{s}\"")).collect::<Vec<_>>().join(", "))}));
        } else {
            for key in extras {
                if s["propertyNames"].is_object() {
                    let mut name = json!(key);
                    let mut key_issues = Vec::new();
                    validate(
                        &s["propertyNames"],
                        &mut name,
                        &mut Vec::new(),
                        &mut key_issues,
                    );
                    if !key_issues.is_empty() {
                        let mut at = path.clone();
                        at.push(json!(key));
                        issues.push(json!({"code":"invalid_key","origin":"record","issues":key_issues,"path":at,"message":"Invalid key in record"}));
                        continue;
                    }
                }
                if s["additionalProperties"].is_object() {
                    path.push(json!(key));
                    validate(
                        &s["additionalProperties"],
                        object.get_mut(&key).unwrap(),
                        path,
                        issues,
                    );
                    path.pop();
                }
            }
        }
    }
    if let Some(array) = v.as_array_mut() {
        for (index, value) in array.iter_mut().enumerate() {
            path.push(json!(index));
            validate(&s["items"], value, path, issues);
            path.pop();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_strictness_and_unicode() {
        assert_eq!(parse("Resume", json!({})).unwrap(), crate::empty_resume());
        assert!(parse("Resume", json!({"extra":true})).is_err());
        assert!(parse("Resume", json!({"contact":{"name":"😀".repeat(121)}})).is_err());
        assert!(parse("Target", json!({"goal":"learn","companyId":"custom"})).is_ok());
        assert!(parse("Target", json!({"goal":"learn"})).is_err());
    }
}

#[cfg(test)]
mod schema_coverage {
    use super::*;
    fn check(schema: &Value) {
        let allowed = [
            "$schema",
            "type",
            "properties",
            "additionalProperties",
            "propertyNames",
            "required",
            "items",
            "minItems",
            "maxItems",
            "minLength",
            "maxLength",
            "minimum",
            "maximum",
            "enum",
            "const",
            "default",
            "oneOf",
        ];
        for key in schema.as_object().unwrap().keys() {
            assert!(
                allowed.contains(&key.as_str()),
                "Unsupported schema keyword: {key}"
            );
        }
        if let Some(properties) = schema["properties"].as_object() {
            for child in properties.values() {
                check(child);
            }
        }
        for key in ["items", "additionalProperties", "propertyNames"] {
            if schema[key].is_object() {
                check(&schema[key]);
            }
        }
        if let Some(variants) = schema["oneOf"].as_array() {
            for child in variants {
                check(child);
            }
        }
    }
    #[test]
    fn exported_schemas_use_only_implemented_keywords() {
        let schemas: Value = serde_json::from_str(include_str!("../data/contracts.json")).unwrap();
        for schema in schemas.as_object().unwrap().values() {
            check(schema);
        }
    }
}
