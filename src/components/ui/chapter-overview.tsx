import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  SparklesIcon,
} from "@heroicons/react/20/solid";
import { useState } from "react";
import {
  getFileReviewThreadsForPath,
  normalizePath,
  type FileReviewThreads,
} from "../../lib/review-threads";
import type {
  ChapterReviewFocus,
  ChapterReviewStep,
  LlmSettings,
  PullRequestChapter,
  PullRequestChapterFile,
  PullRequestChapters,
} from "../../types/github";

type ChapterOverviewProps = {
  chapters: PullRequestChapters | null;
  isLoading: boolean;
  error: string;
  settings: LlmSettings | null;
  settingsError: string;
  isGenerating: boolean;
  generationError: string;
  selectedChapterId: string | null;
  selectedReviewStepIndex: number | null;
  completedChapterIds: Set<string>;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  onGenerate: () => void;
  onSelectChapter: (chapterId: string | null) => void;
  onSelectReviewFocus: (focus: ChapterReviewFocus) => void;
  onSelectReviewStep: (stepIndex: number | null) => void;
  onToggleChapterComplete: (chapterId: string) => void;
  onOpenSettings: () => void;
};

type RelatedFile = PullRequestChapterFile & {
  isMatchedChapterFile: boolean;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatSignedCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function formatFileCount(count: number) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function formatRelativeGeneratedAt(generatedAt: number) {
  const generatedAtMs = generatedAt * 1000;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - generatedAtMs) / 1000),
  );

  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function getUniqueChapterFileCount(chapters: PullRequestChapters) {
  const fileSet = new Set<string>();
  for (const chapter of chapters.chapters) {
    for (const file of chapter.files) {
      fileSet.add(normalizePath(file.path));
    }
  }
  return fileSet.size;
}

function getChapterTotals(chapters: PullRequestChapters) {
  return chapters.chapters.reduce(
    (totals, chapter) => ({
      additions: totals.additions + chapter.additions,
      deletions: totals.deletions + chapter.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function getSeverityRank(severity: string | null) {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function getSeverityLabel(severity: string | null) {
  if (!severity) return "Low";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function getChapterSeverity(chapter: PullRequestChapter) {
  let highestSeverity: string | null = null;
  for (const risk of chapter.risks) {
    if (getSeverityRank(risk.severity) > getSeverityRank(highestSeverity)) {
      highestSeverity = risk.severity;
    }
  }
  return highestSeverity ?? "low";
}

function getChapterThreadCount(
  chapter: PullRequestChapter,
  reviewThreadsByFile: Map<string, FileReviewThreads>,
) {
  return chapter.files.reduce(
    (total, file) =>
      total + getFileReviewThreadsForPath(reviewThreadsByFile, file.path).totalCount,
    0,
  );
}

function getSeverityClass(severity: string | null) {
  switch (severity) {
    case "high":
      return "text-red-600 dark:text-red-300";
    case "medium":
      return "text-amber-600 dark:text-amber-300";
    default:
      return "text-ink-500";
  }
}

function getSeverityBadgeClass(severity: string | null) {
  switch (severity) {
    case "high":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300";
    default:
      return "border-ink-200 bg-surface text-ink-600";
  }
}

function getFocusKey(item: ChapterReviewFocus, index: number) {
  return `${item.title}-${item.path ?? "all"}-${index}`;
}

function getReviewStepFileCount(
  chapter: PullRequestChapter,
  step: ChapterReviewStep,
) {
  return step.files.length > 0 ? step.files.length : chapter.files.length;
}

function getRelatedFiles(
  chapter: PullRequestChapter,
  step: ChapterReviewStep,
): RelatedFile[] {
  if (step.files.length === 0) {
    return chapter.files.map((file) => ({
      ...file,
      isMatchedChapterFile: true,
    }));
  }

  const chapterFilesByPath = new Map(
    chapter.files.map((file) => [normalizePath(file.path), file]),
  );

  return step.files.map((path) => {
    const chapterFile = chapterFilesByPath.get(normalizePath(path));
    if (chapterFile) {
      return {
        ...chapterFile,
        isMatchedChapterFile: true,
      };
    }

    return {
      path,
      reason: "",
      additions: 0,
      deletions: 0,
      isMatchedChapterFile: false,
    };
  });
}

function getRelatedRisks(
  chapter: PullRequestChapter,
  step: ChapterReviewStep,
): ChapterReviewFocus[] {
  if (step.files.length === 0) {
    return chapter.risks;
  }

  const fileSet = new Set(step.files.map((file) => normalizePath(file)));
  const matchingRisks = chapter.risks.filter(
    (risk) => !risk.path || fileSet.has(normalizePath(risk.path)),
  );

  return matchingRisks.length > 0 ? matchingRisks : chapter.risks;
}

type ChapterTodoDetailProps = {
  chapter: PullRequestChapter;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  selectedStepIndex: number;
  step: ChapterReviewStep;
  onBack: () => void;
  onSelectReviewStep: (stepIndex: number | null) => void;
};

function ChapterTodoDetail({
  chapter,
  reviewThreadsByFile,
  selectedStepIndex,
  step,
  onBack,
  onSelectReviewStep,
}: ChapterTodoDetailProps) {
  const relatedFiles = getRelatedFiles(chapter, step);
  const relatedRisks = getRelatedRisks(chapter, step);
  const totalThreads = relatedFiles.reduce(
    (total, file) =>
      total + getFileReviewThreadsForPath(reviewThreadsByFile, file.path).totalCount,
    0,
  );

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,34%)]">
      <div className="min-w-0 rounded-lg border border-ink-200 bg-canvas">
        <div className="border-b border-ink-200 px-3 py-2.5">
          <button
            className="mb-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-ink-500 transition hover:bg-surface hover:text-ink-900"
            onClick={onBack}
            type="button"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                To-do {selectedStepIndex + 1}
              </p>
              <h3 className="mt-1 text-base font-semibold leading-6 text-ink-900">
                {step.title}
              </h3>
            </div>
            <div className="shrink-0 rounded-md bg-surface px-2 py-1 text-right font-mono text-xs font-semibold">
              <span className="text-emerald-600 dark:text-emerald-300">
                +{formatSignedCount(chapter.additions)}
              </span>{" "}
              <span className="text-red-600 dark:text-red-300">
                -{formatSignedCount(chapter.deletions)}
              </span>
            </div>
          </div>
          {step.detail ? (
            <p className="mt-2 text-sm leading-6 text-ink-700">
              {step.detail}
            </p>
          ) : null}
        </div>

        <div className="px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Review checklist
            </p>
            <p className="text-xs text-ink-500">
              {chapter.reviewSteps.length} items
            </p>
          </div>
          <div className="divide-y divide-ink-200 overflow-hidden rounded-md border border-ink-200">
            {chapter.reviewSteps.map((candidateStep, index) => {
              const isSelected = index === selectedStepIndex;
              return (
                <button
                  className={cx(
                    "grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 px-2.5 py-2 text-left transition",
                    isSelected
                      ? "bg-surface"
                      : "bg-canvas hover:bg-surface/80",
                  )}
                  key={`${candidateStep.title}-${index}`}
                  onClick={() => onSelectReviewStep(index)}
                  type="button"
                >
                  <span
                    className={cx(
                      "mt-0.5 flex size-4 items-center justify-center rounded border text-[10px] font-semibold",
                      isSelected
                        ? "border-ink-900 bg-ink-900 text-white dark:border-ink-200 dark:bg-ink-200 dark:text-ink-900"
                        : "border-ink-300 text-ink-500",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {candidateStep.title}
                    </span>
                    {candidateStep.detail ? (
                      <span className="line-clamp-2 text-xs leading-5 text-ink-600">
                        {candidateStep.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-500">
                    {getReviewStepFileCount(chapter, candidateStep)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 content-start gap-3">
        <section className="rounded-lg border border-ink-200 bg-canvas">
          <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Related files
            </p>
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <span>{relatedFiles.length}</span>
              {totalThreads > 0 ? <span>{totalThreads} threads</span> : null}
            </div>
          </div>
          {relatedFiles.length > 0 ? (
            <div className="max-h-56 divide-y divide-ink-200 overflow-y-auto scrollbar-hidden">
              {relatedFiles.map((file) => (
                <div className="px-3 py-2" key={file.path}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-mono text-xs text-ink-900">
                      {file.path}
                    </p>
                    {file.isMatchedChapterFile ? (
                      <span className="shrink-0 whitespace-nowrap font-mono text-[11px] font-semibold">
                        <span className="text-emerald-600 dark:text-emerald-300">
                          +{formatSignedCount(file.additions)}
                        </span>{" "}
                        <span className="text-red-600 dark:text-red-300">
                          -{formatSignedCount(file.deletions)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  {file.reason ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-600">
                      {file.reason}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-ink-500">
              No files attached to this to-do.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-ink-200 bg-canvas">
          <div className="border-b border-ink-200 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Risks
            </p>
          </div>
          {relatedRisks.length > 0 ? (
            <div className="max-h-44 divide-y divide-ink-200 overflow-y-auto scrollbar-hidden">
              {relatedRisks.map((risk, index) => (
                <div className="px-3 py-2" key={`${risk.title}-${index}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={cx(
                        "min-w-0 text-sm font-medium",
                        getSeverityClass(risk.severity),
                      )}
                    >
                      {risk.title}
                    </p>
                    {risk.path ? (
                      <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-ink-500">
                        {risk.path}
                      </span>
                    ) : null}
                  </div>
                  {risk.detail ? (
                    <p className="mt-1 text-xs leading-5 text-ink-600">
                      {risk.detail}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-ink-500">
              No risks called out for this to-do.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type ChapterOverviewContentProps = {
  chapters: PullRequestChapters;
  selectedChapter: PullRequestChapter | undefined;
  selectedChapterId: string | null;
  selectedReviewStep: ChapterReviewStep | null;
  activeReviewFocusKey: string | null;
  completedChapterIds: Set<string>;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  onSelectChapter: (chapterId: string | null) => void;
  onSelectReviewFocus: (focus: ChapterReviewFocus, focusKey: string) => void;
  onSelectReviewStep: (stepIndex: number | null) => void;
  onToggleChapterComplete: (chapterId: string) => void;
};

function ChapterOverviewContent({
  chapters,
  selectedChapter,
  selectedChapterId,
  selectedReviewStep,
  activeReviewFocusKey,
  completedChapterIds,
  reviewThreadsByFile,
  onSelectChapter,
  onSelectReviewFocus,
  onSelectReviewStep,
  onToggleChapterComplete,
}: ChapterOverviewContentProps) {
  const completedCount = chapters.chapters.filter((chapter) =>
    completedChapterIds.has(chapter.id),
  ).length;
  const uniqueFileCount = getUniqueChapterFileCount(chapters);
  const totals = getChapterTotals(chapters);
  const leadingRisks = chapters.prologue.reviewFocus.slice(0, 4);
  const recommendedStart = chapters.chapters.slice(0, 4);
  const currentReviewLabel =
    selectedReviewStep?.title ?? selectedChapter?.title ?? null;

  return (
    <div className="grid gap-3">
      <section className="rounded-xl border border-ink-200 bg-canvas p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              AI Review Brief
            </p>
            {chapters.prologue.summary ? (
              <p className="mt-1 line-clamp-1 max-w-5xl text-sm leading-6 text-ink-900">
                {chapters.prologue.summary}
              </p>
            ) : (
              <p className="mt-1 text-sm leading-6 text-ink-700">
                AI grouped this PR into reviewable chapters.
              </p>
            )}
          </div>
          <button
            className={cx(
              "rounded-md px-2 py-1 text-xs font-medium transition",
              selectedChapterId === null
                ? "bg-ink-900 text-white dark:bg-ink-200 dark:text-ink-900"
                : "text-ink-600 hover:bg-surface hover:text-ink-900",
            )}
            onClick={() => onSelectChapter(null)}
            type="button"
          >
            All files
          </button>
        </div>

        {leadingRisks.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {leadingRisks.map((risk, index) => (
              <button
                className={cx(
                  "rounded-full border px-2 py-1 text-xs font-medium transition hover:border-ink-400",
                  getSeverityBadgeClass(risk.severity),
                )}
                key={getFocusKey(risk, index)}
                onClick={() =>
                  onSelectReviewFocus(risk, getFocusKey(risk, index))
                }
                type="button"
              >
                {risk.title}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs leading-5 text-ink-600">
          <span className="font-medium text-ink-900">
            {currentReviewLabel
              ? `Reviewing: ${currentReviewLabel}`
              : "Reviewing: all files"}
          </span>
          <span>
            Start:{" "}
            {recommendedStart.map((chapter, index) => (
              <button
                className="font-medium text-ink-800 transition hover:text-ink-900"
                key={chapter.id}
                onClick={() => onSelectChapter(chapter.id)}
                type="button"
              >
                {index > 0 ? ", " : ""}
                {index + 1}. {chapter.title}
              </button>
            ))}
          </span>
          <span>
            Generated from {uniqueFileCount} files -{" "}
            {formatRelativeGeneratedAt(chapters.generatedAt)}
          </span>
          <span className="font-mono font-semibold">
            +{formatSignedCount(totals.additions)} / -
            {formatSignedCount(totals.deletions)}
          </span>
        </div>
      </section>

      <details className="group rounded-lg border border-ink-200 bg-canvas">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
          <span>Show full AI summary</span>
          <ChevronDownIcon className="size-4 text-ink-500 transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-ink-200 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            What changed
          </p>
          {chapters.prologue.summary ? (
            <p className="mt-1 text-sm leading-6 text-ink-800">
              {chapters.prologue.summary}
            </p>
          ) : null}

          {chapters.prologue.keyChanges.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
                Key changes
              </p>
              <div className="grid gap-2">
                {chapters.prologue.keyChanges.map((item, index) => (
                  <div
                    className="grid grid-cols-[8px_minmax(0,1fr)] gap-2"
                    key={`${item.title}-${index}`}
                  >
                    <span className="mt-2 size-1.5 rounded-full bg-ink-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">
                        {item.title}
                      </p>
                      {item.detail ? (
                        <p className="text-xs leading-5 text-ink-600">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>

      {chapters.prologue.reviewFocus.length > 0 ? (
        <section className="rounded-lg border border-ink-200 bg-canvas p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              What to review carefully
            </p>
            <p className="text-xs text-ink-500">
              {chapters.prologue.reviewFocus.length} focus areas
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {chapters.prologue.reviewFocus.map((item, index) => {
              const focusKey = getFocusKey(item, index);
              const isActive = activeReviewFocusKey === focusKey;

              return (
                <button
                  className={cx(
                    "grid min-w-0 gap-2 rounded-lg border px-3 py-2.5 text-left transition",
                    isActive
                      ? "border-ink-500 bg-canvasDark"
                      : "border-ink-200 bg-surface hover:border-ink-300 hover:bg-canvasDark",
                  )}
                  key={focusKey}
                  onClick={() => onSelectReviewFocus(item, focusKey)}
                  type="button"
                >
                  <span className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span
                        className={cx(
                          "block text-xs font-semibold uppercase tracking-wide",
                          getSeverityClass(item.severity),
                        )}
                      >
                        {getSeverityLabel(item.severity)}
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-ink-900">
                        {item.title}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md border border-ink-200 bg-canvas px-2 py-1 text-xs font-medium text-ink-700">
                      Review now
                    </span>
                  </span>

                  {item.path ? (
                    <span className="truncate font-mono text-xs text-ink-500">
                      {item.path}
                    </span>
                  ) : null}

                  {isActive && item.detail ? (
                    <span className="rounded-md border border-ink-200 bg-canvas px-2.5 py-2 text-xs leading-5 text-ink-700">
                      AI reason: {item.detail}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-ink-200 bg-canvas p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            AI Review Plan - {chapters.chapters.length} chapters
          </p>
          <p className="text-xs text-ink-500">
            {completedCount} / {chapters.chapters.length} complete
          </p>
        </div>
        <div className="grid gap-2">
          {chapters.chapters.map((chapter, index) => {
            const isSelected = selectedChapterId === chapter.id;
            const isComplete = completedChapterIds.has(chapter.id);
            const commentCount = getChapterThreadCount(
              chapter,
              reviewThreadsByFile,
            );
            const severity = getChapterSeverity(chapter);

            return (
              <div
                className={cx(
                  "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2.5 transition",
                  isSelected
                    ? "border-ink-400 bg-canvasDark"
                    : "border-ink-200 bg-surface hover:border-ink-300 hover:bg-canvasDark",
                )}
                key={chapter.id}
              >
                <button
                  aria-label={
                    isComplete
                      ? `Mark ${chapter.title} incomplete`
                      : `Mark ${chapter.title} reviewed`
                  }
                  className={cx(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition",
                    isComplete
                      ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-ink-900"
                      : "border-ink-400 text-transparent hover:border-ink-700",
                  )}
                  onClick={() => onToggleChapterComplete(chapter.id)}
                  type="button"
                >
                  <CheckIcon className="size-3.5" />
                </button>

                <button
                  className="grid min-w-0 gap-1 text-left"
                  onClick={() => onSelectChapter(chapter.id)}
                  type="button"
                >
                  <span className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span
                        className={cx(
                          "block truncate text-sm font-semibold text-ink-900",
                          isComplete && "text-ink-500 line-through",
                        )}
                      >
                        {index + 1}. {chapter.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {formatFileCount(chapter.files.length)} -{" "}
                        {getSeverityLabel(severity)} risk
                        {commentCount > 0 ? ` - ${commentCount} comments` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold">
                      <span className="text-emerald-600 dark:text-emerald-300">
                        +{formatSignedCount(chapter.additions)}
                      </span>{" "}
                      <span className="text-red-600 dark:text-red-300">
                        -{formatSignedCount(chapter.deletions)}
                      </span>
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-ink-600">
                    {chapter.reviewSteps[0]?.detail ||
                      chapter.summary ||
                      "Review this chapter's files together."}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {selectedChapter ? (
        <section className="rounded-lg border border-ink-200 bg-canvas p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-ink-900">
              {selectedChapter.title}
            </p>
            <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold">
              <span className="text-emerald-600 dark:text-emerald-300">
                +{formatSignedCount(selectedChapter.additions)}
              </span>{" "}
              <span className="text-red-600 dark:text-red-300">
                -{formatSignedCount(selectedChapter.deletions)}
              </span>
            </span>
          </div>

          {selectedChapter.summary ? (
            <p className="text-sm leading-6 text-ink-800">
              {selectedChapter.summary}
            </p>
          ) : null}

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Recommended review order
              </p>
              <p className="text-xs text-ink-500">
                {selectedChapter.reviewSteps.length}
              </p>
            </div>

            {selectedChapter.reviewSteps.length > 0 ? (
              <div className="grid gap-1.5">
                {selectedChapter.reviewSteps.map((step, index) => (
                  <button
                    className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-2 rounded-md border border-ink-200 bg-surface px-2.5 py-2 text-left transition hover:border-ink-300 hover:bg-canvasDark"
                    key={`${step.title}-${index}`}
                    onClick={() => onSelectReviewStep(index)}
                    type="button"
                  >
                    <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-canvas text-[11px] font-semibold text-ink-600">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {step.title}
                      </span>
                      {step.detail ? (
                        <span className="line-clamp-2 text-xs leading-5 text-ink-600">
                          {step.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink-500">
                      {getReviewStepFileCount(selectedChapter, step)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-ink-200 bg-surface px-3 py-3 text-sm text-ink-500">
                No review steps for this chapter.
              </div>
            )}
          </div>

          {selectedChapter.risks.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
                What to review carefully
              </p>
              <div className="grid gap-2">
                {selectedChapter.risks.map((risk, index) => (
                  <div
                    className="flex items-start justify-between gap-3"
                    key={`${risk.title}-${index}`}
                  >
                    <div className="min-w-0">
                      <p
                        className={cx(
                          "text-sm font-medium",
                          getSeverityClass(risk.severity),
                        )}
                      >
                        {risk.title}
                      </p>
                      {risk.detail ? (
                        <p className="text-xs leading-5 text-ink-600">
                          {risk.detail}
                        </p>
                      ) : null}
                    </div>
                    {risk.path ? (
                      <span className="max-w-[36%] shrink-0 truncate font-mono text-xs text-ink-500">
                        {risk.path}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ChapterOverview({
  chapters,
  isLoading,
  error,
  settings,
  settingsError,
  isGenerating,
  generationError,
  selectedChapterId,
  selectedReviewStepIndex,
  completedChapterIds,
  reviewThreadsByFile,
  onGenerate,
  onSelectChapter,
  onSelectReviewFocus,
  onSelectReviewStep,
  onToggleChapterComplete,
  onOpenSettings,
}: ChapterOverviewProps) {
  const [activeReviewFocusKey, setActiveReviewFocusKey] = useState<string | null>(
    null,
  );
  const hasApiKey = Boolean(settings?.hasApiKey);
  const canGenerate = hasApiKey && !isGenerating;
  const selectedChapter = chapters?.chapters.find(
    (chapter) => chapter.id === selectedChapterId,
  );
  const selectedReviewStep =
    selectedChapter && selectedReviewStepIndex !== null
      ? selectedChapter.reviewSteps[selectedReviewStepIndex]
      : null;

  function handleSelectChapter(chapterId: string | null) {
    setActiveReviewFocusKey(null);
    onSelectChapter(chapterId);
  }

  function handleSelectReviewStep(stepIndex: number | null) {
    setActiveReviewFocusKey(null);
    onSelectReviewStep(stepIndex);
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-b border-ink-200 bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-200 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SparklesIcon className="size-4 shrink-0 text-ink-500" />
          <p className="truncate text-sm font-medium text-ink-900">
            {chapters
              ? `AI Review Plan - ${chapters.chapters.length} chapters`
              : "Summarize with AI"}
            {chapters ? (
              <span className="ml-2 text-xs font-normal text-ink-500">
                {chapters.provider} / {chapters.model}
              </span>
            ) : null}
          </p>
          {selectedReviewStep ? (
            <span className="hidden min-w-0 truncate text-xs text-ink-500 md:inline">
              Reviewing: {selectedReviewStep.title}
            </span>
          ) : selectedChapter ? (
            <span className="hidden min-w-0 truncate text-xs text-ink-500 md:inline">
              Reviewing: {selectedChapter.title}
            </span>
          ) : null}
        </div>

        <button
          aria-label="AI provider settings"
          className="inline-flex size-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-canvasDark hover:text-ink-900"
          onClick={onOpenSettings}
          type="button"
        >
          <Cog6ToothIcon className="size-4" />
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
          disabled={!canGenerate}
          onClick={onGenerate}
          type="button"
        >
          <ArrowPathIcon
            className={cx("size-3.5", isGenerating && "animate-spin")}
          />
          {isGenerating
            ? chapters
              ? "Regenerating"
              : "Summarizing"
            : chapters
              ? "Regenerate summary"
              : "Summarize with AI"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-hidden">
        {isLoading ? (
          <div className="py-3 text-sm text-ink-500">
            Loading cached AI summary...
          </div>
        ) : null}

        {settingsError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {settingsError}
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {generationError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {generationError}
          </div>
        ) : null}

        {!isLoading && !chapters ? (
          <div className="rounded-lg border border-ink-200 bg-canvas px-3 py-3">
            <p className="text-sm font-medium text-ink-900">
              {hasApiKey
                ? "No AI summary yet."
                : "Configure a provider to summarize with AI."}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-600">
              {hasApiKey
                ? "Generate a cached review story for this PR."
                : "API keys are saved in your system keychain and will not be shown again."}
            </p>
          </div>
        ) : null}

        {chapters && selectedChapter && selectedReviewStep ? (
          <ChapterTodoDetail
            chapter={selectedChapter}
            reviewThreadsByFile={reviewThreadsByFile}
            selectedStepIndex={selectedReviewStepIndex ?? 0}
            step={selectedReviewStep}
            onBack={() => handleSelectReviewStep(null)}
            onSelectReviewStep={handleSelectReviewStep}
          />
        ) : null}

        {chapters && !selectedReviewStep ? (
          <ChapterOverviewContent
            chapters={chapters}
            reviewThreadsByFile={reviewThreadsByFile}
            selectedChapter={selectedChapter}
            selectedChapterId={selectedChapterId}
            selectedReviewStep={selectedReviewStep}
            activeReviewFocusKey={activeReviewFocusKey}
            completedChapterIds={completedChapterIds}
            onSelectChapter={handleSelectChapter}
            onSelectReviewFocus={(focus, focusKey) => {
              setActiveReviewFocusKey(focusKey);
              onSelectReviewFocus(focus);
            }}
            onSelectReviewStep={handleSelectReviewStep}
            onToggleChapterComplete={onToggleChapterComplete}
          />
        ) : null}
      </div>
    </section>
  );
}

export { ChapterOverview };
export type { ChapterOverviewProps };
