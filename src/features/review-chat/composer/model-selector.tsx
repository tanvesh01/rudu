import { UiSelect, type UiSelectGroup } from "@/components/ui/select";
import { ModelProviderLogo } from "@/components/ui/model-provider-logo";

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
  suffixCounts: Map<string, number>,
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
      <span className="inline-flex items-center gap-1.5">
        <ModelProviderLogo className="size-3 text-current" providerId={provider} />
        {provider}
      </span>
    ),
    options: options.map((option) => {
      const hasDuplicateSuffix = (suffixCounts.get(option.suffix) ?? 0) > 1;
      const label = hasDuplicateSuffix
        ? `${option.suffix} (${option.provider})`
        : option.suffix;

      return {
        label,
        textValue: label,
        triggerLabel: `${option.provider} / ${option.suffix}`,
        value: option.value,
      };
    }),
  }));
}

function countSuffixes(models: string[]) {
  const counts = new Map<string, number>();

  for (const model of models) {
    const { suffix } = parseRuntimeModel(model);
    counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
  }

  return counts;
}

function RuntimeModelSelector({
  disabled = false,
  isLoading = false,
  models,
  value,
  onValueChange,
}: RuntimeModelSelectorProps) {
  const selectedValue = value ?? "";
  const suffixCounts = countSuffixes(models);
  const groups = groupRuntimeModels(models, suffixCounts);

  return (
    <UiSelect
      ariaLabel="Runtime model"
      disabled={disabled || isLoading || models.length === 0}
      groups={groups}
      label="Model"
      onValueChange={onValueChange}
      placeholder={isLoading ? "Loading models..." : "Select model"}
      value={selectedValue || null}
    />
  );
}

export { RuntimeModelSelector };
