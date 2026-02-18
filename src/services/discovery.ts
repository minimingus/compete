import { prisma } from "../lib/prisma";

/**
 * Known page patterns to suggest for each discovered competitor.
 * These are common high-value pages that tend to change when
 * a competitor updates pricing, features, or positioning.
 */
const PAGE_TEMPLATES = [
  { path: "/", label: "Homepage" },
  { path: "/pricing", label: "Pricing" },
  { path: "/features", label: "Features" },
  { path: "/product", label: "Product" },
  { path: "/about", label: "About" },
  { path: "/blog", label: "Blog" },
];

export interface DiscoveryInput {
  projectId: string;
  companyDomain: string;
  keywords?: string[];
}

/**
 * Run competitor discovery for a project.
 *
 * MVP strategy: Use the company domain + keywords to build search queries,
 * then scrape search results to find competitor domains.
 *
 * For v1 this uses a stub that generates placeholder competitors
 * from common "alternatives to" search patterns. Replace the
 * `findCompetitorDomains` call with a real search/scrape implementation.
 */
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

    // Suggest pages for this competitor
    const pagesToCreate = PAGE_TEMPLATES.map((tpl) => ({
      competitorId: competitor.id,
      url: `https://${comp.domain}${tpl.path}`,
      label: tpl.label,
      isActive: false,
    }));

    await prisma.trackedPage.createMany({ data: pagesToCreate });
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

/**
 * Stub: In production, this would perform web searches like:
 *   - "{domain} alternatives"
 *   - "{domain} vs"
 *   - "{keyword} software"
 * and parse the results to extract competitor domains.
 *
 * For MVP, returns placeholder data so the rest of the pipeline works.
 */
async function findCompetitorDomains(
  companyDomain: string,
  keywords?: string[]
): Promise<DiscoveredCompetitor[]> {
  // TODO: Replace with real search/scrape logic (e.g., SerpAPI, Playwright Google scrape)
  const baseName = companyDomain.replace(/\.(com|io|co|org|net)$/, "");
  const searchQuery = keywords?.length
    ? `${baseName} ${keywords.join(" ")} alternatives`
    : `${baseName} alternatives`;

  // Placeholder: return empty array until real discovery is wired up
  console.log(
    `[discovery] Would search for: "${searchQuery}" — returning empty stub results`
  );
  return [];
}
