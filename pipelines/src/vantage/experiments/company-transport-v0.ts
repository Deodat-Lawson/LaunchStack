/** Lossless model-transport encoding only; the authorized registry stays untouched. */
import { z } from "zod";

const provenance = z
    .object({
        documentId: z.string(),
        versionId: z.string().nullable(),
        quote: z.string().nullable(),
        snippetRef: z.string().nullable(),
        page: z.number().nullable(),
        extractedAt: z.string(),
    })
    .strict();
const fact = z
    .object({
        path: z.string(),
        label: z.string(),
        value: z.string(),
        subject: z.string().optional(),
        basis: z.enum([
            "human-entered-unreviewed",
            "source-extracted-unreviewed",
            "model-synthesis-unreviewed",
        ]),
        sources: z.array(provenance),
    })
    .strict();
const payload = z
    .object({
        adapterVersion: z.literal("company-profile-adapter/v0.1"),
        companyId: z.string(),
        reviewState: z.literal("unreviewed"),
        facts: z.array(fact),
        unknowns: z.array(z.object({ code: z.string(), count: z.number().optional() }).strict()),
    })
    .strict();

/** Unknown formats stay verbatim: never silently discard fields or source information. */
export function compactCompanyTransportV0(excerpt: string): string {
    let value: z.infer<typeof payload>;
    try {
        value = payload.parse(JSON.parse(excerpt));
    } catch {
        return excerpt;
    }
    const sourceProvenance: z.infer<typeof provenance>[] = [];
    const indexes = new Map<string, number>();
    const facts = value.facts.map(({ sources, ...fields }) => ({
        ...fields,
        sourceIndexes: sources.map(source => {
            const key = JSON.stringify(source);
            let index = indexes.get(key);
            if (index === undefined) {
                index = sourceProvenance.length;
                sourceProvenance.push(source);
                indexes.set(key, index);
            }
            return index;
        }),
    }));
    const factDefaults: { basis?: string; sourceIndexes?: number[] } = {};
    const commonBasis = facts[0]?.basis;
    if (commonBasis && facts.length > 1 && facts.every(fact => fact.basis === commonBasis))
        factDefaults.basis = commonBasis;
    const counts = new Map<string, number>();
    for (const fact of facts) {
        const key = JSON.stringify(fact.sourceIndexes);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const commonSources = [...counts].sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))[0];
    if (commonSources && commonSources[1] > 2)
        factDefaults.sourceIndexes = JSON.parse(commonSources[0]) as number[];
    const compact = JSON.stringify({
        ...value,
        format: "company-provenance-interned/v1",
        factDefaults,
        facts: facts.map(fact => {
            const { basis, sourceIndexes, ...fields } = fact;
            return {
                ...fields,
                ...(basis === factDefaults.basis ? {} : { basis }),
                ...(JSON.stringify(sourceIndexes) === JSON.stringify(factDefaults.sourceIndexes)
                    ? {}
                    : { sourceIndexes }),
            };
        }),
        sourceProvenance,
    });
    // Tiny profiles need no encoding overhead. Selection never removes a fact.
    return Buffer.byteLength(compact) < Buffer.byteLength(excerpt) ? compact : excerpt;
}
