import type { ReactNode } from "react";

function RepoSidebar({ children }: { children: ReactNode }) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-hidden">
        {children}
      </div>
    </section>
  );
}

export { RepoSidebar };
