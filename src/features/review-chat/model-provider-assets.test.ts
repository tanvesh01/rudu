import { describe, expect, it } from "bun:test";
import {
  createMemoryModelProviderAssetCache,
  loadModelProviderCatalog,
  loadModelProviderLogo,
  sanitizeModelProviderSvg,
} from "./model-provider-assets";

const NOW = 1_700_000_000_000;
const FRESH = NOW - 60_000;
const STALE = NOW - 25 * 60 * 60 * 1000;

describe("model provider assets", () => {
  it("uses a fresh filesystem catalog cache without fetching", async () => {
    const cache = createMemoryModelProviderAssetCache({
      catalog: {
        body: JSON.stringify({
          openai: {
            name: "OpenAI",
            models: { "gpt-5": { name: "GPT-5" } },
          },
        }),
        cachedAtMs: FRESH,
      },
    });
    const fetchedUrls: string[] = [];

    const result = await loadModelProviderCatalog({
      cache,
      fetchText: async (url) => {
        fetchedUrls.push(url);
        throw new Error("should not fetch");
      },
      now: () => NOW,
    });

    expect(result.catalog?.openai.name).toBe("OpenAI");
    expect(result.catalog?.openai.models["gpt-5"]).toBe("GPT-5");
    expect(result.refresh).toBeNull();
    expect(fetchedUrls).toEqual([]);
  });

  it("returns stale cached catalog while refreshing remotely", async () => {
    const cache = createMemoryModelProviderAssetCache({
      catalog: {
        body: JSON.stringify({
          openai: {
            name: "Cached OpenAI",
            models: { "gpt-5": { name: "Cached GPT-5" } },
          },
        }),
        cachedAtMs: STALE,
      },
    });

    const result = await loadModelProviderCatalog({
      cache,
      fetchText: async () =>
        JSON.stringify({
          openai: {
            name: "Remote OpenAI",
            models: { "gpt-5": { name: "Remote GPT-5" } },
          },
        }),
      now: () => NOW,
    });

    expect(result.catalog?.openai.name).toBe("Cached OpenAI");
    expect(result.refresh).not.toBeNull();

    const refreshed = await result.refresh;
    expect(refreshed?.openai.name).toBe("Remote OpenAI");
    expect((await cache.readCatalog())?.body).toContain("Remote OpenAI");
  });

  it("falls back to cached catalog when remote refresh fails", async () => {
    const cache = createMemoryModelProviderAssetCache({
      catalog: {
        body: JSON.stringify({ openai: { name: "Cached OpenAI" } }),
        cachedAtMs: STALE,
      },
    });

    const result = await loadModelProviderCatalog({
      cache,
      fetchText: async () => {
        throw new Error("offline");
      },
      now: () => NOW,
    });

    expect(result.catalog?.openai.name).toBe("Cached OpenAI");
    await expect(result.refresh).resolves.toBeNull();
  });

  it("sanitizes provider SVGs before rendering or caching", async () => {
    expect(sanitizeModelProviderSvg("openai", "<svg><path /></svg>")).toBe(
      "<svg><path /></svg>",
    );
    expect(
      sanitizeModelProviderSvg("openai", "<svg onload=\"alert(1)\"></svg>"),
    ).toBeNull();
    expect(
      sanitizeModelProviderSvg("openai", "<svg><script /></svg>"),
    ).toBeNull();
    expect(
      sanitizeModelProviderSvg(
        "openai",
        "<svg><a href=\"javascript:alert(1)\"></a></svg>",
      ),
    ).toBeNull();
  });

  it("loads provider logos lazily and rejects unsafe remote SVG", async () => {
    const cache = createMemoryModelProviderAssetCache();

    const result = await loadModelProviderLogo("openai", {
      cache,
      fetchText: async () => "<svg><script /></svg>",
      now: () => NOW,
    });

    expect(result.svg).toBeNull();
    expect(result.refresh).toBeNull();
    expect(await cache.readLogo("openai")).toBeNull();
  });
});
