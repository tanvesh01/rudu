import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const VERSION = "0.12.0";
const REPO = "zed-industries/codex-acp";
const SUPPORTED_ASSETS: Record<string, { fileName: string; sha256: string }> = {
  "aarch64-apple-darwin": {
    fileName: "codex-acp-0.12.0-aarch64-apple-darwin.tar.gz",
    sha256: "298492f09cba44476065f13d0a1c3e1a8acd995effb2060bb7e48b07ba5f0dd5",
  },
  "x86_64-apple-darwin": {
    fileName: "codex-acp-0.12.0-x86_64-apple-darwin.tar.gz",
    sha256: "3a4bdae18d1e02789cfa2a0df59f2e3b00300ead886ecf6e7af940079cd19ad3",
  },
  "aarch64-unknown-linux-gnu": {
    fileName: "codex-acp-0.12.0-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "e05e613da657b2ba67325e26a22313ed9b2828aade2b9d18185be83ad143e9cf",
  },
  "x86_64-unknown-linux-gnu": {
    fileName: "codex-acp-0.12.0-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "85aaef7c1bca64db589f3813980b9686c9c674d5b46612684eea3443a6cf6f8e",
  },
  "aarch64-unknown-linux-musl": {
    fileName: "codex-acp-0.12.0-aarch64-unknown-linux-musl.tar.gz",
    sha256: "5daf70a52d72792722618eea77eadc2980130ff486cf195d6c075ed60ae48050",
  },
  "x86_64-unknown-linux-musl": {
    fileName: "codex-acp-0.12.0-x86_64-unknown-linux-musl.tar.gz",
    sha256: "9c9fc1377a9c5834cdd7a42c21fb4e6e0d2787c1853d18effe70718a091ca42a",
  },
  "aarch64-pc-windows-msvc": {
    fileName: "codex-acp-0.12.0-aarch64-pc-windows-msvc.zip",
    sha256: "313404cf9167f552b994c5266c8c5c57656fa14448412c334f4935d5f4740c14",
  },
  "x86_64-pc-windows-msvc": {
    fileName: "codex-acp-0.12.0-x86_64-pc-windows-msvc.zip",
    sha256: "de6253692143fe70c493aa8306850d492b54da54008f275aa9bf6f8be9f19295",
  },
};

function currentTargetTriple(): string {
  const explicitTarget = process.env.TARGET || process.env.CARGO_BUILD_TARGET;
  if (explicitTarget && explicitTarget.trim()) {
    return explicitTarget.trim();
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "aarch64-unknown-linux-gnu";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "aarch64-pc-windows-msvc";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }

  throw new Error(`Unsupported platform/architecture: ${process.platform}/${process.arch}`);
}

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
}

async function ensureArchive(url: string, archivePath: string, expectedSha256: string): Promise<void> {
  if (existsSync(archivePath)) {
    const actualSha256 = await sha256(archivePath);
    if (actualSha256 === expectedSha256) {
      return;
    }
    await rm(archivePath, { force: true });
  }

  await download(url, archivePath);
  const actualSha256 = await sha256(archivePath);
  if (actualSha256 !== expectedSha256) {
    await rm(archivePath, { force: true });
    throw new Error(
      `Digest mismatch for ${basename(archivePath)}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
}

function shellQuotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function extractArchive(archivePath: string, outputDir: string): Promise<void> {
  if (archivePath.endsWith(".tar.gz")) {
    execFileSync("tar", ["-xzf", archivePath, "-C", outputDir], { stdio: "inherit" });
    return;
  }

  if (archivePath.endsWith(".zip")) {
    try {
      execFileSync("unzip", ["-q", archivePath, "-d", outputDir], { stdio: "inherit" });
      return;
    } catch (error) {
      if (process.platform !== "win32") {
        throw error;
      }
    }

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath ${shellQuotePowerShell(archivePath)} -DestinationPath ${shellQuotePowerShell(
          outputDir,
        )} -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }

  throw new Error(`Unsupported release archive format: ${archivePath}`);
}

async function findBinaryNamed(dir: string, binaryName: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBinaryNamed(path, binaryName);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name === binaryName) {
      return path;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const targetTriple = currentTargetTriple();
  const asset = SUPPORTED_ASSETS[targetTriple];
  if (!asset) {
    throw new Error(`No pinned codex-acp ${VERSION} release asset for target ${targetTriple}`);
  }
  const targetIsWindows = targetTriple.includes("windows");
  const binaryName = targetIsWindows ? "codex-acp.exe" : "codex-acp";

  const rootDir = process.cwd();
  const binariesDir = join(rootDir, "src-tauri", "binaries");
  const cacheDir = join(rootDir, ".context", "codex-acp-sidecar");
  const extractDir = join(cacheDir, `extract-${process.pid}-${Date.now()}`);
  const archivePath = join(cacheDir, asset.fileName);
  const destinationPath = join(
    binariesDir,
    `codex-acp-${targetTriple}${targetIsWindows ? ".exe" : ""}`,
  );
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${asset.fileName}`;

  await mkdir(binariesDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await ensureArchive(url, archivePath, asset.sha256);

  await rm(extractDir, { force: true, recursive: true });
  await mkdir(extractDir, { recursive: true });
  try {
    await extractArchive(archivePath, extractDir);
    const binaryPath = await findBinaryNamed(extractDir, binaryName);
    if (!binaryPath) {
      throw new Error(`Archive ${asset.fileName} did not contain ${binaryName}`);
    }

    const binaryStats = await stat(binaryPath);
    if (!binaryStats.isFile()) {
      throw new Error(`Extracted path is not a file: ${binaryPath}`);
    }

    await copyFile(binaryPath, destinationPath);
    if (!targetIsWindows) {
      await chmod(destinationPath, 0o755);
    }
  } finally {
    await rm(extractDir, { force: true, recursive: true });
  }

  console.log(`Prepared codex-acp ${VERSION} sidecar for ${targetTriple}: ${destinationPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
