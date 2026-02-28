import type { SearchProviderFn } from "./types";
import { callTavily } from "./tavily";
import { callSerper } from "./serper"; // placeholder; full impl in task 2.1

export const providerRegistry: Record<string, SearchProviderFn> = {
    tavily: callTavily,
    serper: callSerper,
};
