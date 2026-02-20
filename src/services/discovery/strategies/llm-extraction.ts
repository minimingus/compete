import { DiscoveryStrategy, RawSearchData, StrategyContext, DiscoveredCompetitor } from "../types";
import { getEnv } from "../../../config/env";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_SNIPPET_CHARS = 6000; // stay well within Haiku context

interface LLMCompetitor {
  name: string;
  domain: string;
  confidence: number;
}

async function callClaude(prompt: string, apiKey: string): Promise<LLMCompetitor[]> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You are a competitive intelligence assistant. " +
        "Respond with valid JSON only — no markdown, no explanation.",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text: string = data?.content?.[0]?.text ?? "";

  // Strip optional ```json fences just in case
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("LLM did not return an array");
  return parsed as LLMCompetitor[];
}

export const llmExtractionStrategy: DiscoveryStrategy = {
  id: "llm-extraction",

  async run(raw: RawSearchData, ctx: StrategyContext): Promise<DiscoveredCompetitor[]> {
    const apiKey = getEnv().ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[discovery] llm-extraction: ANTHROPIC_API_KEY not set — skipping");
      return [];
    }

    // Build a compact text blob from organic snippets + PAA answers
    const snippetLines: string[] = [];

    for (const r of raw.organicResults) {
      if (r.snippet) snippetLines.push(`- ${r.title}: ${r.snippet}`);
    }
    for (const [, extras] of raw.serperExtras) {
      for (const { question, snippet } of extras.peopleAlsoAsk) {
        if (snippet) snippetLines.push(`Q: ${question}\nA: ${snippet}`);
      }
    }

    // Truncate so we don't blow the token budget
    let blob = snippetLines.join("\n");
    if (blob.length > MAX_SNIPPET_CHARS) blob = blob.slice(0, MAX_SNIPPET_CHARS) + "…";

    const prompt = `
I am researching competitors of the company "${ctx.baseName}" (${ctx.normalizedDomain}).

Here are search result snippets about their competitors:
${blob}

Return a JSON array of up to 10 direct competitors. Each element must have:
  "name"       — company name (string)
  "domain"     — primary domain without www or https:// (string, e.g. "paypal.com")
  "confidence" — 0.0–1.0, how certain you are this is a direct competitor (number)

Rules:
- Only include companies that sell directly competing products/services.
- Exclude the subject company itself (${ctx.baseName} / ${ctx.normalizedDomain}).
- Exclude generic platforms, news sites, review aggregators.
- Use your general knowledge to fill in correct domains even if not in the snippets.
- Return ONLY the JSON array, nothing else.

Example format:
[{"name":"Acme","domain":"acme.com","confidence":0.9}]
`.trim();

    let llmResults: LLMCompetitor[];
    try {
      llmResults = await callClaude(prompt, apiKey);
    } catch (err) {
      console.error("[discovery] llm-extraction failed:", err);
      return [];
    }

    // Validate and clean results
    const competitors: DiscoveredCompetitor[] = [];
    for (const item of llmResults) {
      if (!item.name || !item.domain || typeof item.confidence !== "number") continue;

      // Normalise domain
      const domain = item.domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .toLowerCase()
        .trim();

      if (!domain.includes(".")) continue;
      if (domain === ctx.normalizedDomain) continue;
      if (ctx.blocklist.has(domain)) continue;

      competitors.push({
        name: item.name.trim(),
        domain,
        confidence: Math.min(1, Math.max(0, item.confidence)),
        sources: [],
      });
    }

    console.log(
      `[discovery] llm-extraction found ${competitors.length} competitors: ` +
        competitors.map((c) => c.domain).join(", ")
    );

    return competitors;
  },
};
