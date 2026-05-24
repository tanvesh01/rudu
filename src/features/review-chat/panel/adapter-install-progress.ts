import type { ReviewChatAdapterInstallEvent } from "../../../types/github";

function getAdapterInstallProgressValue(
  event: ReviewChatAdapterInstallEvent | null,
) {
  if (!event?.totalBytes || event.totalBytes <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((event.downloadedBytes / event.totalBytes) * 100)),
  );
}

function formatAdapterInstallProgress(event: ReviewChatAdapterInstallEvent) {
  const progress = getAdapterInstallProgressValue(event);
  if (progress !== null) {
    return `${progress}%`;
  }

  if (event.downloadedBytes > 0) {
    return `${Math.round(event.downloadedBytes / 1024)} KB`;
  }

  return null;
}

function isAdapterInstallRunning(event: ReviewChatAdapterInstallEvent | null) {
  return (
    event?.phase === "checking" ||
    event?.phase === "downloading" ||
    event?.phase === "extracting"
  );
}

export {
  formatAdapterInstallProgress,
  getAdapterInstallProgressValue,
  isAdapterInstallRunning,
};
