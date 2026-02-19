import { DiscoveryStrategy, RawSearchData, StrategyContext, DiscoveredCompetitor } from "../types";

/**
 * TODO: Feed search snippets to an LLM (Groq/Gemini free tier recommended)
 * and ask it to return structured competitor domains.
 *
 * To enable:
 *  1. Add LLM_API_KEY to env.ts
 *  2. Implement the run() body
 *  3. Set DISCOVERY_STRATEGIES=snippet-mining,llm-extraction (or llm-extraction alone)
 */
export const llmExtractionStrategy: DiscoveryStrategy = {
  id: "llm-extraction",

  async run(_raw: RawSearchData, _ctx: StrategyContext): Promise<DiscoveredCompetitor[]> {
    console.warn("[discovery] llm-extraction strategy is not yet implemented");
    return [];
  },
};
