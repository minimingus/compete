import { DiscoveryStrategy, RawSearchData, StrategyContext, DiscoveredCompetitor } from "../types";

function extractDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

function titleFromDomain(domain: string): string {
  return domain
    .replace(/\.(com|io|co|org|net|app|ai)$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const urlDomainStrategy: DiscoveryStrategy = {
  id: "url-domain",

  async run(raw: RawSearchData, ctx: StrategyContext): Promise<DiscoveredCompetitor[]> {
    const domainHits = new Map<string, { count: number; sources: { title: string; url: string }[] }>();

    for (const result of raw.organicResults) {
      const domain = extractDomain(result.url);
      if (!domain || domain === ctx.normalizedDomain || ctx.blocklist.has(domain)) continue;

      const entry = domainHits.get(domain) ?? { count: 0, sources: [] };
      entry.count += 1;
      if (entry.sources.length < 3) entry.sources.push({ title: result.title, url: result.url });
      domainHits.set(domain, entry);
    }

    if (!domainHits.size) return [];

    const maxCount = Math.max(...[...domainHits.values()].map((v) => v.count));

    return [...domainHits.entries()]
      .map(([domain, { count, sources }]) => ({
        name: titleFromDomain(domain),
        domain,
        confidence: parseFloat((count / maxCount).toFixed(2)),
        sources,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  },
};
