import { prisma } from "../../lib/prisma";
import { getEnv } from "../../config/env";
import { searchBrave, searchSerperFull } from "./search";
import { resolveStrategies } from "./strategies/index";
import {
  DiscoveryInput,
  RawSearchData,
  DiscoveredCompetitor,
  StrategyContext,
} from "./types";

export type { DiscoveryInput };

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_TEMPLATES = [
  { path: "/", label: "Homepage" },
  { path: "/pricing", label: "Pricing" },
  { path: "/features", label: "Features" },
  { path: "/product", label: "Product" },
  { path: "/about", label: "About" },
  { path: "/blog", label: "Blog" },
];

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
  // Review aggregators & analyst firms
  "gartner.com", "technologyadvice.com", "softwareadvice.com",
  "pcmag.com", "cnet.com", "zdnet.com", "techradar.com",
  "businessinsider.com", "entrepreneur.com", "hubspot.com",
  // Alternatives/comparison sites
  "alternativeto.net", "slant.co", "saasworthy.com", "getapp.com",
  "tomsguide.com", "nerdwallet.com",
]);

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runDiscovery(input: DiscoveryInput): Promise<void> {
  const { projectId, companyDomain, keywords } = input;
  const env = getEnv();

  if (!env.BRAVE_SEARCH_API_KEY && !env.SERPER_API_KEY) {
    console.warn("[discovery] No search API keys configured — skipping discovery");
    return;
  }

  // 1. Resolve strategies from env
  const strategies = resolveStrategies(env.DISCOVERY_STRATEGIES);
  if (!strategies.length) {
    console.warn("[discovery] No valid strategies configured — skipping");
    return;
  }

  // 2. Normalise domain and build queries
  const normalizedDomain = companyDomain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  const baseName = normalizedDomain.replace(/\.(com|io|co|org|net|app|ai)$/, "");

  const queries = [
    `${baseName} alternatives`,
    `${baseName} competitors`,
    ...(keywords?.length ? [`${keywords.join(" ")} alternatives`] : []),
  ];

  // 3. Fetch search data ONCE — shared across all strategies
  const perQueryResults = await Promise.all(
    queries.map(async (q) => {
      const [braveResults, serperResult] = await Promise.all([
        searchBrave(q),
        searchSerperFull(q),
      ]);
      return { query: q, braveResults, serperResult };
    })
  );

  const raw: RawSearchData = {
    organicResults: perQueryResults.flatMap((r) => [
      ...r.braveResults,
      ...r.serperResult.organic,
    ]),
    serperExtras: new Map(
      perQueryResults.map((r) => [r.query, r.serperResult.extras])
    ),
  };

  console.log(
    `[discovery] ${raw.organicResults.length} organic results for "${normalizedDomain}" ` +
    `via [${strategies.map((s) => s.id).join(", ")}]`
  );

  // 4. Build shared context
  const ctx: StrategyContext = {
    normalizedDomain,
    baseName,
    blocklist: DOMAIN_BLOCKLIST,
  };

  // 5. Run all strategies in parallel
  const resultSets = await Promise.all(
    strategies.map((s) =>
      s.run(raw, ctx).catch((err) => {
        console.error(`[discovery] Strategy "${s.id}" threw:`, err);
        return [] as DiscoveredCompetitor[];
      })
    )
  );

  // 6. Merge, deduplicate and rescore
  const merged = mergeResults(resultSets);

  if (!merged.length) {
    console.warn("[discovery] No competitors found after all strategies");
    return;
  }

  console.log(
    `[discovery] ${merged.length} competitors: ${merged.map((c) => c.domain).join(", ")}`
  );

  // 7. Persist — flat creates to avoid Neon implicit transaction issues
  for (const comp of merged) {
    const competitor = await prisma.competitor.create({
      data: {
        projectId,
        name: comp.name,
        domain: comp.domain,
        status: "suggested",
        confidence: comp.confidence,
      },
    });

    if (comp.sources.length > 0) {
      await prisma.competitorSource.createMany({
        data: comp.sources.map((s) => ({
          competitorId: competitor.id,
          title: s.title,
          url: s.url,
        })),
      });
    }

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

// ── Result merging ────────────────────────────────────────────────────────────

function mergeResults(resultSets: DiscoveredCompetitor[][]): DiscoveredCompetitor[] {
  const domainMap = new Map<
    string,
    { confidences: number[]; name: string; sources: { title: string; url: string }[] }
  >();

  for (const results of resultSets) {
    for (const comp of results) {
      const existing = domainMap.get(comp.domain);
      if (!existing) {
        domainMap.set(comp.domain, {
          confidences: [comp.confidence],
          name: comp.name,
          sources: [...comp.sources],
        });
      } else {
        existing.confidences.push(comp.confidence);
        if (comp.confidence > Math.max(...existing.confidences)) {
          existing.name = comp.name;
        }
        for (const src of comp.sources) {
          if (existing.sources.length < 5 && !existing.sources.some((s) => s.url === src.url)) {
            existing.sources.push(src);
          }
        }
      }
    }
  }

  if (!domainMap.size) return [];

  const withScore = [...domainMap.entries()].map(([domain, data]) => ({
    domain,
    name: data.name,
    sources: data.sources,
    rawScore: data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length,
  }));

  const maxScore = Math.max(...withScore.map((r) => r.rawScore));

  return withScore
    .map((r) => ({
      name: r.name,
      domain: r.domain,
      confidence: parseFloat((r.rawScore / maxScore).toFixed(2)),
      sources: r.sources,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}
