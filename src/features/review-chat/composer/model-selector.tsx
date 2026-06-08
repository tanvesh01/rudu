import { UiSelect, type UiSelectGroup } from "@/components/ui/select";
import { ModelProviderLogo } from "@/components/ui/model-provider-logo";
import {
  type ModelProviderCatalog,
  useModelProviderCatalog,
} from "../model-provider-assets";

type RuntimeModelSelectorProps = {
  disabled?: boolean;
  isLoading?: boolean;
  models: string[];
  value: string | null;
  onValueChange(value: string): void;
};

type RuntimeModelOption = {
  provider: string;
  suffix: string;
  value: string;
};

function parseRuntimeModel(model: string): RuntimeModelOption {
  const separatorIndex = model.indexOf("/");

  if (separatorIndex === -1) {
    return {
      provider: "other",
      suffix: model,
      value: model,
    };
  }

  return {
    provider: model.slice(0, separatorIndex),
    suffix: model.slice(separatorIndex + 1),
    value: model,
  };
}

function groupRuntimeModels(
  models: string[],
  modelNames: ModelProviderCatalog | null,
): UiSelectGroup[] {
  const groups = new Map<string, RuntimeModelOption[]>();

  for (const model of models) {
    const option = parseRuntimeModel(model);
    const options = groups.get(option.provider) ?? [];
    options.push(option);
    groups.set(option.provider, options);
  }

  return Array.from(groups, ([provider, options]) => ({
    label: (
      <>
        <ModelProviderLogo
          className="size-3.5 text-ink-400 dark:text-white/40"
          providerId={provider}
        />
        <span className="shrink-0">
          {modelNames?.[provider]?.name ?? humanizeId(provider)}
        </span>
        <span className="h-px flex-1 bg-ink-200 dark:bg-white/10" />
      </>
    ),
    options: options.map((option) => {
      const label = getModelDisplayName(option, modelNames);

      return {
        label: (
          <span className="inline-flex min-w-0 items-center gap-2">
            <ModelProviderLogo
              className="size-3.5 text-ink-500 dark:text-white/55"
              providerId={option.provider}
            />
            <span className="truncate">{label}</span>
          </span>
        ),
        textValue: label,
        triggerLabel: (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ModelProviderLogo
              className="size-3 text-ink-500 dark:text-white/55"
              providerId={option.provider}
            />
            <span className="truncate">{label}</span>
          </span>
        ),
        value: option.value,
      };
    }),
  }));
}

function RuntimeModelSelector({
  disabled = false,
  isLoading = false,
  models,
  value,
  onValueChange,
}: RuntimeModelSelectorProps) {
  const selectedValue = value ?? "";
  const modelNames = useModelProviderCatalog(models.length > 0);
  const groups = groupRuntimeModels(models, modelNames);

  return (
    <UiSelect
      ariaLabel="Runtime model"
      disabled={disabled || isLoading || models.length === 0}
      groups={groups}
      onValueChange={onValueChange}
      placeholder={isLoading ? "Loading models..." : "Select model"}
      tooltipContent="Select model"
      value={selectedValue || null}
    />
  );
}

function getModelDisplayName(
  option: RuntimeModelOption,
  modelNames: ModelProviderCatalog | null,
) {
  return (
    modelNames?.[option.provider]?.models?.[option.suffix] ??
    humanizeId(option.suffix)
  );
}

function humanizeId(id: string) {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (/^(ai|api|glm|gpt|llm|mcp|mistral|qwen|v\d+)$/.test(part)) {
        return upper;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export { RuntimeModelSelector };
