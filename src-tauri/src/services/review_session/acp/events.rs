use agent_client_protocol::schema::{ContentBlock, ContentChunk, SessionUpdate};
use serde::Serialize;

use crate::services::review_session::{ReviewChatAcpPlanEntry, ReviewChatEvent};

pub(super) fn chat_event_from_update(
    rudu_session_id: &str,
    turn_id: &str,
    update: SessionUpdate,
) -> Option<ReviewChatEvent> {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(ReviewChatEvent::Message {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::AgentThoughtChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => Some(ReviewChatEvent::Thought {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            text: text.text,
        }),
        SessionUpdate::ToolCall(tool_call) => Some(ReviewChatEvent::Tool {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call.tool_call_id.to_string(),
            title: Some(tool_call.title),
            status: Some(serialized_name(&tool_call.status)),
            raw_input: tool_call.raw_input,
            raw_output: tool_call.raw_output,
        }),
        SessionUpdate::ToolCallUpdate(tool_call) => Some(ReviewChatEvent::Tool {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            tool_call_id: tool_call.tool_call_id.to_string(),
            title: tool_call.fields.title,
            status: tool_call
                .fields
                .status
                .map(|status| serialized_name(&status)),
            raw_input: tool_call.fields.raw_input,
            raw_output: tool_call.fields.raw_output,
        }),
        SessionUpdate::Plan(plan) => Some(ReviewChatEvent::Plan {
            session_id: rudu_session_id.to_string(),
            turn_id: turn_id.to_string(),
            entries: plan_entries(&plan),
        }),
        _ => None,
    }
}

pub(super) fn serialized_name<T>(value: &T) -> String
where
    T: Serialize + std::fmt::Debug,
{
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{value:?}"))
}

fn plan_entries(plan: &agent_client_protocol::schema::Plan) -> Vec<ReviewChatAcpPlanEntry> {
    plan.entries
        .iter()
        .map(|entry| ReviewChatAcpPlanEntry {
            content: entry.content.clone(),
            priority: serialized_name(&entry.priority),
            status: serialized_name(&entry.status),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{chat_event_from_update, serialized_name};
    use crate::services::review_session::{ReviewChatAcpPlanEntry, ReviewChatEvent};
    use agent_client_protocol::schema::{SessionNotification, StopReason};
    use serde_json::json;

    #[test]
    fn translates_chat_tool_updates_with_raw_io() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","title":"Read file","status":"completed","rawInput":{"path":"src/lib.rs"},"rawOutput":"ok"}}"#,
        );

        assert_eq!(
            event,
            Some(ReviewChatEvent::Tool {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                tool_call_id: "call-1".to_string(),
                title: Some("Read file".to_string()),
                status: Some("completed".to_string()),
                raw_input: Some(json!({ "path": "src/lib.rs" })),
                raw_output: Some(json!("ok")),
            })
        );
    }

    #[test]
    fn translates_chat_plan_as_structured_entries() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"plan","entries":[{"content":"Read diff","priority":"high","status":"completed"},{"content":"Inspect file","priority":"medium","status":"in_progress"}]}}"#,
        );

        assert_eq!(
            event,
            Some(ReviewChatEvent::Plan {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                entries: vec![
                    ReviewChatAcpPlanEntry {
                        content: "Read diff".to_string(),
                        priority: "high".to_string(),
                        status: "completed".to_string(),
                    },
                    ReviewChatAcpPlanEntry {
                        content: "Inspect file".to_string(),
                        priority: "medium".to_string(),
                        status: "in_progress".to_string(),
                    },
                ],
            })
        );
    }

    #[test]
    fn serializes_stop_reasons_with_acp_wire_names() {
        assert_eq!(serialized_name(&StopReason::EndTurn), "end_turn");
        assert_eq!(serialized_name(&StopReason::Cancelled), "cancelled");
    }

    #[test]
    fn ignores_unsupported_typed_updates() {
        let event = chat_event_from_json(
            r#"{"sessionId":"acp-1","update":{"sessionUpdate":"available_commands_update","availableCommands":[]}}"#,
        );

        assert_eq!(event, None);
    }

    #[test]
    fn malformed_acp_json_fails_schema_deserialization() {
        let error = serde_json::from_str::<SessionNotification>("{").unwrap_err();
        assert!(error.to_string().contains("EOF"));
    }

    fn chat_event_from_json(json: &str) -> Option<ReviewChatEvent> {
        let notification: SessionNotification = serde_json::from_str(json).unwrap();
        chat_event_from_update("session-1", "turn-1", notification.update)
    }
}
