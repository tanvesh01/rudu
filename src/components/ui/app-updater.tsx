import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { ArrowUpCircleIcon } from "@heroicons/react/20/solid";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

type DownloadProgress = {
  downloaded: number;
  contentLength: number | null;
};

type AppUpdaterProps = {
  buttonLabel?: string;
  showFeedback?: boolean;
  buttonClassName?: string;
  containerClassName?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatProgress(progress: DownloadProgress | null) {
  if (!progress) {
    return null;
  }

  if (!progress.contentLength || progress.contentLength <= 0) {
    return `Downloaded ${Math.round(progress.downloaded / 1024)} KB`;
  }

  const percent = Math.min(
    100,
    Math.round((progress.downloaded / progress.contentLength) * 100),
  );
  return `Downloaded ${percent}%`;
}

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function AppUpdater({
  buttonLabel = "Check for updates",
  showFeedback = true,
  buttonClassName,
  containerClassName,
}: AppUpdaterProps) {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] =
    useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    void getVersion()
      .then((version) => setCurrentVersion(version))
      .catch(() => setCurrentVersion(null));
  }, []);

  useEffect(() => {
    let isMounted = true;

    void check()
      .then((update) => {
        if (!isMounted) return;
        setAvailableUpdate(update);
      })
      .catch((error) => {
        if (!isMounted) return;
        setAvailableUpdate(null);
        setFeedback(`Update check failed: ${getErrorMessage(error)}`);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const progressLabel = useMemo(() => formatProgress(progress), [progress]);

  async function handleInstallUpdate() {
    if (!availableUpdate) {
      return;
    }

    setIsInstalling(true);
    setFeedback("");
    setProgress({ downloaded: 0, contentLength: null });

    try {
      await availableUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setProgress({
              downloaded: 0,
              contentLength: event.data.contentLength ?? null,
            });
            break;
          case "Progress":
            setProgress((current) => ({
              downloaded: (current?.downloaded ?? 0) + event.data.chunkLength,
              contentLength: current?.contentLength ?? null,
            }));
            break;
          case "Finished":
            setProgress((current) => current);
            break;
        }
      });

      setFeedback("Update installed. Relaunching Rudu...");
      await relaunch();
    } catch (error) {
      setFeedback(`Update install failed: ${getErrorMessage(error)}`);
    } finally {
      setIsInstalling(false);
    }
  }

  return (
    <>
      {availableUpdate ? (
        <div
          className={cx(
            "flex min-w-0 shrink-0 flex-col items-end gap-1",
            containerClassName,
          )}
        >
          <button
            className={cx(
              "flex items-center gap-1 rounded-full border border-ink-300 bg-white px-3 py-1 pl-1 text-xs font-medium transition hover:bg-canvas dark:bg-surface dark:hover:bg-canvasDark",
              buttonClassName,
            )}
            disabled={isInstalling}
            onClick={() => setIsDialogOpen(true)}
            type="button"
          >
            <ArrowUpCircleIcon className="size-4 text-ink-500" />{" "}
            {isInstalling ? "Installing..." : buttonLabel}
          </button>
          {showFeedback && feedback ? (
            <p className="max-w-72 text-right text-xs text-ink-600">
              {feedback}
            </p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!isInstalling) {
            setIsDialogOpen(open);
          }
        }}
        open={isDialogOpen}
      >
        <AlertDialogContent className="min-h-[220px] p-4">
          <AlertDialogHeader className="!gap-0">
            <AlertDialogTitle className="font-normal">
              Install update
            </AlertDialogTitle>
            <AlertDialogDescription>
              {currentVersion
                ? `Rudu ${currentVersion} can be updated to ${availableUpdate?.version ?? "a newer version"}.`
                : `A newer version of Rudu is available: ${availableUpdate?.version ?? "unknown"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {availableUpdate?.body ? (
            <div className="max-h-48 my-4 overflow-y-auto rounded-lg bg-canvas px-3 py-2 text-sm text-ink-700 whitespace-pre-wrap">
              {availableUpdate.body}
            </div>
          ) : null}

          {progressLabel ? (
            <p className="text-sm text-ink-600">{progressLabel}</p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isInstalling} type="button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isInstalling}
              onClick={() => void handleInstallUpdate()}
              type="button"
            >
              {isInstalling ? "Installing..." : "Install and relaunch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export { AppUpdater };
