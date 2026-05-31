import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type ProviderCatalog = Record<
  string,
  {
    models?: Record<string, { name?: string }>;
    name?: string;
  }
>;

const MODELS_URL = process.env.MODELS_DEV_URL ?? "https://models.dev";
const OUTPUT_DIR = path.join(process.cwd(), "src/assets/model-provider-logos");
const CATALOG_PATH = path.join(process.cwd(), "src/assets/model-provider-catalog.json");
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

async function fetchProviderCatalog() {
  const text = await fetchText(`${MODELS_URL}/api.json`);
  return JSON.parse(text) as ProviderCatalog;
}

function createDisplayCatalog(catalog: ProviderCatalog) {
  return Object.fromEntries(
    Object.entries(catalog)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([providerId, provider]) => [
        providerId,
        {
          name: provider.name ?? providerId,
          models: Object.fromEntries(
            Object.entries(provider.models ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([modelId, model]) => [modelId, model.name ?? modelId]),
          ),
        },
      ]),
  );
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
  const catalog = await fetchProviderCatalog();
  const providerIds = Object.keys(catalog).sort((a, b) => a.localeCompare(b));
  await removeOldSvgs();
  await Promise.all(providerIds.map(syncProviderLogo));
  await writeFile(
    CATALOG_PATH,
    `${JSON.stringify(createDisplayCatalog(catalog), null, 2)}\n`,
  );
  console.log(
    `Synced ${providerIds.length} model provider logos to ${OUTPUT_DIR} and model names to ${CATALOG_PATH}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
