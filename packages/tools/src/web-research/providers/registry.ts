import type { SearchProvider, SearchProviderId } from "../types";
import { brave } from "./brave";
import { exa } from "./exa";
import { searxng } from "./searxng";
import { serper } from "./serper";
import { tavily } from "./tavily";

/**
 * Every provider, in the order SEARCH_PROVIDER's automatic choice tries them:
 * Exa first (the default since it is the only one with a company index), then
 * the hosted APIs, then a self-hosted SearXNG.
 */
export const SEARCH_PROVIDERS: Readonly<Record<SearchProviderId, SearchProvider>> = {
    exa,
    serper,
    brave,
    tavily,
    searxng,
};
