import { describe, expect, it } from "vitest";

import { BASE_ONTOLOGY, ONTOLOGY_LIMITS, type OntologySpec } from "../../contracts";
import { hashOf } from "../../hash";
import { UNIT_TOKEN_CAPS } from "../../plan";
import { validateOntology } from "../ontology";
import { buildOntologyRequest } from "../prompts";
import {
    groundingCollection,
    makeHarness,
    runScript,
    runUnit,
    scriptedModel,
    section,
} from "./harness";

const ids = new Set(["E1", "E2"]);

function extension(overrides: Record<string, unknown> = {}) {
    return {
        entities: [
            {
                name: "MigrationProject",
                description: "A planned move from one product to another.",
                attributes: [{ name: "duration", type: "string", description: "As stated." }],
                motivatingEvidenceId: "E2",
            },
        ],
        edges: [
            {
                name: "MIGRATES_FROM",
                description: "An organization plans to move off a product.",
                attributes: [],
                endpoints: [{ source: "Organization", target: "Product" }],
                motivatingEvidenceId: "E2",
            },
        ],
        ...overrides,
    };
}

describe("validateOntology", () => {
    it("adds valid extensions after the base schema", () => {
        const { schema, errors } = validateOntology(extension(), ids);
        expect(errors).toEqual([]);
        expect(schema.entities.slice(0, BASE_ONTOLOGY.entities.length)).toEqual(
            BASE_ONTOLOGY.entities
        );
        expect(schema.entities.at(-1)).toMatchObject({
            name: "MigrationProject",
            origin: "extension",
            motivatingEvidenceId: "E2",
        });
        expect(schema.edges.at(-1)).toMatchObject({ name: "MIGRATES_FROM", origin: "extension" });
    });

    it("rejects an edge whose endpoints are not defined entity types", () => {
        const { errors } = validateOntology(
            extension({
                edges: [
                    {
                        name: "MIGRATES_TO",
                        description: "Moves to a product.",
                        attributes: [],
                        endpoints: [
                            { source: "Organization", target: "CloudPlan" },
                            { source: "organization", target: "Product" },
                        ],
                        motivatingEvidenceId: "E2",
                    },
                ],
            }),
            ids
        );
        expect(errors).toEqual([
            'Edge type "MIGRATES_TO" has the endpoint "CloudPlan", which is not a defined entity type.',
            'Edge type "MIGRATES_TO" has the endpoint "organization", which is not a defined entity type.',
        ]);
    });

    it("rejects reserved, repeated and badly written names and unknown attribute types", () => {
        const { errors } = validateOntology(
            {
                entities: [
                    {
                        name: "Entity",
                        description: "x",
                        attributes: [],
                        motivatingEvidenceId: "E1",
                    },
                    {
                        name: "Person",
                        description: "x",
                        attributes: [],
                        motivatingEvidenceId: "E1",
                    },
                    {
                        name: "migration_project",
                        description: "x",
                        attributes: [
                            { name: "uuid", type: "string", description: "x" },
                            { name: "Days", type: "integer", description: "x" },
                            { name: "days", type: "number", description: "x" },
                        ],
                        motivatingEvidenceId: "E1",
                    },
                ],
                edges: [
                    {
                        name: "migratesFrom",
                        description: "x",
                        attributes: [],
                        endpoints: [{ source: "Person", target: "Product" }],
                        motivatingEvidenceId: "E1",
                    },
                    {
                        name: "USES",
                        description: "x",
                        attributes: [],
                        endpoints: [{ source: "Person", target: "Product" }],
                        motivatingEvidenceId: "E1",
                    },
                ],
            },
            ids
        );
        expect(errors).toEqual(
            expect.arrayContaining([
                'Entity type "Entity" uses a reserved name; pick another.',
                'Entity type "Person" repeats the base type "Person".',
                'Entity type "migration_project" must be written like "Contract".',
                'Attribute "uuid" of Entity type "migration_project" uses a reserved name; pick another.',
                'Attribute "Days" of Entity type "migration_project" must be written like "renewal_date".',
                'Attribute "Days" of Entity type "migration_project" has type "integer"; use "string", "number" or "boolean".',
                'Entity type "migration_project" lists the attribute "days" twice.',
                'Edge type "migratesFrom" must be written like "MIGRATES_FROM".',
                'Edge type "USES" repeats the type "USES".',
            ])
        );
    });

    it("needs a motivating passage that is in the manifest", () => {
        const missing = extension();
        (missing.entities[0] as Record<string, unknown>).motivatingEvidenceId = "E9";
        (missing.edges[0] as Record<string, unknown>).motivatingEvidenceId = "";
        expect(validateOntology(missing, ids).errors).toEqual([
            'Entity type "MigrationProject" names evidence "E9", which is not in the evidence list.',
            'Edge type "MIGRATES_FROM" names no motivating evidence id.',
        ]);
    });

    it("enforces the size limits", () => {
        const many = Array.from({ length: ONTOLOGY_LIMITS.entityTypes }, (_, i) => ({
            name: `Thing${i}`,
            description: "x",
            attributes: Array.from({ length: i === 0 ? 7 : 0 }, (_, k) => ({
                name: `field_${k}`,
                type: "string",
                description: "x",
            })),
            motivatingEvidenceId: "E1",
        }));
        const { errors } = validateOntology({ entities: many, edges: [] }, ids);
        expect(errors).toEqual([
            'Entity type "Thing0" has 7 attributes; at most 6 are allowed.',
            `There are ${ONTOLOGY_LIMITS.entityTypes + BASE_ONTOLOGY.entities.length} entity types in all; at most ${ONTOLOGY_LIMITS.entityTypes} are allowed.`,
        ]);
        expect(
            validateOntology(
                extension({
                    entities: [{ ...extension().entities[0], description: "y".repeat(301) }],
                }),
                ids
            ).errors
        ).toEqual([`Entity type "MigrationProject"'s description is longer than 300 characters.`]);
    });

    it("treats a reply that is not an object as invalid", () => {
        expect(validateOntology(undefined, ids).errors).toEqual([
            "The reply was not a JSON object.",
        ]);
    });
});

describe("the ontology stage", () => {
    it("shows the planner passages from every selected document and the typed-fact keys", () => {
        const c = groundingCollection();
        const items = c.sections.map((s, i) => ({
            id: `E${i + 1}`,
            kind: s.kind,
            sourceType: s.sourceType,
            sourceId: s.sourceId,
            versionId: s.versionId,
            label: s.label,
            locator: s.locator,
            quote: s.text,
            fact: s.fact,
            contentHash: "",
            capturedAt: "",
            validity: s.validity,
            documentIds: s.documentIds,
            href: s.href,
            tokens: 20,
        }));
        items.push({
            ...items[0]!,
            id: "E3",
            sourceType: "company_fact",
            kind: "company_profile",
            fact: { key: "people[0]", label: "Maya", value: "role: ops", sourceDocumentIds: [7] },
        });
        const request = buildOntologyRequest({ subject: "Renewal", items });
        expect(request.purpose).toBe("ontology");
        expect(request.prompt).toContain(
            "From contacts.pdf, page 2 (file 7):\n[E1] Maya recommends"
        );
        expect(request.prompt).toContain("From renewal.pdf, page 4 (file 8):\n[E2] Northwind uses");
        expect(request.prompt).toContain("- [E3] people[0]: Maya");
        expect(request.system).toContain("keeps the hedge");
    });

    it("reads every document and still fits the unit's input cap on a full manifest", () => {
        const items = Array.from({ length: 120 }, (_, i) => ({
            id: `E${i + 1}`,
            kind: "document" as const,
            sourceType: "document" as const,
            sourceId: String(100 + (i % 20)),
            versionId: "1",
            label: `file-${i % 20}.pdf, page ${i + 1}`,
            locator: {
                documentId: 100 + (i % 20),
                versionId: 1,
                chunkId: i,
                page: i + 1,
                section: null,
                providerId: null,
            },
            quote: `Passage ${i + 1}. ${"contract renewal migration terms ".repeat(40)}`,
            fact: null,
            contentHash: "",
            capturedAt: "",
            validity: "versioned" as const,
            documentIds: [100 + (i % 20)],
            href: null,
            tokens: 330,
        }));
        const request = buildOntologyRequest({ subject: "x".repeat(4_000), items });
        for (let d = 0; d < 20; d++) expect(request.prompt).toContain(`(file ${100 + d})`);
        const tokens = Math.ceil((request.system.length + request.prompt.length) / 4);
        expect(tokens).toBeLessThanOrEqual(UNIT_TOKEN_CAPS.ontology.input);
    });

    it("freezes a valid schema with its hash", async () => {
        const h = makeHarness({ spec: { contextMode: "graph" } });
        await runUnit(h, "sources");
        await runUnit(h, "ontology");
        const spec = h.artifacts.ontology as OntologySpec;
        expect(spec.validation).toEqual({ ok: true, errors: [], repairs: 0 });
        expect(spec.ontologyHash).toBe(hashOf(spec.schema));
        expect(spec.sourceManifestHash).toBe(h.artifacts.manifest!.manifestHash);
        expect(spec.plannerPromptVersion).toBe(h.spec.policies.versions.ontologyPlanner);
        expect(spec.plannerModel).toBe("route:default");
    });

    it("sends the errors back once, and keeps a repaired schema", async () => {
        let call = 0;
        const h = makeHarness({ spec: { contextMode: "graph" } });
        h.model = scriptedModel(request => {
            if (request.purpose !== "ontology") return runScript(request);
            call += 1;
            if (call === 1)
                return extension({
                    edges: [
                        {
                            ...extension().edges[0],
                            endpoints: [{ source: "Org", target: "Product" }],
                        },
                    ],
                });
            return extension();
        });
        await runUnit(h, "sources");
        await runUnit(h, "ontology");
        expect(h.model.requests).toHaveLength(2);
        expect(h.model.requests[1]!.prompt).toContain(
            '- Edge type "MIGRATES_FROM" has the endpoint "Org", which is not a defined entity type.'
        );
        expect(h.artifacts.ontology!.validation).toEqual({ ok: true, errors: [], repairs: 1 });
        expect(h.artifacts.ontology!.schema.edges.at(-1)?.name).toBe("MIGRATES_FROM");
    });

    it("falls back to the base schema, errors kept, when repairs run out", async () => {
        const h = makeHarness({ spec: { contextMode: "graph" } });
        h.collection.sections.push(section({ text: "Lee from Contoso signs the order forms." }));
        h.model = scriptedModel(request =>
            request.purpose === "ontology"
                ? extension({ entities: [{ ...extension().entities[0], name: "Saga" }] })
                : runScript(request)
        );
        await runUnit(h, "sources");
        await runUnit(h, "ontology");
        expect(h.model.requests).toHaveLength(1 + h.spec.budget.repairsPerUnit);
        const spec = h.artifacts.ontology!;
        expect(spec.schema).toEqual(BASE_ONTOLOGY);
        expect(spec.validation.ok).toBe(false);
        expect(spec.validation.repairs).toBe(1);
        expect(spec.validation.errors).toContain(
            'Entity type "Saga" uses a reserved name; pick another.'
        );
        expect(spec.ontologyHash).toBe(hashOf(BASE_ONTOLOGY));
    });
});
