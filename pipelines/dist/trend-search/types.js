import { z } from "zod";
// ─── Category (moved to @launchstack/tools/web-research, PR-3; re-exported) ──
export { SearchCategoryEnum } from "@launchstack/tools/web-research";
import { SearchCategoryEnum } from "@launchstack/tools/web-research";
// ─── Input ───────────────────────────────────────────────────────────────────
export const TrendSearchInputSchema = z.object({
    query: z.string().min(1).max(1000),
    companyContext: z.string().min(1).max(2000),
    categories: z.array(SearchCategoryEnum).optional(),
});
// ─── Inngest event payload ────────────────────────────────────────────────────
export const TrendSearchEventDataSchema = z.object({
    jobId: z.string(),
    companyId: z.string(), // serialized as string for Inngest
    userId: z.string(),
    query: z.string(),
    companyContext: z.string(),
    categories: z.array(SearchCategoryEnum).optional(),
});
// PlannedQuery and RawSearchResult moved to @launchstack/tools/web-research
// (re-exported above).
//# sourceMappingURL=types.js.map