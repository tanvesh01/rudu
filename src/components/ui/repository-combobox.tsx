import { Combobox } from "@base-ui/react/combobox";
import {
  CheckIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/20/solid";
import { getOwnerAvatarUrl } from "../../lib/github-owner";

const ALL_REPOSITORIES = "__all_repositories__";

type RepositoryOption = {
  label: string;
  value: string;
};

function RepositoryLabel({ repo }: { repo: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {repo !== ALL_REPOSITORIES ? (
        <img
          alt=""
          className="size-5 shrink-0 rounded-full object-cover"
          loading="lazy"
          src={getOwnerAvatarUrl(repo)}
        />
      ) : null}
      <span className="truncate">
        {repo === ALL_REPOSITORIES ? "All repositories" : repo}
      </span>
    </span>
  );
}

function RepositoryCombobox({
  repositories,
  value,
  onValueChange,
}: {
  repositories: string[];
  value: string;
  onValueChange: (repo: string) => void;
}) {
  const options: RepositoryOption[] = [
    { label: "All repositories", value: ALL_REPOSITORIES },
    ...repositories.map((repo) => ({ label: repo, value: repo })),
  ];
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Combobox.Root
      items={options}
      isItemEqualToValue={(option, selected) => option.value === selected.value}
      onValueChange={(option) => {
        if (option) onValueChange(option.value);
      }}
      value={selectedOption}
    >
      <Combobox.Trigger className="flex h-8 max-w-full items-center gap-1.5 rounded-md px-2 text-sm text-ink-700 outline-none transition hover:bg-canvasDark focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 data-[popup-open]:bg-canvasDark">
        <Combobox.Value>
          {(option: RepositoryOption | null) => (
            <RepositoryLabel repo={option?.value ?? ALL_REPOSITORIES} />
          )}
        </Combobox.Value>
        <ChevronDownIcon className="size-4 shrink-0 text-ink-500" />
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4}>
          <Combobox.Popup className="z-50 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-ink-300 bg-surface text-ink-800 shadow-xl outline-none transition data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <div className="flex items-center gap-2 border-b border-ink-300 px-3">
              <MagnifyingGlassIcon className="size-4 shrink-0 text-ink-500" />
              <Combobox.Input
                aria-label="Search repositories"
                autoFocus
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-500"
                placeholder="Search repositories…"
              />
            </div>
            <Combobox.Empty className="px-3 py-3 text-sm text-ink-500 empty:p-0">
              No repositories found.
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto p-1">
              {(option: RepositoryOption) => (
                <Combobox.Item
                  className="grid cursor-default grid-cols-[minmax(0,1fr)_1rem] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-canvasDark data-[selected]:font-medium"
                  key={option.value}
                  value={option}
                >
                  <RepositoryLabel repo={option.value} />
                  <Combobox.ItemIndicator className="text-ink-700">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export { ALL_REPOSITORIES, RepositoryCombobox };
