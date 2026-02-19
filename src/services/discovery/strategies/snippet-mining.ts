import { DiscoveryStrategy, RawSearchData, StrategyContext, DiscoveredCompetitor } from "../types";

// ── Regex patterns ────────────────────────────────────────────────────────────

// "Notion vs Coda"  /  "notion vs. obsidian"
const VS_PATTERN = /\b([\w][\w\s]{0,24}?)\s+vs\.?\s+([\w][\w\s]{0,24}?)\b/gi;

// "alternatives: Foo, Bar, Baz"  /  "alternatives to X: ..."
const ALTERNATIVES_PATTERN =
  /alternatives(?:\s+to\s+[\w\s]{1,30})?:\s*((?:[\w][\w\s]{0,20}?,?\s*){1,10})/gi;

// Numbered or bulleted list items: "1. Coda"  /  "- Obsidian"  /  "• ClickUp"
const LIST_ITEM_PATTERN = /^[\s]*(?:\d+\.|[-•*])\s+([\w][\w\s]{0,28}?)\s*$/gm;

// ── Domain resolution ─────────────────────────────────────────────────────────

const TLD_CANDIDATES = [".com", ".io", ".app", ".ai", ".co"];

async function resolveToDomain(
  name: string,
  organicResults: RawSearchData["organicResults"]
): Promise<string | null> {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9-]/g, "");

  if (!slug || slug.length < 2) return null;

  // Pass 1: match against organic result hostnames — zero extra network calls
  for (const r of organicResults) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (host.startsWith(slug) && host.length > slug.length) return host;
    } catch {
      // skip malformed URLs
    }
  }

  // Pass 2: parallel HEAD probes across TLD candidates
  const results = await Promise.all(
    TLD_CANDIDATES.map(async (tld) => {
      const domain = `${slug}${tld}`;
      try {
        const res = await fetch(`https://${domain}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(2_000),
          redirect: "manual",
        });
        return { domain, ok: res.status < 600 };
      } catch {
        return { domain, ok: false };
      }
    })
  );

  return results.find((r) => r.ok)?.domain ?? null;
}

// ── Strategy ──────────────────────────────────────────────────────────────────

export const snippetMiningStrategy: DiscoveryStrategy = {
  id: "snippet-mining",

  async run(raw: RawSearchData, ctx: StrategyContext): Promise<DiscoveredCompetitor[]> {
    const nameFreq = new Map<string, number>();

    function recordName(raw: string) {
      const name = raw.trim().replace(/\s+/g, " ");
      if (!name || name.length < 2 || name.length > 40) return;
      if (name.toLowerCase().includes(ctx.baseName.toLowerCase())) return;
      nameFreq.set(name, (nameFreq.get(name) ?? 0) + 1);
    }

    // ── Mine organic snippets and titles ──────────────────────────────────────
    for (const result of raw.organicResults) {
      for (const text of [result.snippet, result.title]) {
        let m: RegExpExecArray | null;

        VS_PATTERN.lastIndex = 0;
        while ((m = VS_PATTERN.exec(text)) !== null) {
          recordName(m[1]);
          recordName(m[2]);
        }

        ALTERNATIVES_PATTERN.lastIndex = 0;
        while ((m = ALTERNATIVES_PATTERN.exec(text)) !== null) {
          for (const part of m[1].split(/,\s*/)) recordName(part);
        }

        LIST_ITEM_PATTERN.lastIndex = 0;
        while ((m = LIST_ITEM_PATTERN.exec(text)) !== null) recordName(m[1]);
      }
    }

    // ── Mine relatedSearches ──────────────────────────────────────────────────
    for (const [, extras] of raw.serperExtras) {
      for (const { query } of extras.relatedSearches) {
        let m: RegExpExecArray | null;

        VS_PATTERN.lastIndex = 0;
        while ((m = VS_PATTERN.exec(query)) !== null) {
          recordName(m[1]);
          recordName(m[2]);
        }

        ALTERNATIVES_PATTERN.lastIndex = 0;
        while ((m = ALTERNATIVES_PATTERN.exec(query)) !== null) {
          for (const part of m[1].split(/,\s*/)) recordName(part);
        }
      }
    }

    // ── Mine peopleAlsoAsk snippets ───────────────────────────────────────────
    for (const [, extras] of raw.serperExtras) {
      for (const { snippet } of extras.peopleAlsoAsk) {
        if (!snippet) continue;
        let m: RegExpExecArray | null;

        VS_PATTERN.lastIndex = 0;
        while ((m = VS_PATTERN.exec(snippet)) !== null) {
          recordName(m[1]);
          recordName(m[2]);
        }

        ALTERNATIVES_PATTERN.lastIndex = 0;
        while ((m = ALTERNATIVES_PATTERN.exec(snippet)) !== null) {
          for (const part of m[1].split(/,\s*/)) recordName(part);
        }

        LIST_ITEM_PATTERN.lastIndex = 0;
        while ((m = LIST_ITEM_PATTERN.exec(snippet)) !== null) recordName(m[1]);
      }
    }

    if (!nameFreq.size) return [];

    // Resolve top-20 candidates to domains in parallel
    const maxFreq = Math.max(...nameFreq.values());
    const candidates = [...nameFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const resolved = await Promise.all(
      candidates.map(async ([name, freq]) => {
        const domain = await resolveToDomain(name, raw.organicResults);
        return domain ? { name, domain, freq } : null;
      })
    );

    // Deduplicate by domain, apply blocklist
    const domainMap = new Map<string, { name: string; freq: number }>();
    for (const r of resolved) {
      if (!r) continue;
      if (r.domain === ctx.normalizedDomain || ctx.blocklist.has(r.domain)) continue;
      const existing = domainMap.get(r.domain);
      if (!existing || r.freq > existing.freq) domainMap.set(r.domain, r);
    }

    if (!domainMap.size) return [];

    return [...domainMap.entries()]
      .map(([domain, { name, freq }]) => ({
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        domain,
        confidence: parseFloat((freq / maxFreq).toFixed(2)),
        sources: [],
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  },
};
