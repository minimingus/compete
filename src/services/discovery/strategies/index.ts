import { DiscoveryStrategy } from "../types";
import { urlDomainStrategy } from "./url-domain";
import { snippetMiningStrategy } from "./snippet-mining";
import { llmExtractionStrategy } from "./llm-extraction";

const ALL_STRATEGIES: ReadonlyMap<string, DiscoveryStrategy> = new Map([
  [urlDomainStrategy.id, urlDomainStrategy],
  [snippetMiningStrategy.id, snippetMiningStrategy],
  [llmExtractionStrategy.id, llmExtractionStrategy],
]);

export function resolveStrategies(csvIds: string): DiscoveryStrategy[] {
  return csvIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((id) => {
      const strategy = ALL_STRATEGIES.get(id);
      if (!strategy) {
        console.warn(`[discovery] Unknown strategy id "${id}" — skipping`);
        return [];
      }
      return [strategy];
    });
}
