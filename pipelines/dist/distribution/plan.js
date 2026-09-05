/**
 * Stage 2 — plan. One structured LLM call with the planning playbook turns
 * the seller profile + program into a discovery plan: adjacent brands to map
 * and the queries to run per source. The plan is data; a run can be
 * re-executed from it.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
import { loadPlaybook } from "./skills.js";
import { DiscoveryPlanSchema } from "./types.js";
export const PLAN_PROMPT_VERSION = "distribution-plan/2026-09-03.1";
function territoryLabel(t) {
    return t.region ? `${t.region}, ${t.country}` : t.country;
}
export function buildPlanPrompt(input) {
    const { program, profile, territories, partnerKinds, sources } = input;
    const available = [
        sources.web ? "web search (kind: web)" : null,
        sources.place
            ? "place search for physical accounts in a named city/region (kind: place)"
            : null,
        sources.trade ? "customs trade records by HS code or keyword (kind: trade)" : null,
    ]
        .filter(Boolean)
        .join("; ");
    return [
        `SELLER: ${profile.companyName} (${profile.industry})`,
        profile.identity,
        "",
        "SELLER KNOWLEDGE (from their own documents):",
        profile.knowledgeContext || "(none)",
        "",
        `PROGRAM: ${program.name}`,
        `Offering: ${program.offering}`,
        `Categories: ${program.categories.join(", ") || "(none given)"}`,
        `HS codes: ${program.hsCodes.join(", ") || "(none given)"}`,
        `Territories: ${territories.map(territoryLabel).join("; ")}`,
        `Partner kinds wanted: ${partnerKinds.join(", ")}`,
        `Constraints: ${program.constraints ?? "(none given)"}`,
        "",
        `SOURCES AVAILABLE IN THIS RUN: ${available || "none"}`,
        "",
        "Produce the discovery plan. Every query's `territory` must be one of the territories above and its `partnerKind` one of the kinds wanted. Only use query kinds from the available sources.",
    ].join("\n");
}
export async function planDiscovery(input) {
    const playbook = loadPlaybook("plan");
    const resolved = resolveChatModel({ route: "fast", temperature: 0.2 });
    const raw = await invokeStructured(resolved, DiscoveryPlanSchema, [new SystemMessage(playbook.content), new HumanMessage(buildPlanPrompt(input))], { name: "discovery_plan" });
    return {
        plan: sanitizePlan(raw, input),
        modelId: resolved.modelId,
        playbookHash: playbook.hash,
    };
}
/**
 * Deterministic clean-up of a model-produced plan: drop queries for sources
 * that are not available, for territories or kinds outside the run, and
 * queries that name the seller (they find the seller, not its channels).
 */
export function sanitizePlan(plan, input) {
    const territoryKeys = new Set(input.territories.map(t => `${t.country}|${t.region ?? ""}`));
    const countries = new Set(input.territories.map(t => t.country));
    const kinds = new Set(input.partnerKinds);
    const sellerName = input.profile.companyName.trim().toLowerCase();
    // Snap a country-only territory onto the program's matching territory so
    // place queries inherit region and radius before the region check below.
    const byCountry = new Map(input.territories.map(t => [t.country, t]));
    const snapped = plan.queries.map(query => {
        if (query.territory.region)
            return query;
        const match = byCountry.get(query.territory.country);
        return match ? { ...query, territory: match } : query;
    });
    const queries = snapped.filter(query => {
        if (query.kind === "web" && !input.sources.web)
            return false;
        if (query.kind === "place" && !input.sources.place)
            return false;
        if (query.kind === "trade" && !input.sources.trade)
            return false;
        if (!kinds.has(query.partnerKind))
            return false;
        const key = `${query.territory.country}|${query.territory.region ?? ""}`;
        if (!territoryKeys.has(key) && !countries.has(query.territory.country))
            return false;
        if (query.kind === "place" && !query.territory.region)
            return false;
        if (sellerName.length >= 4 && query.query.toLowerCase().includes(sellerName))
            return false;
        return true;
    });
    return { ...plan, queries };
}
//# sourceMappingURL=plan.js.map