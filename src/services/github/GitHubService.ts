import type {
  PRStatus,
  GitHubCapabilities,
  GitHubError,
  GitHubErrorCode,
  CommitPushResult,
  CreatePRResult,
  PRCheck,
  PRState,
} from "./types.js";

async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number = 10000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(subprocess.stdout).text();
  const stderrPromise = new Response(subprocess.stderr).text();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        subprocess.kill();
      } catch {}
      reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const exitCode = await Promise.race([subprocess.exited, timeoutPromise]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stdout, stderr };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function runGh(
  args: string[],
  cwd: string,
  timeoutMs: number = 15000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn({
    cmd: ["gh", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(subprocess.stdout).text();
  const stderrPromise = new Response(subprocess.stderr).text();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        subprocess.kill();
      } catch {}
      reject(new Error(`gh ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const exitCode = await Promise.race([subprocess.exited, timeoutPromise]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { exitCode, stdout, stderr };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function makeError(code: GitHubErrorCode, message: string, recoverable = true): GitHubError {
  return { code, message, recoverable };
}

export async function checkGhInstalled(): Promise<boolean> {
  try {
    const result = await runGh(["--version"], "/tmp", 5000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function checkGhAuthenticated(cwd: string): Promise<boolean> {
  try {
    const result = await runGh(["auth", "status"], cwd, 10000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getGitHubCapabilities(cwd: string): Promise<GitHubCapabilities> {
  const capabilities: GitHubCapabilities = {
    ghInstalled: false,
    ghAuthenticated: false,
    isRepo: false,
    hasRemote: false,
    currentBranch: null,
    defaultBranch: null,
    repoOwner: null,
    repoName: null,
  };

  capabilities.ghInstalled = await checkGhInstalled();
  if (!capabilities.ghInstalled) return capabilities;

  try {
    const gitResult = await runGit(["rev-parse", "--is-inside-work-tree"], cwd, 5000);
    capabilities.isRepo = gitResult.exitCode === 0;
  } catch {
    capabilities.isRepo = false;
  }

  if (!capabilities.isRepo) return capabilities;

  try {
    const branchResult = await runGit(["branch", "--show-current"], cwd, 5000);
    capabilities.currentBranch = branchResult.stdout.trim() || null;
    if (!capabilities.currentBranch) {
      const headResult = await runGit(["rev-parse", "--short", "HEAD"], cwd, 5000);
      capabilities.currentBranch = `HEAD detached at ${headResult.stdout.trim()}`;
    }
  } catch {
    capabilities.currentBranch = null;
  }

  try {
    const remoteResult = await runGit(["remote", "get-url", "origin"], cwd, 5000);
    capabilities.hasRemote = remoteResult.exitCode === 0;
  } catch {
    capabilities.hasRemote = false;
  }

  if (capabilities.hasRemote && capabilities.ghInstalled) {
    capabilities.ghAuthenticated = await checkGhAuthenticated(cwd);
  }

  if (capabilities.ghAuthenticated) {
    try {
      const defaultResult = await runGh(["repo", "--json", "defaultBranchRef,name,owner"], cwd, 10000);
      if (defaultResult.exitCode === 0) {
        const repoInfo = JSON.parse(defaultResult.stdout);
        capabilities.defaultBranch = repoInfo.defaultBranchRef?.name || "main";
        capabilities.repoOwner = repoInfo.owner?.login || null;
        capabilities.repoName = repoInfo.name || null;
      }
    } catch {
      capabilities.defaultBranch = "main";
    }
  }

  return capabilities;
}

export async function checkPrForBranch(cwd: string, branch?: string): Promise<PRStatus | GitHubError> {
  const caps = await getGitHubCapabilities(cwd);

  if (!caps.ghInstalled) {
    return makeError("GH_MISSING", "GitHub CLI (gh) is not installed");
  }
  if (!caps.ghAuthenticated) {
    return makeError("AUTH_FAILED", "Not authenticated with GitHub. Run 'gh auth login'");
  }
  if (!caps.isRepo) {
    return makeError("NOT_REPO", "Not a git repository");
  }
  if (!caps.hasRemote) {
    return makeError("NO_REMOTE", "No remote repository configured");
  }
  if (!caps.currentBranch || caps.currentBranch.startsWith("HEAD detached")) {
    return makeError("DETACHED_HEAD", "Cannot check PR status in detached HEAD state");
  }

  const targetBranch = branch || caps.currentBranch;

  try {
    const result = await runGh(
      ["pr", "view", targetBranch, "--json", "state,mergeable,number,title,baseRefName,headRefName"],
      cwd,
      15000,
    );

    if (result.exitCode !== 0) {
      if (result.stderr.includes("no pull request found")) {
        return { exists: false };
      }
      return makeError("PR_NOT_FOUND", `Could not find PR for branch: ${result.stderr}`);
    }

    const prInfo = JSON.parse(result.stdout);

    const checksResult = await runGh(["pr", "checks", String(prInfo.number), "--json", "name,status,conclusion"], cwd, 15000);
    let checks: PRCheck[] = [];
    if (checksResult.exitCode === 0) {
      checks = JSON.parse(checksResult.stdout);
    }

    const hasConflicts = prInfo.mergeable === false;

    return {
      exists: true,
      number: prInfo.number,
      state: prInfo.state as PRState,
      title: prInfo.title,
      mergeable: prInfo.mergeable ?? undefined,
      hasConflicts,
      checks,
      baseBranch: prInfo.baseRefName,
      headBranch: prInfo.headRefName,
    };
  } catch (error) {
    return makeError("COMMAND_FAILED", error instanceof Error ? error.message : "Unknown error");
  }
}

export async function createPr(
  cwd: string,
  title: string,
  body: string = "",
  baseBranch?: string,
): Promise<CreatePRResult> {
  const caps = await getGitHubCapabilities(cwd);

  if (!caps.ghInstalled) {
    return { type: "failure", error: "GitHub CLI (gh) is not installed" };
  }
  if (!caps.ghAuthenticated) {
    return { type: "failure", error: "Not authenticated with GitHub" };
  }
  if (!caps.currentBranch || caps.currentBranch.startsWith("HEAD detached")) {
    return { type: "failure", error: "Cannot create PR from detached HEAD state" };
  }

  const base = baseBranch || caps.defaultBranch || "main";
  const head = caps.currentBranch;

  try {
    const result = await runGh(
      ["pr", "create", "--title", title, "--body", body, "--base", base, "--head", head],
      cwd,
      30000,
    );

    if (result.exitCode !== 0) {
      return { type: "failure", error: result.stderr || result.stdout };
    }

    const output = result.stdout.trim();
    const prMatch = output.match(/\/pull\/(\d+)$/);
    const prNumber = prMatch?.[1] ? parseInt(prMatch[1], 10) : undefined;

    return {
      type: "success",
      prNumber,
      prUrl: output,
    };
  } catch (error) {
    return {
      type: "failure",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function commitAndPush(cwd: string, message: string): Promise<CommitPushResult> {
  try {
    const statusResult = await runGit(["status", "--porcelain"], cwd, 5000);
    if (!statusResult.stdout.trim()) {
      return { type: "success", commitHash: "no changes" };
    }

    const addResult = await runGit(["add", "-A"], cwd, 10000);
    if (addResult.exitCode !== 0) {
      return { type: "failure", error: `git add failed: ${addResult.stderr}` };
    }

    const commitResult = await runGit(["commit", "-m", message], cwd, 10000);
    if (commitResult.exitCode !== 0) {
      return { type: "failure", error: `git commit failed: ${commitResult.stderr}` };
    }

    const hashResult = await runGit(["rev-parse", "HEAD"], cwd, 5000);
    const commitHash = hashResult.stdout.trim();

    const pushResult = await runGit(["push", "-u", "origin", "HEAD"], cwd, 30000);
    if (pushResult.exitCode !== 0) {
      return { type: "failure", error: `git push failed: ${pushResult.stderr}` };
    }

    return { type: "success", commitHash };
  } catch (error) {
    return {
      type: "failure",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const result = await runGit(["status", "--porcelain"], cwd, 5000);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getStagedDiff(cwd: string): Promise<string> {
  try {
    const result = await runGit(["diff", "--staged"], cwd, 10000);
    return result.stdout;
  } catch {
    return "";
  }
}

export function isGitHubError(result: unknown): result is GitHubError {
  return (
    typeof result === "object" &&
    result !== null &&
    "code" in result &&
    "message" in result
  );
}