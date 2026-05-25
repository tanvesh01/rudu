import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type ProviderCatalog = Record<string, unknown>;

const MODELS_URL = process.env.MODELS_DEV_URL ?? "https://models.dev";
const OUTPUT_DIR = path.join(process.cwd(), "src/assets/model-provider-logos");
const SVG_FILE_PATTERN = /\.svg$/i;

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "rudu/model-provider-logo-sync",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchProviderIds() {
  const text = await fetchText(`${MODELS_URL}/api.json`);
  const catalog = JSON.parse(text) as ProviderCatalog;
  return Object.keys(catalog).sort((a, b) => a.localeCompare(b));
}

function assertSvg(providerId: string, body: string) {
  if (!body.includes("<svg")) {
    throw new Error(`Provider ${providerId} did not return SVG content`);
  }

  if (/<script[\s>]/i.test(body) || /\son[a-z]+\s*=/i.test(body) || /javascript:/i.test(body)) {
    throw new Error(`Provider ${providerId} returned SVG content with active code`);
  }
}

async function removeOldSvgs() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && SVG_FILE_PATTERN.test(entry.name))
      .map((entry) => rm(path.join(OUTPUT_DIR, entry.name))),
  );
}

async function syncProviderLogo(providerId: string) {
  const svg = await fetchText(`${MODELS_URL}/logos/${providerId}.svg`);
  assertSvg(providerId, svg);
  await writeFile(path.join(OUTPUT_DIR, `${providerId}.svg`), svg);
}

async function main() {
  const providerIds = await fetchProviderIds();
  await removeOldSvgs();
  await Promise.all(providerIds.map(syncProviderLogo));
  console.log(`Synced ${providerIds.length} model provider logos to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
