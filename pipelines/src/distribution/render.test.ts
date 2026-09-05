import { describe, expect, it } from "vitest";

import { makeDossierCreationKey, makeDossierFilename, renderDossierMarkdown } from "./render";
import type { EvidenceRecord, PartnerOrgRecord, ProgramRecord } from "./types";

const program = {
    id: "prog",
    name: "EU coffee",
    categories: [],
    hsCodes: [],
    targetTerritories: [{ country: "DE" }],
    partnerKinds: ["importer"],
} as unknown as ProgramRecord;
const org = {
    id: "org",
    name: "Acme Import GmbH",
    domain: "acme-import.de",
    resolveKey: "d:acme-import.de",
} as unknown as PartnerOrgRecord;
const evidence: EvidenceRecord[] = [
    {
        id: 7,
        companyId: 1n,
        orgId: "org",
        runId: "run",
        kind: "brands_carried",
        claim: "Carries Beta Roasters",
        sourceUrl: "https://acme-import.de/brands",
        quote: "Our brands: Beta Roasters",
        confidence: 0.9,
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        provenance: null,
    },
];

describe("dossier rendering", () => {
    it("creation key converges per program, org and run; filename is safe", () => {
        expect(makeDossierCreationKey("prog", "org", "run")).toBe("distribution:prog:org:run");
        expect(makeDossierFilename(org)).toBe("Acme-Import-GmbH-dossier.md");
        expect(makeDossierFilename({ ...org, name: "Ünïcode / Weird*Name" })).toBe(
            "ncode-WeirdName-dossier.md"
        );
    });

    it("renders every cited fact with its evidence tag and the evidence list with sources", () => {
        const md = renderDossierMarkdown({
            program,
            org,
            kind: "importer",
            territory: { country: "DE" },
            dossier: {
                summary:
                    "Acme imports specialty coffee and distributes to independent cafés across Germany, carrying adjacent roasters.",
                roles: ["importer"],
                brandsCarried: [{ brand: "Beta Roasters", evidenceIds: [7] }],
                territories: [],
                retailCoverage: [],
                certifications: [],
                decisionMakers: [],
                contactChannels: [],
                risks: [],
                sizeBand: "small",
                openQuestions: ["Exclusivity terms unknown"],
            },
            evidence,
            fit: {
                score: 72,
                rationale: "Strong category overlap.",
                breakdown: {
                    categoryOverlap: 20,
                    territoryMatch: 20,
                    roleMatch: 20,
                    evidenceDepth: 5,
                    freshness: 5,
                    sizeFit: 2,
                    knownSignal: 0,
                    total: 72,
                },
            },
            riskFlags: ["thin evidence"],
            screening: { status: "not_run" },
            generatedAt: new Date("2026-09-03T00:00:00Z"),
            provenance: {
                runId: "run",
                playbookHash: "abcdef1234567890",
                promptVersion: "distribution-dossier-agent/v1",
                modelId: "test-model",
            },
        });
        expect(md).toContain("# Acme Import GmbH — importer dossier");
        expect(md).toContain("- Beta Roasters [E7]");
        expect(md).toContain("**[E7]** _brands_carried_ — Carries Beta Roasters");
        expect(md).toContain("Source: https://acme-import.de/brands");
        expect(md).toContain("Exclusivity terms unknown");
        expect(md).toContain("_Not run (no screening provider configured)._");
        expect(md).toContain("> Playbook: abcdef123456");
    });

    it("renders honestly when no dossier could be produced", () => {
        const md = renderDossierMarkdown({
            program,
            org,
            kind: "importer",
            territory: null,
            dossier: null,
            evidence: [],
            fit: {
                score: 0,
                rationale: "n/a",
                breakdown: {
                    categoryOverlap: 0,
                    territoryMatch: 0,
                    roleMatch: 0,
                    evidenceDepth: 0,
                    freshness: 0,
                    sizeFit: 0,
                    knownSignal: 0,
                    total: 0,
                },
            },
            riskFlags: [],
            screening: null,
            generatedAt: new Date(),
            provenance: { runId: "r", playbookHash: "h", promptVersion: "v" },
        });
        expect(md).toContain("No dossier could be produced within budget");
        expect(md).toContain("_None recorded._");
    });
});
