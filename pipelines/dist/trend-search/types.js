import { z } from "zod";
// ─── Category ────────────────────────────────────────────────────────────────
export const SearchCategoryEnum = z.enum(["fashion", "finance", "business", "tech"]);
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
//# sourceMappingURL=types.js.map
