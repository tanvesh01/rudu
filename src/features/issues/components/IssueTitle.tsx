function IssueTitle({ title }: { title: string }) {
  const parts = title.split(/(`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              className="rounded border border-ink-200 bg-surface px-1 py-0.5 font-mono text-[0.92em] text-ink-800"
              key={`${part}-${index}`}
            >
              {part.slice(1, -1)}
            </code>
          );
        }

        return part;
      })}
    </>
  );
}

export { IssueTitle };
