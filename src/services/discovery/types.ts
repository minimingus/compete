export interface DiscoveryInput {
  projectId: string;
  companyDomain: string;
  keywords?: string[];
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SerperExtras {
  relatedSearches: Array<{ query: string }>;
  peopleAlsoAsk: Array<{ question: string; snippet: string | null }>;
}

export interface RawSearchData {
  readonly organicResults: ReadonlyArray<SearchResult>;
  readonly serperExtras: ReadonlyMap<string, SerperExtras>;
}

export interface DiscoveredCompetitor {
  name: string;
  domain: string;
  confidence: number;
  sources: Array<{ title: string; url: string }>;
}

export interface StrategyContext {
  normalizedDomain: string;
  baseName: string;
  blocklist: ReadonlySet<string>;
}

export interface DiscoveryStrategy {
  readonly id: string;
  run(raw: RawSearchData, ctx: StrategyContext): Promise<DiscoveredCompetitor[]>;
}
