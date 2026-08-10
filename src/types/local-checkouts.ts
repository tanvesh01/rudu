type LocalCheckout = {
  id: string;
  path: string;
  repositoryKey: string;
  folderName: string;
  branch: string;
  githubRepo: string | null;
  available: boolean;
};

type LocalFileChange = {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

type LocalCheckoutStatus = {
  checkoutId: string;
  branch: string;
  headSha: string;
  revision: string;
  changedFiles: string[];
  changes: LocalFileChange[];
};

type LocalCheckoutPatch = {
  checkoutId: string;
  revision: string;
  patch: string;
};

type LocalDiffSource =
  | {
      kind: "git_diff";
      target: string | null;
      staged: boolean;
      includeUntracked: boolean;
      paths: string[];
    }
  | { kind: "git_show"; target: string | null; paths: string[] }
  | { kind: "patch"; path: string }
  | { kind: "files"; oldPath: string; newPath: string };

export type {
  LocalCheckout,
  LocalCheckoutPatch,
  LocalCheckoutStatus,
  LocalDiffSource,
  LocalFileChange,
};
