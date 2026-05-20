# Research Plan: OSS visibility over ACP with Codex

## Main question

Is there an open-source tool that gives useful observability or visibility over Agent Client Protocol sessions when using Codex ACP?

## Subtopics

1. ACP and Codex ACP native surfaces
   - Confirm what protocol events or logs exist and whether they are enough for app-level visibility.

2. OSS observability tools for LLM/agent traces
   - Look for tools that can show prompts, generations, tool calls, spans, and timelines.

3. Fit for Rudu-style local Tauri ACP integration
   - Decide whether an existing OSS tool can be dropped in, or whether Rudu should emit its own event timeline and optionally export OpenTelemetry.

## Synthesis

Compare protocol-native visibility with general LLM observability stacks. Prefer OSS, local-friendly tooling, and low integration risk.
