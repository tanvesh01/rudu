use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

use crate::cache::{read_llm_settings, write_llm_settings};
use crate::models::{LlmProviderInfo, LlmSettings, SaveLlmSettingsInput};

const KEYCHAIN_SERVICE: &str = "rudu.llm";

#[derive(Clone, Copy)]
enum LlmAdapter {
    OpenAiCompatible,
    Anthropic,
    Google,
}

struct ProviderSpec {
    id: &'static str,
    name: &'static str,
    adapter: LlmAdapter,
    default_model: &'static str,
    default_base_url: Option<&'static str>,
    base_url_required: bool,
}

struct LlmRuntimeSettings {
    provider: String,
    adapter: LlmAdapter,
    model: String,
    base_url: Option<String>,
    api_key: String,
}

const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        id: "openai",
        name: "OpenAI",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "gpt-4.1-mini",
        default_base_url: Some("https://api.openai.com/v1"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "anthropic",
        name: "Anthropic",
        adapter: LlmAdapter::Anthropic,
        default_model: "claude-sonnet-4-5",
        default_base_url: Some("https://api.anthropic.com"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "google",
        name: "Google",
        adapter: LlmAdapter::Google,
        default_model: "gemini-2.5-flash",
        default_base_url: Some("https://generativelanguage.googleapis.com/v1beta"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "openrouter",
        name: "OpenRouter",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "openai/gpt-4.1-mini",
        default_base_url: Some("https://openrouter.ai/api/v1"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "zai",
        name: "Z.ai",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "glm-4.5",
        default_base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "minimax",
        name: "Minimax",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "MiniMax-M1",
        default_base_url: None,
        base_url_required: true,
    },
    ProviderSpec {
        id: "opencode",
        name: "Opencode",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "opencode",
        default_base_url: Some("http://localhost:4096/v1"),
        base_url_required: false,
    },
    ProviderSpec {
        id: "openai_compatible",
        name: "OpenAI-compatible",
        adapter: LlmAdapter::OpenAiCompatible,
        default_model: "",
        default_base_url: None,
        base_url_required: true,
    },
];

pub fn list_provider_infos() -> Vec<LlmProviderInfo> {
    PROVIDERS
        .iter()
        .map(|provider| LlmProviderInfo {
            id: provider.id.to_string(),
            name: provider.name.to_string(),
            adapter: match provider.adapter {
                LlmAdapter::OpenAiCompatible => "openai_compatible",
                LlmAdapter::Anthropic => "anthropic",
                LlmAdapter::Google => "google",
            }
            .to_string(),
            default_model: provider.default_model.to_string(),
            default_base_url: provider.default_base_url.map(str::to_string),
            base_url_required: provider.base_url_required,
        })
        .collect()
}

fn provider_spec(provider_id: &str) -> Result<&'static ProviderSpec, String> {
    let provider_id = provider_id.trim();
    PROVIDERS
        .iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| format!("Unsupported LLM provider: {provider_id}"))
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn default_settings() -> LlmSettings {
    let provider = provider_spec("openai").expect("default provider exists");
    LlmSettings {
        provider: provider.id.to_string(),
        model: provider.default_model.to_string(),
        base_url: provider.default_base_url.map(str::to_string),
        has_api_key: has_api_key(provider.id),
    }
}

fn key_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, provider)
        .map_err(|error| format!("Failed to open secure credential store: {error}"))
}

fn has_api_key(provider: &str) -> bool {
    read_api_key(provider).is_ok()
}

pub fn read_api_key(provider: &str) -> Result<String, String> {
    key_entry(provider)?
        .get_password()
        .map_err(|error| match error {
            KeyringError::NoEntry => format!("No API key saved for {provider}."),
            _ => format!("Failed to read API key for {provider}: {error}"),
        })
}

pub fn save_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let provider = provider_spec(provider)?.id;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is required.".into());
    }

    key_entry(provider)?
        .set_password(api_key)
        .map_err(|error| format!("Failed to save API key for {provider}: {error}"))
}

pub fn delete_api_key(provider: &str) -> Result<(), String> {
    let provider = provider_spec(provider)?.id;
    match key_entry(provider)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete API key for {provider}: {error}")),
    }
}

pub fn load_llm_settings() -> Result<LlmSettings, String> {
    let Some(mut settings) = read_llm_settings()? else {
        return Ok(default_settings());
    };

    let provider = provider_spec(&settings.provider)?;
    if settings.model.trim().is_empty() {
        settings.model = provider.default_model.to_string();
    }
    settings.base_url = trim_optional(settings.base_url).or_else(|| {
        provider
            .default_base_url
            .filter(|_| !provider.base_url_required)
            .map(str::to_string)
    });
    settings.has_api_key = has_api_key(&settings.provider);

    Ok(settings)
}

pub fn save_llm_settings(input: SaveLlmSettingsInput) -> Result<LlmSettings, String> {
    let provider = provider_spec(&input.provider)?;
    let model = input.model.trim();
    let model = if model.is_empty() {
        provider.default_model
    } else {
        model
    };

    if model.is_empty() {
        return Err("Model is required for this provider.".into());
    }

    let base_url = trim_optional(input.base_url).or_else(|| {
        provider
            .default_base_url
            .filter(|_| !provider.base_url_required)
            .map(str::to_string)
    });

    if provider.base_url_required && base_url.is_none() {
        return Err("Base URL is required for this provider.".into());
    }

    let settings = LlmSettings {
        provider: provider.id.to_string(),
        model: model.to_string(),
        base_url,
        has_api_key: has_api_key(provider.id),
    };
    write_llm_settings(&settings)?;

    Ok(settings)
}

fn runtime_settings(settings: &LlmSettings) -> Result<LlmRuntimeSettings, String> {
    let provider = provider_spec(&settings.provider)?;
    let model = settings.model.trim();
    if model.is_empty() {
        return Err("Model is required.".into());
    }

    let base_url = trim_optional(settings.base_url.clone()).or_else(|| {
        provider
            .default_base_url
            .filter(|_| !provider.base_url_required)
            .map(str::to_string)
    });

    if provider.base_url_required && base_url.is_none() {
        return Err("Base URL is required for this provider.".into());
    }

    Ok(LlmRuntimeSettings {
        provider: provider.id.to_string(),
        adapter: provider.adapter,
        model: model.to_string(),
        base_url,
        api_key: read_api_key(provider.id)?,
    })
}

pub fn test_llm_provider(settings: &LlmSettings) -> Result<(), String> {
    let response = complete_json(
        settings,
        "Return only strict JSON.",
        "Return exactly this JSON object: {\"ok\":true}",
        200,
    )?;
    let value = parse_json_response(&response)?;

    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }

    Err("Provider responded, but did not return the expected JSON.".into())
}

pub fn complete_json(
    settings: &LlmSettings,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let runtime = runtime_settings(settings)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Failed to create LLM HTTP client: {error}"))?;

    match runtime.adapter {
        LlmAdapter::OpenAiCompatible => {
            complete_openai_compatible(&client, &runtime, system_prompt, user_prompt, max_tokens)
        }
        LlmAdapter::Anthropic => {
            complete_anthropic(&client, &runtime, system_prompt, user_prompt, max_tokens)
        }
        LlmAdapter::Google => {
            complete_google(&client, &runtime, system_prompt, user_prompt, max_tokens)
        }
    }
}

pub fn parse_json_response(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    let without_fence = if trimmed.starts_with("```") {
        let after_first_line = trimmed
            .find('\n')
            .map(|index| &trimmed[index + 1..])
            .unwrap_or(trimmed);
        after_first_line
            .rfind("```")
            .map(|index| &after_first_line[..index])
            .unwrap_or(after_first_line)
            .trim()
    } else {
        trimmed
    };

    parse_first_json_object(without_fence)
}

fn parse_first_json_object(text: &str) -> Result<Value, String> {
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        return parse_json_object_at(trimmed);
    }

    let mut parse_error = None;

    for (start, _) in text.match_indices('{') {
        match parse_json_object_at(&text[start..]) {
            Ok(value) => return Ok(value),
            Err(error) => parse_error = Some(error),
        }
    }

    match parse_error {
        Some(error) => Err(error),
        None => Err("LLM response did not contain a JSON object.".into()),
    }
}

fn parse_json_object_at(text: &str) -> Result<Value, String> {
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let value = Value::deserialize(&mut deserializer)
        .map_err(|error| format!("Failed to parse LLM JSON response: {error}"))?;

    if value.is_object() {
        Ok(value)
    } else {
        Err("LLM response JSON was not an object.".into())
    }
}

fn response_text(response: reqwest::blocking::Response) -> Result<String, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read LLM response: {error}"))?;

    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("LLM provider returned {status}: {body}"))
    }
}

fn complete_openai_compatible(
    client: &Client,
    settings: &LlmRuntimeSettings,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .as_deref()
        .ok_or_else(|| "Base URL is required for this provider.".to_string())?;
    let url = format!("{base_url}/chat/completions");
    let body = json!({
        "model": &settings.model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens
    });

    let response = client
        .post(url)
        .bearer_auth(&settings.api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Failed to call {}: {error}", settings.provider))?;
    let body = response_text(response)?;
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("Failed to parse provider response: {error}"))?;

    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Provider response did not include message content.".into())
}

fn complete_anthropic(
    client: &Client,
    settings: &LlmRuntimeSettings,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com");
    let url = format!("{base_url}/v1/messages");
    let body = json!({
        "model": &settings.model,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens
    });

    let response = client
        .post(url)
        .header("x-api-key", &settings.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .map_err(|error| format!("Failed to call Anthropic: {error}"))?;
    let body = response_text(response)?;
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("Failed to parse Anthropic response: {error}"))?;

    value
        .pointer("/content/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Anthropic response did not include text content.".into())
}

fn complete_google(
    client: &Client,
    settings: &LlmRuntimeSettings,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let base_url = settings
        .base_url
        .as_deref()
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta");
    let url = format!(
        "{base_url}/models/{}:generateContent?key={}",
        settings.model, settings.api_key
    );
    let body = json!({
        "contents": [
            {
                "role": "user",
                "parts": [
                    { "text": format!("{system_prompt}\n\n{user_prompt}") }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json"
        }
    });

    let response = client
        .post(url)
        .json(&body)
        .send()
        .map_err(|error| format!("Failed to call Google: {error}"))?;
    let body = response_text(response)?;
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("Failed to parse Google response: {error}"))?;

    value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Google response did not include text content.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_with_trailing_text() {
        let value =
            parse_json_response("{\"ok\":true}\nDone.").expect("valid leading JSON should parse");

        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn parses_json_inside_fenced_response_with_trailing_text() {
        let value = parse_json_response("```json\n{\"ok\":true}\n```\nDone.")
            .expect("fenced JSON should parse");

        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn parses_first_json_object_after_preamble() {
        let value = parse_json_response("Here is the result:\n{\"ok\":true}\nThanks.")
            .expect("embedded JSON should parse");

        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
    }
}
