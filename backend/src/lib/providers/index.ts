import type { InstagramResolver } from "../types.js";
import { MockProvider } from "./mock.js";
import { ExternalProvider } from "./external.js";
import { PuppeteerProvider } from "./puppeteer.js";
import { logger } from "../logger.js";

let cachedProvider: InstagramResolver | null = null;

export function getProvider(): InstagramResolver {
  if (cachedProvider) return cachedProvider;
  cachedProvider = createProvider();
  return cachedProvider;
}

export function createProvider(): InstagramResolver {
  const providerName = process.env.RESOLVER_PROVIDER || "placeholder";

  switch (providerName) {
    case "mock": {
      logger.info("Using mock provider");
      return new MockProvider();
    }

    case "external": {
      const apiUrl = process.env.PROVIDER_API_URL;
      const apiKey = process.env.PROVIDER_API_KEY;

      if (!apiUrl || !apiKey) {
        logger.warn("External provider configured but missing credentials", {
          hasApiUrl: !!apiUrl,
          hasApiKey: !!apiKey,
        });
        return createNotConfiguredProvider();
      }

      logger.info("Using external provider", { apiUrl: apiUrl.slice(0, 50) });
      return new ExternalProvider(apiUrl, apiKey);
    }

    case "puppeteer": {
      logger.info("Using puppeteer provider (headless browser)");
      return new PuppeteerProvider();
    }

    case "placeholder":
    default: {
      return createNotConfiguredProvider();
    }
  }
}

function createNotConfiguredProvider(): InstagramResolver {
  return {
    name: "not-configured",
    async resolve() {
      const { createError } = await import("../errors.js");
      throw createError("PROVIDER_NOT_CONFIGURED");
    },
  };
}
