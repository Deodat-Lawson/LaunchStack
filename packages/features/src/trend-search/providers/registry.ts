import type { SearchProviderFn } from "./types";
import { callExa } from "./exa";
import { callSerper } from "./serper";
export const providerRegistry: Record<string, SearchProviderFn> = {
  exa: callExa,
  serper: callSerper,
};
