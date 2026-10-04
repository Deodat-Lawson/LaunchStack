/**
 * The top of the profile — summary, applicant type, focus areas — written
 * from the assembled facts, never from raw text. The model sees numbered
 * facts and must cite the ones each statement rests on; an uncited summary
 * or focus area is dropped. Citations carry the cited facts' own sources,
 * so the summary's superscripts point at the same excerpts.
 */
import { z } from "zod";

import type { GenerateStructuredFn } from "./extractor";
import { SUMMARY_SYSTEM_PROMPT } from "./prompts";
import {
    APPLICANT_TYPE_VALUES,
    type ApplicantType,
    type CompanyMetadataJSON,
    type MetadataFact,
    type MetadataSource,
    type ProfileInfo,
} from "./types";
import { numberedFacts } from "./views";

/** Every fact a summary rests on should be citable from it. */
const MAX_SOURCES = 12;
const MAX_FOCUS_AREAS = 6;

const SummarySchema = z.object({
    summary: z.string(),
    summary_facts: z.array(z.number().int()),
    applicant_type: z.enum([...APPLICANT_TYPE_VALUES, "unknown"]),
    applicant_facts: z.array(z.number().int()),
    focus_areas: z.array(z.object({ value: z.string(), facts: z.array(z.number().int()) })),
});

/** "people.0.role" → "Jane Doe — role" so the model knows whose role it is. */
function promptLabel(metadata: CompanyMetadataJSON, path: string, label: string): string {
    const [section, index, field] = path.split(".");
    if (
        section === "people" ||
        section === "services" ||
        section === "projects" ||
        section === "legal"
    ) {
        const entry = metadata[section]?.[Number(index)];
        const name = entry ? String(entry.name.value) : "";
        const kind = {
            people: "Person",
            services: "Product or service",
            projects: "Project",
            legal: "Agreement",
        }[section];
        return field === "name" ? kind : `${kind} ${name} — ${field}`;
    }
    if (section === "markets") return `Market (${index})`;
    return label;
}

function unionSources(facts: MetadataFact<unknown>[]): MetadataSource[] {
    const seen = new Set<string>();
    const out: MetadataSource[] = [];
    for (const fact of facts)
        for (const source of fact.sources) {
            const key = `${source.doc_id}|${source.page ?? ""}|${source.quote ?? ""}`;
            if (seen.has(key) || out.length >= MAX_SOURCES) continue;
            seen.add(key);
            out.push(source);
        }
    return out;
}

function written(value: string, facts: MetadataFact<unknown>[], now: string): MetadataFact {
    return {
        value,
        visibility: facts.every(f => f.visibility === "public") ? "public" : "private",
        usage: facts.every(f => f.usage === "outreach_ok")
            ? "outreach_ok"
            : "outreach_ok_with_approval",
        confidence: Math.min(...facts.map(f => f.confidence), 1),
        priority: "normal",
        status: "active",
        last_updated: now,
        sources: unionSources(facts),
    };
}

/**
 * The written part of the profile. Returns an empty object when there are
 * no facts to write from — the honest profile of a workspace whose sources
 * say nothing about the organisation.
 */
export async function synthesizeProfile(input: {
    metadata: CompanyMetadataJSON;
    companyName: string;
    generate: GenerateStructuredFn;
    now: Date;
}): Promise<Pick<ProfileInfo, "summary" | "applicant_type" | "focus_areas">> {
    const facts = numberedFacts(input.metadata);
    if (facts.length === 0) return {};
    const byId = new Map(facts.map(f => [f.id, f.fact]));
    const pick = (ids: number[]) =>
        [...new Set(ids)].map(id => byId.get(id)).filter((f): f is MetadataFact<unknown> => !!f);

    const listing = facts
        .map(f => `[F${f.id}] ${promptLabel(input.metadata, f.path, f.label)}: ${f.value}`)
        .join("\n");
    const result = await input.generate({
        system: SUMMARY_SYSTEM_PROMPT,
        prompt: `ORGANISATION: ${input.companyName}\n\nNUMBERED FACTS\n${listing}`,
        schema: SummarySchema,
        schemaName: "company_profile_summary",
    });

    const now = input.now.toISOString();
    const out: Pick<ProfileInfo, "summary" | "applicant_type" | "focus_areas"> = {};
    const summaryFacts = pick(result.summary_facts);
    if (result.summary.trim() && summaryFacts.length > 0)
        out.summary = written(result.summary.trim(), summaryFacts, now);
    const applicantFacts = pick(result.applicant_facts);
    if (result.applicant_type !== "unknown" && applicantFacts.length > 0)
        out.applicant_type = written(
            result.applicant_type,
            applicantFacts,
            now
        ) as MetadataFact<ApplicantType>;
    const focus = result.focus_areas
        .map(area => ({ value: area.value.trim(), facts: pick(area.facts) }))
        .filter(area => area.value && area.facts.length > 0)
        .slice(0, MAX_FOCUS_AREAS)
        .map(area => written(area.value, area.facts, now));
    if (focus.length) out.focus_areas = focus;
    return out;
}
