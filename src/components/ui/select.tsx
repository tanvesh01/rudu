import { Select as BaseSelect } from "@base-ui/react/select";
import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "./tooltip";

type UiSelectOption = {
  disabled?: boolean;
  label: ReactNode;
  textValue?: string;
  triggerLabel?: ReactNode;
  value: string;
};

type UiSelectGroup = {
  label: ReactNode;
  options: UiSelectOption[];
};

type UiSelectProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  groups?: UiSelectGroup[];
  label?: ReactNode;
  options?: UiSelectOption[];
  placeholder?: ReactNode;
  tooltipContent?: ReactNode;
  value: string | null;
  onValueChange(value: string): void;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function UiSelect({
  ariaLabel,
  className,
  disabled = false,
  groups,
  label,
  options,
  placeholder = "Select",
  tooltipContent,
  value,
  onValueChange,
}: UiSelectProps) {
  const optionGroups = groups ?? (options ? [{ label: null, options }] : []);
  const selectedOption = optionGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === value);

  return (
    <div
      className={cx(
        "inline-flex max-w-52 shrink-0 items-center gap-1 text-xs font-medium text-ink-600 dark:text-white/70",
        className,
      )}
    >
      {label ? (
        <span className="pl-1 text-[11px] uppercase text-ink-400">
          {label}
        </span>
      ) : null}
      <BaseSelect.Root
        disabled={disabled}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string" && nextValue) {
            onValueChange(nextValue);
          }
        }}
        value={value || null}
      >
        <SelectTriggerTooltip content={tooltipContent}>
          <BaseSelect.Trigger
            aria-label={ariaLabel}
            className="inline-flex h-7 min-w-0 max-w-40 items-center justify-center gap-1 rounded-full border-0 bg-transparent px-2 text-xs font-medium leading-none text-ink-800 outline-none transition hover:bg-white/70 hover:text-ink-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 data-[popup-open]:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:text-white/85 dark:hover:bg-white/10 dark:hover:text-white dark:data-[popup-open]:bg-white/10 [&_*]:text-xs"
          >
            <BaseSelect.Value
              className="flex min-w-0 items-center truncate leading-none"
              placeholder={placeholder}
            >
              {() => (
                <span className="flex min-w-0 items-center truncate leading-none">
                  {selectedOption?.triggerLabel ??
                    selectedOption?.label ??
                    placeholder}
                </span>
              )}
            </BaseSelect.Value>
            <BaseSelect.Icon className="flex shrink-0 items-center text-ink-400 transition data-[open]:rotate-180 dark:text-white/50">
              <ChevronDownIcon aria-hidden="true" className="size-3.5" />
            </BaseSelect.Icon>
          </BaseSelect.Trigger>
        </SelectTriggerTooltip>
        <BaseSelect.Portal>
          <BaseSelect.Positioner align="start" sideOffset={8}>
            <BaseSelect.Popup className="z-50 max-h-80 w-72 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-ink-200 bg-surface text-sm text-ink-800 shadow-xl outline-none transition duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 dark:border-white/10 dark:bg-[#1b1d1b] dark:text-white">
              <BaseSelect.List className="max-h-80 overflow-y-auto p-1">
                {optionGroups.map((group, groupIndex) => (
                  <BaseSelect.Group key={groupIndex}>
                    {group.label ? (
                      <BaseSelect.GroupLabel className="flex items-center gap-2 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-normal text-ink-400 dark:text-white/40">
                        {group.label}
                      </BaseSelect.GroupLabel>
                    ) : null}
                    {group.options.map((option) => (
                      <BaseSelect.Item
                        className="grid cursor-default select-none grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1 text-xs outline-none data-[highlighted]:bg-canvasDark data-[highlighted]:text-ink-950 data-[selected]:font-medium dark:data-[highlighted]:bg-white/10 dark:data-[highlighted]:text-white"
                        disabled={option.disabled}
                        key={option.value}
                        label={option.textValue}
                        value={option.value}
                      >
                        <BaseSelect.ItemIndicator
                          className="invisible flex items-center justify-center text-ink-700 data-[selected]:visible dark:text-white"
                          keepMounted
                        >
                          <CheckIcon aria-hidden="true" className="size-3" />
                        </BaseSelect.ItemIndicator>
                        <span className="min-w-0 truncate">{option.label}</span>
                      </BaseSelect.Item>
                    ))}
                  </BaseSelect.Group>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}

function SelectTriggerTooltip({
  children,
  content,
}: {
  children: ReactElement;
  content?: ReactNode;
}) {
  if (!content) return children;
  return <Tooltip content={content}>{children}</Tooltip>;
}

type SelectIconProps = {
  "aria-hidden"?: "true";
  className?: string;
};

function ChevronDownIcon(props: SelectIconProps) {
  return (
    <svg
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

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

export { UiSelect };
export type { UiSelectGroup, UiSelectOption };
