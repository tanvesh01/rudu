import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  LlmProviderInfo,
  LlmSettings,
  SaveLlmSettingsInput,
} from "../types/github";

const llmKeys = {
  all: ["llm"] as const,
  providers: () => [...llmKeys.all, "providers"] as const,
  settings: () => [...llmKeys.all, "settings"] as const,
};

function llmProvidersQueryOptions() {
  return queryOptions({
    queryKey: llmKeys.providers(),
    queryFn: () => invoke<LlmProviderInfo[]>("list_llm_providers"),
    staleTime: Infinity,
  });
}

function llmSettingsQueryOptions() {
  return queryOptions({
    queryKey: llmKeys.settings(),
    queryFn: () => invoke<LlmSettings>("get_llm_settings"),
    staleTime: 30 * 1000,
  });
}

async function saveLlmSettings(settings: SaveLlmSettingsInput) {
  return invoke<LlmSettings>("save_llm_settings", { settings });
}

async function setLlmApiKey(provider: string, apiKey: string) {
  return invoke<LlmSettings>("set_llm_api_key", { provider, apiKey });
}

async function deleteLlmApiKey(provider: string) {
  return invoke<LlmSettings>("delete_llm_api_key", { provider });
}

async function testLlmProvider() {
  await invoke("test_llm_provider");
}

export {
  deleteLlmApiKey,
  llmKeys,
  llmProvidersQueryOptions,
  llmSettingsQueryOptions,
  saveLlmSettings,
  setLlmApiKey,
  testLlmProvider,
};
