import { DiscoveryStrategy, RawSearchData, StrategyContext, DiscoveredCompetitor } from "../types";

// ── Stop words — common English words that are never product names ─────────────
const STOP_WORDS = new Set([
  "the", "best", "top", "great", "good", "our", "for", "and", "with", "in",
  "on", "at", "by", "as", "is", "an", "a", "from", "to", "of", "or", "but",
  "if", "not", "that", "this", "it", "we", "you", "they", "here", "also",
  "most", "more", "when", "where", "which", "there", "your", "their", "both",
  "new", "free", "better", "popular", "many", "some", "other", "another",
  "looking", "similar", "great", "perfect", "ideal", "typical", "general",
  "local", "online", "platform", "marketplace", "website", "site", "app",
  "service", "tool", "software", "option", "choice", "pick", "way",
  "selling", "buying", "seller", "buyer",
  "yes", "no", "get", "make", "take", "see", "read", "learn", "find", "use",
  "here", "check", "visit", "click", "sign", "start", "join", "try", "buy",
]);

// ── Pattern 1: connectors — "such as X, Y, Z" / "can be X, Y, Z" ─────────────
// Matches comma-separated proper-ish nouns after connecting phrases
const CONNECTOR_PATTERN =
  /\b(?:such as|including|include[s]?|can be|like|try|consider|are|use)\s+((?:[A-Z\d][\w]*(?:\s+[A-Z][\w]*)*(?:,\s*)?)+)/g;

// ── Pattern 2: "X vs Y" ───────────────────────────────────────────────────────
const VS_PATTERN = /\b([A-Z][\w]+(?:\s+[A-Z][\w]+)?)\s+vs\.?\s+([A-Z][\w]+(?:\s+[A-Z][\w]+)?)\b/g;

// ── Pattern 3: alternatives/competitors colon list ────────────────────────────
const COLON_LIST_PATTERN =
  /\b(?:alternatives?|competitors?|options?)\b[^:]*:\s*((?:[A-Z][\w]+(?:\s+[A-Z][\w]+)*(?:,\s*)?)+)/gi;

// ── Pattern 4: "Name. description" or "Name. ..." — common in PAA answers ─────
// No ^ anchor so it catches all occurrences, not just line-start
const NAME_DOT_PATTERN = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\.\s+(?:[A-Z]|\.\.\.)/g;

// ── Pattern 5: title-case proper nouns in sentences containing context words ──
// "Amazon and Walmart Marketplace both offer..." → Amazon, Walmart Marketplace
const CONTEXT_SENTENCE_PATTERN =
  /[^.!?]*\b(?:alternative|competitor|similar|instead|option|marketplace|platform|sell|selling)\b[^.!?]*/gi;

// ── Domain resolution ─────────────────────────────────────────────────────────

const TLD_CANDIDATES = [".com", ".io", ".app", ".ai", ".co", ".org", ".net"];

async function resolveToDomain(
  name: string,
  organicResults: RawSearchData["organicResults"]
): Promise<string | null> {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9-]/g, "");

  if (!slug || slug.length < 2) return null;

  // Pass 1: organic URL hostname scan — zero extra network calls
  for (const r of organicResults) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      const hostBase = host.split(".")[0];
      if (hostBase === slug || host.startsWith(slug + ".")) return host;
    } catch {
      // skip
    }
  }

  // Pass 2: parallel HEAD probes
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStopWord(name: string): boolean {
  return STOP_WORDS.has(name.toLowerCase());
}

function splitCommaList(text: string): string[] {
  return text
    .split(/,\s*/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length > 1);
}

// ── Strategy ──────────────────────────────────────────────────────────────────

export const snippetMiningStrategy: DiscoveryStrategy = {
  id: "snippet-mining",

  async run(raw: RawSearchData, ctx: StrategyContext): Promise<DiscoveredCompetitor[]> {
    const nameFreq = new Map<string, number>();

    function record(name: string, weight = 1) {
      name = name.trim().replace(/\s+/g, " ").replace(/\.$/, "");
      if (!name || name.length < 2 || name.length > 40) return;
      if (isStopWord(name)) return;
      if (name.toLowerCase().includes(ctx.baseName.toLowerCase())) return;
      nameFreq.set(name, (nameFreq.get(name) ?? 0) + weight);
    }

    // ── Mine organic snippets + titles ──────────────────────────────────────
    for (const result of raw.organicResults) {
      for (const text of [result.snippet, result.title]) {
        if (!text) continue;

        // Connector pattern: "such as X, Y, Z"
        let m: RegExpExecArray | null;
        CONNECTOR_PATTERN.lastIndex = 0;
        while ((m = CONNECTOR_PATTERN.exec(text)) !== null) {
          for (const part of splitCommaList(m[1])) record(part, 2);
        }

        // VS pattern
        VS_PATTERN.lastIndex = 0;
        while ((m = VS_PATTERN.exec(text)) !== null) {
          record(m[1]);
          record(m[2]);
        }

        // Colon list: "alternatives: X, Y, Z"
        COLON_LIST_PATTERN.lastIndex = 0;
        while ((m = COLON_LIST_PATTERN.exec(text)) !== null) {
          for (const part of splitCommaList(m[1])) record(part, 2);
        }

        // Name-dot pattern: "Etsy. A marketplace for handmade goods"
        NAME_DOT_PATTERN.lastIndex = 0;
        while ((m = NAME_DOT_PATTERN.exec(text)) !== null) {
          record(m[1], 2);
        }

        // Context-sentence proper nouns: extract title-case words from sentences
        // that contain context keywords — catches "Amazon and Walmart both offer..."
        CONTEXT_SENTENCE_PATTERN.lastIndex = 0;
        while ((m = CONTEXT_SENTENCE_PATTERN.exec(text)) !== null) {
          const sentence = m[0];
          const nounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
          let nm: RegExpExecArray | null;
          while ((nm = nounPattern.exec(sentence)) !== null) record(nm[1], 1);
        }
      }
    }

    // ── Mine relatedSearches ─────────────────────────────────────────────────
    // relatedSearches like "Whatnot" or "ebay vs mercari" contain product names
    for (const [, extras] of raw.serperExtras) {
      for (const { query } of extras.relatedSearches) {
        // Single or two-word queries that aren't generic are often product names
        const words = query.trim().split(/\s+/);
        if (words.length <= 3) {
          // Remove known filler words and see if what's left looks like a product
          const cleaned = words
            .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
            .filter((w) => !["ebay", ctx.baseName.toLowerCase()].includes(w.toLowerCase()))
            .join(" ");
          if (cleaned.length > 1) record(cleaned, 1);
        }

        VS_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = VS_PATTERN.exec(query)) !== null) {
          record(m[1]);
          record(m[2]);
        }
      }
    }

    // ── Mine peopleAlsoAsk ───────────────────────────────────────────────────
    for (const [, extras] of raw.serperExtras) {
      for (const { snippet } of extras.peopleAlsoAsk) {
        if (!snippet) continue;

        let m: RegExpExecArray | null;

        CONNECTOR_PATTERN.lastIndex = 0;
        while ((m = CONNECTOR_PATTERN.exec(snippet)) !== null) {
          for (const part of splitCommaList(m[1])) record(part, 2);
        }

        // PAA answers often list "Name. Description..." — weight higher
        NAME_DOT_PATTERN.lastIndex = 0;
        while ((m = NAME_DOT_PATTERN.exec(snippet)) !== null) {
          record(m[1], 3);
        }

        VS_PATTERN.lastIndex = 0;
        while ((m = VS_PATTERN.exec(snippet)) !== null) {
          record(m[1]);
          record(m[2]);
        }
      }
    }

    if (!nameFreq.size) return [];

    // Resolve top-20 by frequency in parallel
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
