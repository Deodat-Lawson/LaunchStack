import { describe, expect, it } from "vitest";
import { compactCompanyTransportV0 } from "./company-transport-v0";

const source = {
    documentId: "2151",
    versionId: "2183",
    quote: null as string | null,
    snippetRef: null,
    page: null,
    extractedAt: "2026-10-26T18:50:00.000Z",
};
const sample = () => ({
    adapterVersion: "company-profile-adapter/v0.1",
    companyId: "2037",
    reviewState: "unreviewed",
    facts: Array.from({ length: 12 }, (_, i) => ({
        path: `profile.facts.fact_${i}`,
        label: `Fact ${i}`,
        value: `Exact source value ${i}: Engineering supplies execution traces; Privacy records a decision.`,
        basis: "source-extracted-unreviewed",
        sources: [{ ...source }],
    })),
    unknowns: [{ code: "hierarchy_unknown" }, { code: "candidate_facts_withheld", count: 2 }],
});
function decode(text: string) {
    const value = JSON.parse(text);
    if (value.format !== "company-provenance-interned/v1") return value;
    const { format, sourceProvenance, factDefaults, ...body } = value;
    expect(format).toBe("company-provenance-interned/v1");
    return {
        ...body,
        facts: body.facts.map((fact: Record<string, unknown>) => {
            const { sourceIndexes, ...fields } = { ...factDefaults, ...fact };
            return {
                ...fields,
                sources: sourceIndexes.map((index: number) => sourceProvenance[index]),
            };
        }),
    };
}
describe("lossless experimental company transport", () => {
    it("preserves every fact, unknown, review state and exact provenance while reducing bytes", () => {
        const original = sample(),
            text = JSON.stringify(original),
            encoded = compactCompanyTransportV0(text);
        expect(decode(encoded)).toEqual(original);
        expect(Buffer.byteLength(encoded)).toBeLessThan(Buffer.byteLength(text));
        expect(JSON.parse(encoded).sourceProvenance).toEqual([source]);
        expect(original.facts.every(fact => fact.sources.length === 1)).toBe(true);
    });
    it("retains distinct quote, version and date identities rather than treating them as the same source", () => {
        const original = sample();
        original.facts[1]!.sources = [{ ...source, versionId: "2184" }];
        original.facts[2]!.sources = [
            { ...source, quote: "literal quoted older request" } as typeof source,
        ];
        original.facts[3]!.sources = [{ ...source, extractedAt: "2026-10-26T19:00:00.000Z" }];
        const encoded = compactCompanyTransportV0(JSON.stringify(original));
        expect(decode(encoded)).toEqual(original);
        expect(JSON.parse(encoded).sourceProvenance).toHaveLength(4);
    });
    it("retains subject attribution, unicode and multi-document provenance without mutation", () => {
        const original = sample() as ReturnType<typeof sample> & {
            facts: Array<ReturnType<typeof sample>["facts"][number] & { subject?: string }>;
        };
        original.facts[0]!.subject = "Privacy · 隐私";
        original.facts[0]!.sources.push({ ...source, documentId: "2152", versionId: "2185" });
        const before = JSON.stringify(original);
        expect(decode(compactCompanyTransportV0(before))).toEqual(original);
        expect(JSON.stringify(original)).toBe(before);
    });
    it.each([
        "not json",
        JSON.stringify({ ...sample(), newField: "do not drop" }),
        JSON.stringify({ ...sample(), reviewState: "reviewed" }),
    ])("keeps unrecognized data exactly verbatim", text => {
        expect(compactCompanyTransportV0(text)).toBe(text);
    });
    it("does not add format overhead to a tiny profile", () => {
        const original = sample();
        original.facts = [];
        const text = JSON.stringify(original);
        expect(compactCompanyTransportV0(text)).toBe(text);
    });
});
