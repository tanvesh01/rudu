function IssuesDashboardLoader() {
  return (
    <div
      aria-live="polite"
      className="flex min-h-full items-center justify-center px-5 py-4"
    >
      <div className="flex items-center gap-3 text-sm text-ink-500">
        <span className="size-5 rounded-full border-2 border-ink-300 border-t-ink-700 animate-spin" />
        <span>Loading issues...</span>
      </div>
    </div>
  );
}

export { IssuesDashboardLoader };
