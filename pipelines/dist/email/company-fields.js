import { eq } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { companyMetadata } from "../schema.js";
/**
 * Owner-company data → template merge variables (member.md Phase 2).
 *
 * This is the deterministic half of grounding: the LLM in `generator.ts` writes
 * the prose, but the concrete values a template interpolates come from here, so
 * they are auditable and cannot be hallucinated.
 *
 * Anything absent is reported in `missing` rather than defaulted to filler —
 * a template referencing a field with no data must fail the unresolved-token
 * guard, not quietly send "our proven results" with nothing behind it.
 */
/** Merge variables this module can supply. */
export const COMPANY_FIELDS = [
    "ownerCompany",
    "valueProp",
    "ownerIndustry",
    "differentiators",
    "proofPoint",
    "ctaLink",
];
/**
 * Mirrors `readFact` in marketing-pipeline/context.ts. Duplicated deliberately:
 * that copy is module-private, and silently diverging thresholds between the two
 * pipelines would be worse than a six-line repeat. Keep these in sync.
 */
const MIN_CONFIDENCE = 0.5;
function readFact(fact) {
    if (!fact)
        return undefined;
    if (fact.status !== "active")
        return undefined;
    if (fact.confidence < MIN_CONFIDENCE)
        return undefined;
    return fact.value;
}
function clean(value) {
    if (typeof value !== "string")
        return null;
    const v = value.trim().replace(/\s+/g, " ");
    return v.length > 0 ? v : null;
}
/** Join a few items into one interpolatable phrase: "a, b and c". */
function joinPhrase(items, max = 3) {
    const kept = items
        .map(clean)
        .filter((v) => Boolean(v))
        .slice(0, max);
    if (kept.length === 0)
        return null;
    if (kept.length === 1)
        return kept[0];
    return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}
/**
 * Build the owner company's merge fields.
 *
 * Reads the `company` row first (always present) then layers
 * `company_metadata` over it when a confident fact exists.
 */
export async function buildCompanyMergeFields(companyId) {
    const db = getDb();
    const fields = {};
    const provenance = {};
    const set = (key, value, source) => {
        if (!value || fields[key])
            return;
        fields[key] = value;
        provenance[key] = source;
    };
    const [row] = await db
        .select({
        name: company.name,
        description: company.description,
        industry: company.industry,
    })
        .from(company)
        .where(eq(company.id, companyId))
        .limit(1);
    set("ownerCompany", clean(row?.name), "company");
    set("valueProp", clean(row?.description), "company");
    set("ownerIndustry", clean(row?.industry), "company");
    const [metaRow] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, BigInt(companyId)))
        .limit(1);
    const md = metaRow?.metadata;
    if (md) {
        set("ownerCompany", clean(readFact(md.company?.name)), "company_metadata");
        set("valueProp", clean(readFact(md.company?.description)), "company_metadata");
        set("ownerIndustry", clean(readFact(md.company?.industry)), "company_metadata");
        set("ctaLink", clean(readFact(md.company?.website)), "company_metadata");
        // Services are the closest grounded stand-in for "what we do differently".
        const services = (md.services ?? [])
            .map(s => clean(readFact(s?.name)))
            .filter((v) => Boolean(v));
        set("differentiators", joinPhrase(services), "company_metadata");
        // A delivered project is the most defensible proof point available.
        const projects = (md.projects ?? [])
            .map(p => {
            const name = clean(readFact(p?.name));
            const detail = clean(readFact(p?.description));
            if (!name)
                return null;
            return detail ? `${name} — ${detail}` : name;
        })
            .filter((v) => Boolean(v));
        set("proofPoint", projects[0] ?? null, "company_metadata");
        // Certifications are a fallback proof point when there are no projects.
        if (!fields.proofPoint) {
            const policies = Object.entries(md.policies ?? {})
                .map(([key, fact]) => {
                const value = clean(readFact(fact));
                return value ? `${key}: ${value}` : null;
            })
                .filter((v) => Boolean(v));
            set("proofPoint", policies[0] ?? null, "company_metadata");
        }
    }
    const missing = COMPANY_FIELDS.filter(f => !fields[f]);
    return { fields, missing, provenance };
}
/**
 * Which company fields a template actually needs.
 * Lets the UI warn "this template uses {{proofPoint}} but you have none" before
 * a single email is rendered.
 */
export function requiredCompanyFields(tokens) {
    const wanted = new Set(tokens);
    return COMPANY_FIELDS.filter(f => wanted.has(f));
}
//# sourceMappingURL=company-fields.js.map