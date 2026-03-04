import type { SearchProviderFn } from "./types";
import { callTavily } from "./tavily";
import { callSerper } from "./serper";

export const providerRegistry: Record<string, SearchProviderFn> = {
  tavily: callTavily,
  serper: callSerper,
};

