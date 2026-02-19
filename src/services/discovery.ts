import { prisma } from "../lib/prisma";
import { getEnv } from "../config/env";

const PAGE_TEMPLATES = [
  { path: "/", label: "Homepage" },
  { path: "/pricing", label: "Pricing" },
  { path: "/features", label: "Features" },
  { path: "/product", label: "Product" },
  { path: "/about", label: "About" },
  { path: "/blog", label: "Blog" },
];

// Domains that appear in search results but are never competitors
const DOMAIN_BLOCKLIST = new Set([
  "google.com", "google.co.uk", "googleapis.com",
  "youtube.com", "reddit.com", "twitter.com", "x.com",
  "linkedin.com", "facebook.com", "instagram.com",
  "wikipedia.org", "wikimedia.org",
  "medium.com", "substack.com", "wordpress.com",
  "github.com", "stackoverflow.com", "quora.com",
  "trustpilot.com", "g2.com", "capterra.com", "getapp.com",
  "producthunt.com", "techcrunch.com", "forbes.com",
  "crunchbase.com", "pitchbook.com", "ycombinator.com",
  "alternativeto.net", "slant.co", "saasworthy.com",
  "cloudflare.com", "amazonaws.com", "vercel.app",
]);

export interface DiscoveryInput {
  projectId: string;
  companyDomain: string;
  keywords?: string[];
}

export async function runDiscovery(input: DiscoveryInput): Promise<void> {
  const { projectId, companyDomain, keywords } = input;

  const competitors = await findCompetitorDomains(companyDomain, keywords);

  for (const comp of competitors) {
    const competitor = await prisma.competitor.create({
      data: {
        projectId,
        name: comp.name,
        domain: comp.domain,
        status: "suggested",
        confidence: comp.confidence,
        sources: {
          create: comp.sources.map((s) => ({ title: s.title, url: s.url })),
        },
      },
    });

    await prisma.trackedPage.createMany({
      data: PAGE_TEMPLATES.map((tpl) => ({
        competitorId: competitor.id,
        url: `https://${comp.domain}${tpl.path}`,
        label: tpl.label,
        isActive: false,
      })),
    });
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "discovery_pending" },
  });
}

interface DiscoveredCompetitor {
  name: string;
  domain: string;
  confidence: number;
  sources: { title: string; url: string }[];
}

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

// ── Brave Search ──────────────────────────────────────────────────────────────

async function searchBrave(query: string): Promise<SearchResult[]> {
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

  const data = await res.json() as any;
  return (data?.web?.results ?? []).map((r: any) => ({
    url: r.url ?? "",
    title: r.title ?? "",
    snippet: r.description ?? "",
  }));
}

// ── Serper.dev ────────────────────────────────────────────────────────────────

async function searchSerper(query: string): Promise<SearchResult[]> {
  const key = getEnv().SERPER_API_KEY;
  if (!key) return [];

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    console.warn(`[discovery] Serper search failed: ${res.status}`);
    return [];
  }

  const data = await res.json() as any;
  return (data?.organic ?? []).map((r: any) => ({
    url: r.link ?? "",
    title: r.title ?? "",
    snippet: r.snippet ?? "",
  }));
}

// ── Domain extraction & scoring ───────────────────────────────────────────────

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

async function findCompetitorDomains(
  companyDomain: string,
  keywords?: string[]
): Promise<DiscoveredCompetitor[]> {
  const env = getEnv();
  if (!env.BRAVE_SEARCH_API_KEY && !env.SERPER_API_KEY) {
    console.warn("[discovery] No search API keys configured — skipping discovery");
    return [];
  }

  const baseName = companyDomain.replace(/\.(com|io|co|org|net|app|ai)$/, "");
  const queries = [
    `${baseName} alternatives`,
    `${baseName} competitors`,
    ...(keywords?.length ? [`${keywords.join(" ")} alternatives`] : []),
  ];

  // Run all queries across both providers in parallel
  const searchPromises = queries.flatMap((q) => [searchBrave(q), searchSerper(q)]);
  const allResultSets = await Promise.all(searchPromises);
  const allResults = allResultSets.flat();

  console.log(`[discovery] Got ${allResults.length} total search results for "${companyDomain}"`);

  // Score domains by how often they appear across results
  const domainHits = new Map<string, { count: number; sources: { title: string; url: string }[] }>();

  for (const result of allResults) {
    const domain = extractDomain(result.url);
    if (!domain) continue;
    if (domain === companyDomain) continue;
    if (DOMAIN_BLOCKLIST.has(domain)) continue;

    const entry = domainHits.get(domain) ?? { count: 0, sources: [] };
    entry.count += 1;
    if (entry.sources.length < 3) {
      entry.sources.push({ title: result.title, url: result.url });
    }
    domainHits.set(domain, entry);
  }

  if (!domainHits.size) {
    console.warn("[discovery] No competitor domains extracted from search results");
    return [];
  }

  const maxCount = Math.max(...[...domainHits.values()].map((v) => v.count));

  const competitors: DiscoveredCompetitor[] = [...domainHits.entries()]
    .map(([domain, { count, sources }]) => ({
      name: titleFromDomain(domain),
      domain,
      confidence: parseFloat((count / maxCount).toFixed(2)),
      sources,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  console.log(
    `[discovery] Found ${competitors.length} competitors: ${competitors.map((c) => c.domain).join(", ")}`
  );

  return competitors;
}
