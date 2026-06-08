import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type RawProviderCatalog = Record<
  string,
  {
    models?: Record<string, { name?: string } | string>;
    name?: string;
  }
>;

type ModelProviderCatalog = Record<
  string,
  {
    models: Record<string, string>;
    name: string;
  }
>;

type ModelProviderAssetCacheEntry = {
  body: string;
  cachedAtMs: number;
};

type ModelProviderAssetCache = {
  readCatalog(): Promise<ModelProviderAssetCacheEntry | null>;
  writeCatalog(body: string): Promise<void>;
  readLogo(providerId: string): Promise<ModelProviderAssetCacheEntry | null>;
  writeLogo(providerId: string, body: string): Promise<void>;
};

type LoadModelProviderAssetOptions = {
  cache?: ModelProviderAssetCache;
  fetchText?: (url: string) => Promise<string>;
  now?: () => number;
};

type LoadModelProviderCatalogResult = {
  catalog: ModelProviderCatalog | null;
  refresh: Promise<ModelProviderCatalog | null> | null;
};

type LoadModelProviderLogoResult = {
  refresh: Promise<string | null> | null;
  svg: string | null;
};

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const MODELS_DEV_URL = "https://models.dev";
const MODEL_PROVIDER_ASSET_STALE_MS = 24 * 60 * 60 * 1000;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function createNativeModelProviderAssetCache(
  invokeCommand: InvokeFn = invoke,
): ModelProviderAssetCache {
  return {
    readCatalog() {
      return invokeCommand<ModelProviderAssetCacheEntry | null>(
        "read_model_provider_catalog_cache",
      );
    },
    writeCatalog(body: string) {
      return invokeCommand<void>("write_model_provider_catalog_cache", {
        body,
      });
    },
    readLogo(providerId: string) {
      return invokeCommand<ModelProviderAssetCacheEntry | null>(
        "read_model_provider_logo_cache",
        { providerId },
      );
    },
    writeLogo(providerId: string, body: string) {
      return invokeCommand<void>("write_model_provider_logo_cache", {
        providerId,
        body,
      });
    },
  };
}

function createMemoryModelProviderAssetCache(initial?: {
  catalog?: ModelProviderAssetCacheEntry;
  logos?: Record<string, ModelProviderAssetCacheEntry>;
}): ModelProviderAssetCache {
  let catalog = initial?.catalog ?? null;
  const logos = new Map<string, ModelProviderAssetCacheEntry>(
    Object.entries(initial?.logos ?? {}),
  );

  return {
    async readCatalog() {
      return catalog;
    },
    async writeCatalog(body: string) {
      catalog = { body, cachedAtMs: Date.now() };
    },
    async readLogo(providerId: string) {
      return logos.get(providerId) ?? null;
    },
    async writeLogo(providerId: string, body: string) {
      logos.set(providerId, { body, cachedAtMs: Date.now() });
    },
  };
}

async function defaultFetchText(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function isCacheFresh(entry: ModelProviderAssetCacheEntry, now: number) {
  return now - entry.cachedAtMs < MODEL_PROVIDER_ASSET_STALE_MS;
}

function parseModelProviderCatalog(body: string): ModelProviderCatalog | null {
  try {
    const catalog = JSON.parse(body) as RawProviderCatalog;
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
                .map(([modelId, model]) => [
                  modelId,
                  typeof model === "string" ? model : model.name ?? modelId,
                ]),
            ),
          },
        ]),
    );
  } catch {
    return null;
  }
}

function sanitizeModelProviderSvg(providerId: string, body: string) {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    return null;
  }

  if (!body.includes("<svg")) {
    return null;
  }

  if (/<script[\s>]/i.test(body) || /\son[a-z]+\s*=/i.test(body) || /javascript:/i.test(body)) {
    return null;
  }

  return body;
}

async function refreshModelProviderCatalog({
  cache = nativeModelProviderAssetCache,
  fetchText = defaultFetchText,
}: LoadModelProviderAssetOptions = {}) {
  try {
    const body = await fetchText(`${MODELS_DEV_URL}/api.json`);
    const catalog = parseModelProviderCatalog(body);

    if (!catalog) {
      return null;
    }

    await cache.writeCatalog(body).catch(() => undefined);
    return catalog;
  } catch {
    return null;
  }
}

async function loadModelProviderCatalog({
  cache = nativeModelProviderAssetCache,
  fetchText = defaultFetchText,
  now = Date.now,
}: LoadModelProviderAssetOptions = {}): Promise<LoadModelProviderCatalogResult> {
  const cachedEntry = await cache.readCatalog().catch(() => null);
  const cachedCatalog = cachedEntry
    ? parseModelProviderCatalog(cachedEntry.body)
    : null;

  if (cachedEntry && cachedCatalog && isCacheFresh(cachedEntry, now())) {
    return { catalog: cachedCatalog, refresh: null };
  }

  const refresh = refreshModelProviderCatalog({ cache, fetchText });

  if (cachedCatalog) {
    return { catalog: cachedCatalog, refresh };
  }

  return { catalog: await refresh, refresh: null };
}

async function refreshModelProviderLogo(
  providerId: string,
  {
    cache = nativeModelProviderAssetCache,
    fetchText = defaultFetchText,
  }: LoadModelProviderAssetOptions = {},
) {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    return null;
  }

  try {
    const body = await fetchText(`${MODELS_DEV_URL}/logos/${providerId}.svg`);
    const svg = sanitizeModelProviderSvg(providerId, body);

    if (!svg) {
      return null;
    }

    await cache.writeLogo(providerId, svg).catch(() => undefined);
    return svg;
  } catch {
    return null;
  }
}

async function loadModelProviderLogo(
  providerId: string,
  {
    cache = nativeModelProviderAssetCache,
    fetchText = defaultFetchText,
    now = Date.now,
  }: LoadModelProviderAssetOptions = {},
): Promise<LoadModelProviderLogoResult> {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    return { svg: null, refresh: null };
  }

  const cachedEntry = await cache.readLogo(providerId).catch(() => null);
  const cachedSvg = cachedEntry
    ? sanitizeModelProviderSvg(providerId, cachedEntry.body)
    : null;

  if (cachedEntry && cachedSvg && isCacheFresh(cachedEntry, now())) {
    return { svg: cachedSvg, refresh: null };
  }

  const refresh = refreshModelProviderLogo(providerId, { cache, fetchText });

  if (cachedSvg) {
    return { svg: cachedSvg, refresh };
  }

  return { svg: await refresh, refresh: null };
}

function useModelProviderCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<ModelProviderCatalog | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isCurrent = true;

    void loadModelProviderCatalog().then((result) => {
      if (!isCurrent) return;

      setCatalog(result.catalog);
      if (result.refresh) {
        void result.refresh.then((refreshed) => {
          if (isCurrent && refreshed) {
            setCatalog(refreshed);
          }
        });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [enabled]);

  return catalog;
}

function useModelProviderLogo(providerId: string) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setSvg(null);

    void loadModelProviderLogo(providerId).then((result) => {
      if (!isCurrent) return;

      setSvg(result.svg);
      if (result.refresh) {
        void result.refresh.then((refreshed) => {
          if (isCurrent && refreshed) {
            setSvg(refreshed);
          }
        });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [providerId]);

  return svg;
}

const nativeModelProviderAssetCache = createNativeModelProviderAssetCache();

export {
  createMemoryModelProviderAssetCache,
  createNativeModelProviderAssetCache,
  loadModelProviderCatalog,
  loadModelProviderLogo,
  parseModelProviderCatalog,
  sanitizeModelProviderSvg,
  useModelProviderCatalog,
  useModelProviderLogo,
};
export type {
  ModelProviderAssetCache,
  ModelProviderAssetCacheEntry,
  ModelProviderCatalog,
};
