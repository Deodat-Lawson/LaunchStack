import { describe, expect, it } from "vitest";

import { DEFAULT_SOURCE_BUDGET, type SourceManifest } from "../../contracts";
import { sha256Hex } from "../../hash";
import { finalizeManifest } from "../sources";
import { E1_TEXT, E2_TEXT, groundingCollection, makeHarness, runUnit, section } from "./harness";

const at = new Date("2026-11-12T09:30:00Z");

describe("sources", () => {
    it("numbers the captured sections, hashes each quote and unions the files", () => {
        const manifest = finalizeManifest(groundingCollection(), DEFAULT_SOURCE_BUDGET, {
            collector: "test@1",
            capturedAt: at,
        });
        expect(manifest.items.map(i => [i.id, i.label, i.quote])).toEqual([
            ["E1", "contacts.pdf, page 2", E1_TEXT],
            ["E2", "renewal.pdf, page 4", E2_TEXT],
        ]);
        expect(manifest.items[0]!.contentHash).toBe(sha256Hex(E1_TEXT));
        expect(manifest.items[1]!.locator).toEqual({
            documentId: 8,
            versionId: 5,
            chunkId: 200,
            page: 4,
            section: "Renewal terms",
            providerId: null,
        });
        expect(manifest.items[1]!.versionId).toBe("5");
        expect(manifest.documentIds).toEqual([7, 8]);
        expect(manifest.usedTokens).toBe(manifest.items.reduce((s, i) => s + i.tokens, 0));
        expect(manifest.omissions).toEqual([]);
    });

    it("hashes what the evidence is, not when it was read", () => {
        const a = finalizeManifest(groundingCollection(), DEFAULT_SOURCE_BUDGET, {
            collector: "test@1",
            capturedAt: at,
        });
        const b = finalizeManifest(groundingCollection(), DEFAULT_SOURCE_BUDGET, {
            collector: "test@1",
            capturedAt: new Date("2027-01-01T00:00:00Z"),
        });
        expect(b.manifestHash).toBe(a.manifestHash);
        const changed = groundingCollection();
        changed.sections[1]!.text = `${E2_TEXT} Updated.`;
        expect(
            finalizeManifest(changed, DEFAULT_SOURCE_BUDGET, { collector: "t", capturedAt: at })
                .manifestHash
        ).not.toBe(a.manifestHash);
    });

    it("holds every source to the budget and records each cut", () => {
        const long = (n: number) => `Passage ${n}. ${"word ".repeat(150)}`; // ~190 tokens each
        const collection = {
            sections: [
                ...Array.from({ length: 6 }, (_, i) =>
                    section({ text: long(i), score: 1 - i / 10, label: `big.pdf, page ${i + 1}` })
                ),
                section({
                    text: "Notes from a call.",
                    kind: "notes",
                    sourceType: "notes",
                    sourceId: "1",
                    versionId: null,
                    label: "Pasted material",
                    locator: {
                        documentId: null,
                        versionId: null,
                        chunkId: null,
                        page: null,
                        section: null,
                        providerId: null,
                    },
                    documentIds: [],
                    href: null,
                    validity: "unknown",
                    score: 0.1,
                }),
            ],
            omissions: [
                {
                    sourceType: "document" as const,
                    sourceId: "9",
                    label: "A file",
                    reason: "no_access" as const,
                    tokens: null,
                },
            ],
        };
        const manifest = finalizeManifest(
            collection,
            { perDocumentTokens: 400, totalTokens: 10_000, maxSections: 10 },
            { collector: "t", capturedAt: at }
        );
        // Two big passages fit the per-document budget; the note still gets in.
        expect(manifest.items.map(i => i.label)).toEqual([
            "big.pdf, page 1",
            "Pasted material",
            "big.pdf, page 2",
        ]);
        expect(manifest.omissions[0]!.reason).toBe("no_access");
        expect(manifest.omissions.slice(1).map(o => [o.label, o.reason])).toEqual(
            [3, 4, 5, 6].map(p => [`big.pdf, page ${p}`, "budget"])
        );
        expect(manifest.omissions.slice(1).every(o => (o.tokens ?? 0) > 0)).toBe(true);

        const capped = finalizeManifest(
            collection,
            { perDocumentTokens: 10_000, totalTokens: 10_000, maxSections: 2 },
            { collector: "t", capturedAt: at }
        );
        expect(capped.items).toHaveLength(2);
        expect(capped.omissions.filter(o => o.reason === "budget")).toHaveLength(5);

        const total = finalizeManifest(
            collection,
            { perDocumentTokens: 10_000, totalTokens: 450, maxSections: 100 },
            { collector: "t", capturedAt: at }
        );
        expect(total.usedTokens).toBeLessThanOrEqual(450);
    });

    it("drops empty text and exact repeats from the same source", () => {
        const c = groundingCollection();
        c.sections.push(section({ text: E1_TEXT }), section({ text: "   " }));
        const manifest = finalizeManifest(c, DEFAULT_SOURCE_BUDGET, {
            collector: "t",
            capturedAt: at,
        });
        expect(manifest.items).toHaveLength(2);
    });

    it("writes the manifest and v1 evidence, and calls no model", async () => {
        const h = makeHarness();
        const result = await runUnit(h, "sources");
        expect(h.model.requests).toHaveLength(0);
        expect(result.writes?.[0]?.type).toBe("source_manifest");
        expect(h.artifacts.manifest?.collector).toBe(h.spec.policies.versions.sourceCollector);
        expect(h.run.evidence).toEqual([
            {
                id: "E1",
                kind: "document",
                label: "contacts.pdf, page 2",
                text: E1_TEXT,
                ref: { type: "document", id: "7" },
                href: "/employer/documents?docId=7",
                documentIds: [7],
            },
            expect.objectContaining({ id: "E2", documentIds: [8] }),
        ]);
        expect(h.run.flags).toMatchObject({ omittedSources: 0 });
    });
});

describe("brief", () => {
    it("asks the v1 brief over the manifest and keeps only real citations", async () => {
        const h = makeHarness();
        await runUnit(h, "sources");
        await runUnit(h, "brief");
        const [request] = h.model.requests;
        expect(request!.purpose).toBe("brief");
        expect(request!.prompt).toContain("[E1] (document) contacts.pdf, page 2");
        expect(h.run.brief?.brief).toContain("[E2]");
    });

    it("clips the evidence to fit the brief's input cap, best first", async () => {
        const h = makeHarness();
        const items = Array.from({ length: 120 }, (_, i) => ({
            id: `E${i + 1}`,
            kind: "document" as const,
            sourceType: "document" as const,
            sourceId: "7",
            versionId: "3",
            label: `plan.pdf, page ${i + 1}`,
            locator: {
                documentId: 7,
                versionId: 3,
                chunkId: i,
                page: i + 1,
                section: null,
                providerId: null,
            },
            quote: `Section ${i + 1}. ${"detail ".repeat(200)}`,
            fact: null,
            contentHash: "x",
            capturedAt: at.toISOString(),
            validity: "versioned" as const,
            documentIds: [7],
            href: null,
            tokens: 400,
        }));
        h.artifacts.manifest = {
            version: 1,
            collector: "t",
            items,
            omissions: [],
            budget: DEFAULT_SOURCE_BUDGET,
            usedTokens: 48_000,
            documentIds: [7],
            manifestHash: "h",
        } satisfies SourceManifest;
        h.committed.add("sources");
        await runUnit(h, "brief");
        const prompt = h.model.requests[0]!.prompt;
        const offered = [...prompt.matchAll(/^\[(E\d+)\]/gm)].map(m => m[1]);
        expect(offered.length).toBeGreaterThan(10);
        expect(offered.length).toBeLessThan(120);
        expect(offered).toEqual(offered.map((_, i) => `E${i + 1}`));
        expect(Math.ceil((prompt.length + h.model.requests[0]!.system.length) / 4)).toBeLessThan(
            12_000
        );
    });
});
