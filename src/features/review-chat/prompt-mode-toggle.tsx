import { Tabs } from "@base-ui/react/tabs";
import { type ComponentProps, type ReactElement } from "react";

type ReviewChatEffortMode = "fast" | "deep";

type PromptModeIconProps = ComponentProps<"svg"> & {
  active?: boolean;
};

type PromptModeOption = {
  value: ReviewChatEffortMode;
  label: string;
  Icon: (props: PromptModeIconProps) => ReactElement;
};

const PROMPT_MODE_OPTIONS: PromptModeOption[] = [
  {
    value: "fast",
    label: "Fast mode",
    Icon: LightningIcon,
  },
  {
    value: "deep",
    label: "Deep mode",
    Icon: ProcessorIcon,
  },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type PromptModeToggleProps = {
  className?: string;
  disabled?: boolean;
  pendingValue?: ReviewChatEffortMode | null;
  value: ReviewChatEffortMode;
  onValueChange(value: ReviewChatEffortMode): void;
};

function PromptModeToggle({
  className,
  disabled = false,
  pendingValue = null,
  value,
  onValueChange,
}: PromptModeToggleProps) {
  const selectedValue = pendingValue ?? value;

  return (
    <Tabs.Root
      aria-label="Prompt mode"
      className={cx("inline-flex shrink-0", className)}
      onValueChange={(nextValue) =>
        onValueChange(nextValue as ReviewChatEffortMode)
      }
      value={selectedValue}
    >
      <Tabs.List className="inline-flex h-11 items-center gap-1 rounded-full bg-[#1b1d1b] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {PROMPT_MODE_OPTIONS.map(({ value: optionValue, label, Icon }) => (
          <Tabs.Tab
            aria-label={label}
            className="inline-flex size-9 items-center justify-center rounded-full border-0 bg-transparent text-white/70 outline-none transition duration-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-50 data-[active]:bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.3)_0%,rgba(255,255,255,0.13)_32%,rgba(255,255,255,0.05)_62%,rgba(255,255,255,0.02)_100%)] data-[active]:text-white data-[active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            disabled={disabled}
            key={optionValue}
            title={
              pendingValue === optionValue
                ? `${label} will apply to the next turn`
                : label
            }
            value={optionValue}
          >
            <Icon
              active={selectedValue === optionValue}
              aria-hidden="true"
              className="size-4"
            />
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

function ProcessorIcon({ active = false, ...props }: PromptModeIconProps) {
  if (active) {
    return (
      <svg
        fill="none"
        viewBox="0 0 35 35"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path
          d="M10.375 0.75V3.5M3.5 10.375H0.75M33.75 10.375H31M3.5 17.25H0.75M33.75 17.25H31M3.5 24.125H0.75M33.75 24.125H31M10.375 31V33.75M17.25 0.75V3.5M17.25 31V33.75M24.125 0.75V3.5M24.125 31V33.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path
          d="M7.625 31H26.875C27.969 31 29.0182 30.5654 29.7918 29.7918C30.5654 29.0182 31 27.969 31 26.875V7.625C31 6.53098 30.5654 5.48177 29.7918 4.70818C29.0182 3.9346 27.969 3.5 26.875 3.5H7.625C6.53098 3.5 5.48177 3.9346 4.70818 4.70818C3.9346 5.48177 3.5 6.53098 3.5 7.625V26.875C3.5 27.969 3.9346 29.0182 4.70818 29.7918C5.48177 30.5654 6.53098 31 7.625 31Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M9 9H25.5V25.5H9V9Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      fill="none"
      viewBox="0 0 35 35"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M10.375 0.75V3.5M3.5 10.375H0.75M33.75 10.375H31M3.5 17.25H0.75M33.75 17.25H31M3.5 24.125H0.75M33.75 24.125H31M10.375 31V33.75M17.25 0.75V3.5M17.25 31V33.75M24.125 0.75V3.5M24.125 31V33.75M7.625 31H26.875C27.969 31 29.0182 30.5654 29.7918 29.7918C30.5654 29.0182 31 27.969 31 26.875V7.625C31 6.53098 30.5654 5.48177 29.7918 4.70818C29.0182 3.9346 27.969 3.5 26.875 3.5H7.625C6.53098 3.5 5.48177 3.9346 4.70818 4.70818C3.9346 5.48177 3.5 6.53098 3.5 7.625V26.875C3.5 27.969 3.9346 29.0182 4.70818 29.7918C5.48177 30.5654 6.53098 31 7.625 31ZM9 9H25.5V25.5H9V9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function LightningIcon({ active = false, ...props }: PromptModeIconProps) {
  return (
    <svg
      fill="none"
      viewBox="0 0 30 35"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        clipRule="evenodd"
        d="M19.3583 0.158097C19.6023 0.293925 19.7938 0.507565 19.9022 0.764937C20.0107 1.02231 20.0298 1.30858 19.9566 1.5781L16.6366 13.7498H28.7499C28.9935 13.7498 29.2318 13.821 29.4355 13.9546C29.6392 14.0882 29.7994 14.2784 29.8964 14.5019C29.9934 14.7253 30.0231 14.9723 29.9816 15.2123C29.9402 15.4524 29.8296 15.6751 29.6633 15.8531L12.1633 34.6031C11.9726 34.8078 11.7189 34.9426 11.4426 34.986C11.1664 35.0294 10.8835 34.979 10.6393 34.8427C10.3951 34.7064 10.2036 34.4921 10.0956 34.2341C9.98753 33.9762 9.9691 33.6894 10.0433 33.4198L13.3633 21.2498H1.24992C1.00632 21.2497 0.76803 21.1786 0.564346 21.0449C0.360661 20.9113 0.200459 20.7211 0.103432 20.4976C0.00640527 20.2742 -0.0232179 20.0273 0.0182044 19.7872C0.0596267 19.5472 0.170289 19.3244 0.336588 19.1464L17.8366 0.39643C18.0272 0.192507 18.2806 0.0582513 18.5564 0.0150579C18.8321 -0.0281356 19.1144 0.0222189 19.3583 0.158097Z"
        fill={active ? "currentColor" : "none"}
        fillRule="evenodd"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={active ? 1.5 : 3}
      />
    </svg>
  );
}

export { PromptModeToggle };
export type { ReviewChatEffortMode };
