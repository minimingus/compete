import { getEnv } from "../../config/env";
import { SearchResult, SerperExtras } from "./types";

// ── Brave ─────────────────────────────────────────────────────────────────────

export async function searchBrave(query: string): Promise<SearchResult[]> {
  const key = getEnv().BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    console.warn(`[discovery] Brave search failed: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as any;
  return (data?.web?.results ?? []).map((r: any) => ({
    url: r.url ?? "",
    title: r.title ?? "",
    snippet: r.description ?? "",
  }));
}

// ── Serper ────────────────────────────────────────────────────────────────────

export interface SerperFullResult {
  organic: SearchResult[];
  extras: SerperExtras;
}

export async function searchSerperFull(query: string): Promise<SerperFullResult> {
  const key = getEnv().SERPER_API_KEY;
  if (!key) {
    return { organic: [], extras: { relatedSearches: [], peopleAlsoAsk: [] } };
  }

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    console.warn(`[discovery] Serper search failed: ${res.status}`);
    return { organic: [], extras: { relatedSearches: [], peopleAlsoAsk: [] } };
  }

  const data = (await res.json()) as any;

  const organic: SearchResult[] = (data?.organic ?? []).map((r: any) => ({
    url: r.link ?? "",
    title: r.title ?? "",
    snippet: r.snippet ?? "",
  }));

  const extras: SerperExtras = {
    relatedSearches: (data?.relatedSearches ?? []).map((r: any) => ({
      query: r.query ?? "",
    })),
    peopleAlsoAsk: (data?.peopleAlsoAsk ?? []).map((r: any) => ({
      question: r.question ?? "",
      snippet: r.snippet ?? null,
    })),
  };

  return { organic, extras };
}
