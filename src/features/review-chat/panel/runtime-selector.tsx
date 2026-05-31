import { Select as BaseSelect } from "@base-ui/react/select";
import { ModelProviderLogo } from "../../../components/ui/model-provider-logo";
import type { ReviewChatRuntimeKind } from "../../../types/github";

const RUNTIME_OPTIONS: Array<{
  value: ReviewChatRuntimeKind;
  label: string;
  providerId: string;
}> = [
  { value: "codex", label: "Codex", providerId: "openai" },
  { value: "open_code", label: "OpenCode", providerId: "opencode" },
];

type ReviewRuntimeSelectorProps = {
  className?: string;
  disabled?: boolean;
  value: ReviewChatRuntimeKind;
  onValueChange(value: ReviewChatRuntimeKind): void;
};

function ReviewRuntimeSelector({
  className,
  disabled = false,
  value,
  onValueChange,
}: ReviewRuntimeSelectorProps) {
  const selectedOption =
    RUNTIME_OPTIONS.find((option) => option.value === value) ??
    RUNTIME_OPTIONS[0];
  const triggerLogoClassName =
    selectedOption.value === "open_code"
      ? "size-2.5 invert dark:invert-0"
      : "size-3.5";

  return (
    <BaseSelect.Root
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string" && nextValue) {
          onValueChange(nextValue as ReviewChatRuntimeKind);
        }
      }}
      value={value}
    >
      <BaseSelect.Trigger
        aria-label="Review Chat runtime"
        className={[
          "relative z-30 box-border inline-flex h-6 w-6 min-w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#211e1e] p-0 leading-none text-[#cfcecd] shadow-sm outline-none transition hover:border-black/20 hover:bg-[#2a2727] hover:text-white hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 data-[popup-open]:border-black/20 data-[popup-open]:bg-[#2a2727] data-[popup-open]:text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/80 dark:bg-white dark:text-[#211e1e] dark:hover:border-white dark:hover:bg-white dark:hover:text-black dark:data-[popup-open]:border-white dark:data-[popup-open]:bg-white dark:data-[popup-open]:text-black",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        title={`Runtime: ${selectedOption.label}`}
      >
        <BaseSelect.Value className="grid h-full w-full place-items-center leading-none">
          {() => (
            <ModelProviderLogo
              className={`block ${triggerLogoClassName} [&_svg]:block`}
              providerId={selectedOption.providerId}
            />
          )}
        </BaseSelect.Value>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner align="end" className="z-[100]" sideOffset={8}>
          <BaseSelect.Popup className="w-44 origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-ink-200 bg-surface p-1 text-sm text-ink-800 shadow-xl outline-none transition duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 dark:border-white/10 dark:bg-[#1b1d1b] dark:text-white">
            {RUNTIME_OPTIONS.map((option) => (
              <BaseSelect.Item
                className="grid cursor-default select-none grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-canvasDark data-[highlighted]:text-ink-950 data-[selected]:font-medium dark:data-[highlighted]:bg-white/10 dark:data-[highlighted]:text-white"
                key={option.value}
                label={option.label}
                value={option.value}
              >
                <BaseSelect.ItemIndicator
                  className="invisible flex items-center justify-center text-ink-700 data-[selected]:visible dark:text-white"
                  keepMounted
                >
                  <CheckIcon aria-hidden="true" className="size-3" />
                </BaseSelect.ItemIndicator>
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <ModelProviderLogo
                    className={
                      option.value === "open_code"
                        ? "size-4 dark:invert"
                        : "size-4"
                    }
                    providerId={option.providerId}
                  />
                  <span className="truncate">{option.label}</span>
                </span>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

type SelectIconProps = {
  "aria-hidden"?: "true";
  className?: string;
};

function CheckIcon(props: SelectIconProps) {
  return (
    <svg
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M3.5 8.2L6.4 11L12.5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export { ReviewRuntimeSelector };
