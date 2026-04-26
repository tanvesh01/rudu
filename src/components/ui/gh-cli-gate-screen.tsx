import { ArrowPathIcon } from "@heroicons/react/24/outline";
import type { GhCliStatusKind } from "../../types/github";
import { OuterworldAttribution } from "./outerworld-attribution";

type GhCliGateScreenProps = {
  status: GhCliStatusKind;
  message: string | null;
  isChecking: boolean;
  onCheckAgain: () => void;
};

function GhCliGateScreen({
  status,
  message,
  isChecking,
  onCheckAgain,
}: GhCliGateScreenProps) {
  const isMissingCli = status === "missing_cli";
  const isNotAuthenticated = status === "not_authenticated";
  const ghCliLabel = "gh cli";

  const title = isChecking
    ? <>Checking {ghCliLabel}...</>
    : isMissingCli
      ? <>You need {ghCliLabel}</>
      : isNotAuthenticated
        ? <>{ghCliLabel} is installed, but you are not authenticated.</>
        : <>Couldn't verify {ghCliLabel}.</>;

  const description = isChecking
    ? <>Hold on while we verify your local {ghCliLabel} setup.</>
    : isMissingCli
      ? <>Install {ghCliLabel}, authenticate, then check again.</>
      : isNotAuthenticated
        ? <>Authenticate {ghCliLabel} with your GitHub account, then check again.</>
        : <>Try again after confirming {ghCliLabel} is installed and authenticated.</>;

  const commands = isMissingCli
    ? ["brew install gh", "gh auth login"]
    : isNotAuthenticated
      ? ["gh auth login"]
      : [];

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-ink-50">
      <img
        alt="Outer world background"
        className="absolute inset-0 h-full w-full object-cover"
        src="/outerworld.jpg"
      />
      <OuterworldAttribution />

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />

      <div className="relative z-10 flex h-full items-end justify-center">
        <div className="w-full px-6 pb-16 sm:px-10 sm:pb-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
            <p className="mt-3 text-sm text-white/80 sm:text-base">{description}</p>

            {!isChecking && commands.length > 0 ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                {commands.map((command) => (
                  <div
                    className="w-64 rounded-md bg-black/45 px-3 py-2 text-center font-mono text-sm text-white"
                    key={command}
                  >
                    {command}
                  </div>
                ))}
              </div>
            ) : null}

            {status === "unknown_error" && message ? (
              <p className="mt-4 max-w-xl text-xs text-white/65">{message}</p>
            ) : null}

            <button
              className="mt-6 inline-flex items-center gap-2 px-1 py-1 text-sm font-medium text-white transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isChecking}
              onClick={onCheckAgain}
              type="button"
            >
              <ArrowPathIcon className="size-4" />
              {isChecking ? "Checking..." : "Check again"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { GhCliGateScreen };
export type { GhCliGateScreenProps };
