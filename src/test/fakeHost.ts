import { setDailyHost, type ModelInvokeRequest } from "@daily/plugin-sdk";
import type { DailyPluginApi } from "../host";
import type { NetworkFetchResponse } from "../types";

export type FakeHost = {
  storage: Map<string, unknown>;
  modelCalls: ModelInvokeRequest[];
  fetchCalls: string[];
  model: (request: ModelInvokeRequest) => Promise<string> | string;
  fetch: (url: string) => Promise<NetworkFetchResponse> | NetworkFetchResponse;
};

/** In-memory host API with JSON-equality CAS, matching the real storage semantics. */
export function installFakeHost(overrides: Partial<Pick<FakeHost, "model" | "fetch">> = {}): FakeHost {
  const fake: FakeHost = {
    storage: new Map(),
    modelCalls: [],
    fetchCalls: [],
    model: overrides.model ?? (() => "{}"),
    fetch: overrides.fetch ?? ((url) => jsonFeed(url, [])),
  };
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const api = {
    pluginId: "daily.trading_timeline",
    request: async () => null,
    host: { getContext: async () => ({}), setDirty: async () => null },
    storage: {
      get: async (key: string) => structuredClone(fake.storage.get(key) ?? null),
      set: async (key: string, value: unknown) => { fake.storage.set(key, structuredClone(value)); },
      compareAndSet: async (key: string, expected: unknown, value: unknown) => {
        if (!equal(fake.storage.get(key) ?? null, expected)) return false;
        fake.storage.set(key, structuredClone(value));
        return true;
      },
      compareAndRemove: async (key: string, expected: unknown) => {
        if (!equal(fake.storage.get(key) ?? null, expected)) return false;
        fake.storage.delete(key);
        return true;
      },
      remove: async (key: string) => { fake.storage.delete(key); },
      list: async () => Object.fromEntries(fake.storage),
    },
    model: {
      invoke: async (request: ModelInvokeRequest) => {
        fake.modelCalls.push(request);
        return { text: await fake.model(request) };
      },
      list: async () => ({
        default: { authConfigId: "codex-default", model: "gpt-5.5" },
        providers: [{ id: "codex-default", name: "Codex", providerKind: "codex_login", models: ["gpt-5.5", "gpt-5.4-mini"], defaultModel: "gpt-5.5" }],
      }),
    },
    network: {
      fetch: async (url: string) => {
        fake.fetchCalls.push(url);
        return fake.fetch(url);
      },
    },
  } as unknown as DailyPluginApi;
  setDailyHost(api);
  return fake;
}

export function uninstallFakeHost() {
  setDailyHost(null);
}

export type FeedItem = { title: string; url: string; publishedAt?: string };

/** JSON feed response (avoids DOMParser, which the node test environment lacks). */
export function jsonFeed(url: string, items: FeedItem[]): NetworkFetchResponse {
  return {
    ok: true,
    status: 200,
    url,
    contentType: "application/json",
    text: JSON.stringify({ items: items.map((item) => ({ ...item, publishedAt: item.publishedAt ?? "2026-10-10T00:00:00.000Z" })) }),
  };
}
