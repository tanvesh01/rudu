type RepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
};

type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  updatedAt: string;
  url: string;
};

const mockRepos: RepoSummary[] = [
  {
    name: "react",
    nameWithOwner: "facebook/react",
    description: "The library for web and native user interfaces.",
    isPrivate: false,
  },
  {
    name: "next.js",
    nameWithOwner: "vercel/next.js",
    description: "The React Framework",
    isPrivate: false,
  },
  {
    name: "tauri-diffs",
    nameWithOwner: "pierre/tauri-diffs",
    description: "A desktop app for reviewing PR diffs",
    isPrivate: true,
  },
  {
    name: "wonderland",
    nameWithOwner: "follow-alice/wonderland",
    description: null,
    isPrivate: true,
  },
];

const mockPrsByRepo: Record<string, PullRequestSummary[]> = {
  "facebook/react": [
    {
      number: 31258,
      title: "Fix: useEffect cleanup timing in concurrent mode",
      state: "open",
      authorLogin: "gaearon",
      updatedAt: "2026-04-08T14:30:00Z",
      url: "https://github.com/facebook/react/pull/31258",
    },
    {
      number: 31245,
      title: "feat: add useOptimistic support for Server Components",
      state: "open",
      authorLogin: "sebmarkbage",
      updatedAt: "2026-04-07T09:15:00Z",
      url: "https://github.com/facebook/react/pull/31245",
    },
    {
      number: 31210,
      title: "fix: reconcile Suspense boundary fallback transitions",
      state: "open",
      authorLogin: "acdlite",
      updatedAt: "2026-04-05T18:22:00Z",
      url: "https://github.com/facebook/react/pull/31210",
    },
  ],
  "vercel/next.js": [
    {
      number: 78421,
      title: "feat: incremental cache revalidation with cacheLife",
      state: "open",
      authorLogin: "feflow",
      updatedAt: "2026-04-08T22:10:00Z",
      url: "https://github.com/vercel/next.js/pull/78421",
    },
    {
      number: 78395,
      title: "fix: Turbopack HMR memory leak on large component trees",
      state: "open",
      authorLogin: "sokra",
      updatedAt: "2026-04-06T11:45:00Z",
      url: "https://github.com/vercel/next.js/pull/78395",
    },
  ],
  "pierre/tauri-diffs": [
    {
      number: 42,
      title: "feat: add collapsible sidebar with Base UI Accordion",
      state: "open",
      authorLogin: "tanvesh",
      updatedAt: "2026-04-09T08:00:00Z",
      url: "https://github.com/pierre/tauri-diffs/pull/42",
    },
  ],
  "follow-alice/wonderland": [
    {
      number: 440,
      title: "FOL-759: [FE] Referral Program Dashboard",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-04-09T11:35:36Z",
      url: "https://github.com/follow-alice/wonderland/pull/440",
    },
    {
      number: 435,
      title: "Update dependency typescript to v6",
      state: "open",
      authorLogin: "app/renovate",
      updatedAt: "2026-04-08T21:02:53Z",
      url: "https://github.com/follow-alice/wonderland/pull/435",
    },
    {
      number: 433,
      title: "Add expandable row support to OfficeGenericTableComponent",
      state: "open",
      authorLogin: "MarcoGlauser",
      updatedAt: "2026-04-08T07:51:26Z",
      url: "https://github.com/follow-alice/wonderland/pull/433",
    },
    {
      number: 413,
      title: "FOL-762 [BE] Public Invite APIs",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-04-09T10:01:56Z",
      url: "https://github.com/follow-alice/wonderland/pull/413",
    },
    {
      number: 399,
      title: "add new Referral invite page",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-04-06T05:46:59Z",
      url: "https://github.com/follow-alice/wonderland/pull/399",
    },
    {
      number: 384,
      title: "fol 758 be referral program dashboard apis",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-04-06T07:57:48Z",
      url: "https://github.com/follow-alice/wonderland/pull/384",
    },
    {
      number: 378,
      title: "Update dependency intl-tel-input to ~26.9.0",
      state: "open",
      authorLogin: "app/renovate",
      updatedAt: "2026-04-08T21:02:25Z",
      url: "https://github.com/follow-alice/wonderland/pull/378",
    },
    {
      number: 339,
      title: "Feat: New Custom dropdown",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-02-19T13:58:49Z",
      url: "https://github.com/follow-alice/wonderland/pull/339",
    },
    {
      number: 333,
      title: "feat(migration): add Trip Self-Booking component suite and Webflow integration",
      state: "open",
      authorLogin: "tanvesh01",
      updatedAt: "2026-03-30T12:50:16Z",
      url: "https://github.com/follow-alice/wonderland/pull/333",
    },
    {
      number: 250,
      title: "Webflow export",
      state: "open",
      authorLogin: "MarcoGlauser",
      updatedAt: "2026-03-26T09:35:26Z",
      url: "https://github.com/follow-alice/wonderland/pull/250",
    },
    {
      number: 241,
      title: "Update dependency svglib to v1.6.0",
      state: "open",
      authorLogin: "app/renovate",
      updatedAt: "2026-04-08T21:02:27Z",
      url: "https://github.com/follow-alice/wonderland/pull/241",
    },
    {
      number: 102,
      title: "Fol 654 payment resolution on the backend",
      state: "open",
      authorLogin: "MarcoGlauser",
      updatedAt: "2026-03-26T04:57:33Z",
      url: "https://github.com/follow-alice/wonderland/pull/102",
    },
    {
      number: 18,
      title: "Update dependency tailwindcss to v4",
      state: "open",
      authorLogin: "app/renovate",
      updatedAt: "2026-04-08T21:02:38Z",
      url: "https://github.com/follow-alice/wonderland/pull/18",
    },
  ],
};

export { mockRepos, mockPrsByRepo };
