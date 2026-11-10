import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    hashValue,
    type CatalogueProgram,
} from "@launchstack/pipelines/accelerators";
import type { OrgProfile, ProposalPorts, RunRecord } from "@launchstack/pipelines/proposals";

const mockCatalogue = jest.fn();
const mockSave = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    listCatalogue: (...args: unknown[]) => mockCatalogue(...args),
    saveCompanyMatches: (...args: unknown[]) => mockSave(...args),
}));
const mockProfile = jest.fn();
jest.mock("@launchstack/pipelines/proposals/db", () => ({
    loadOrgProfile: (...args: unknown[]) => mockProfile(...args),
}));

import { prepareAcceleratorRun } from "~/server/accelerators/run";

const profile: OrgProfile = {
    summary: "Builds document AI for HR teams.",
    applicantType: "for_profit",
    focusAreas: [],
    geography: [],
    facts: [
        { key: "product", label: "Product", value: "Document AI", cites: [3], source: "documents" },
    ],
    evidence: [
        {
            n: 3,
            documentId: 1,
            title: "Deck",
            page: 1,
            quote: "We sell AI document review.",
            url: null,
        },
    ],
    builtFrom: { documents: 1, snippets: 1 },
    builtAt: "2026-11-09T00:00:00Z",
    promptVersion: "fixture",
};
const run = { id: "run-1", kind: "programs" } as RunRecord;
const ctx = { runId: "run-1", companyId: 9n, userId: "u1", scope: { kind: "everything" } as const };
let program: CatalogueProgram;

beforeAll(async () => {
    program = CatalogueProgramSchema.parse(
        JSON.parse(
            await readFile(
                join(
                    __dirname,
                    "../../../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json"
                ),
                "utf8"
            )
        )
    );
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCatalogue.mockResolvedValue([{ program, contentHash: hashValue(program) }]);
    mockProfile.mockResolvedValue(profile);
});

/** A model answer: sector rated with evidence, everything else unknown. */
function modelAnswer(sector: { sourceIds: string[]; companyEvidenceIds: string[] }) {
    return {
        eligibility: { status: "unknown", note: "Incorporation is not stated." },
        dimensions: Object.fromEntries(
            FIT_DIMENSION_KEYS.filter(key => key !== "portfolio").map(key => [
                key,
                key === "sector"
                    ? { score: 75, note: "Close focus match.", ...sector }
                    : {
                          score: null,
                          note: "The profile does not say.",
                          sourceIds: [],
                          companyEvidenceIds: [],
                      },
            ])
        ),
    };
}

function portsAnswering(answer: unknown) {
    const structured = jest.fn(async (_stage: unknown, schema: { parse(v: unknown): unknown }) => ({
        result: schema.parse({ assessments: { [program.id]: answer } }),
        modelId: "fixture",
    }));
    return { ports: { structured } as unknown as ProposalPorts, structured };
}

it("asks the model for every dimension except portfolio", async () => {
    const { ports, structured } = portsAnswering(
        modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: ["3"] })
    );
    await prepareAcceleratorRun(ctx, ports, run, () => Promise.resolve(false));
    const schema = structured.mock.calls[0]![1] as {
        parse(v: unknown): unknown;
    };
    const withPortfolio = modelAnswer({ sourceIds: [], companyEvidenceIds: [] }) as {
        dimensions: Record<string, unknown>;
    };
    withPortfolio.dimensions.portfolio = withPortfolio.dimensions.stage;
    expect(() => schema.parse({ assessments: { [program.id]: withPortfolio } })).toThrow();
});

it("completes the assessment by rubric rule and saves it under fit-v1", async () => {
    const sourceId = program.sources[0]!.id;
    const { ports } = portsAnswering(
        modelAnswer({ sourceIds: [sourceId], companyEvidenceIds: ["3"] })
    );
    const asked: string[] = [];
    const prepared = await prepareAcceleratorRun(ctx, ports, run, id => {
        asked.push(id);
        return Promise.resolve(false);
    });
    await prepared.commit({} as never);
    expect(asked).toEqual([program.id]);
    const [, profileHash, results] = mockSave.mock.calls[0]!;
    expect(profileHash).toBe(hashValue(profile));
    expect(results).toEqual([
        {
            programId: program.id,
            programHash: hashValue(program),
            assessment: expect.objectContaining({
                rubricVersion: FIT_RUBRIC_VERSION,
                eligibility: { status: "unknown", note: "Incorporation is not stated." },
            }),
        },
    ]);
    const { dimensions } = results[0].assessment;
    expect(dimensions.sector).toEqual({
        score: 75,
        applicable: true,
        note: "Close focus match.",
        evidence: { sourceIds: [sourceId], companyEvidenceIds: [3] },
    });
    expect(dimensions.deal).toMatchObject({ score: null, applicable: true });
    expect(dimensions.portfolio).toMatchObject({ score: null, applicable: false });
});

it("fails the run rather than store a rating without company evidence", async () => {
    const { ports } = portsAnswering(
        modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: [] })
    );
    await expect(
        prepareAcceleratorRun(ctx, ports, run, () => Promise.resolve(false))
    ).rejects.toThrow();
    expect(mockSave).not.toHaveBeenCalled();
});

it("rejects evidence IDs the Program or profile does not have", async () => {
    const { ports } = portsAnswering(
        modelAnswer({ sourceIds: ["not-a-source"], companyEvidenceIds: ["99"] })
    );
    await expect(
        prepareAcceleratorRun(ctx, ports, run, () => Promise.resolve(false))
    ).rejects.toThrow();
});

it("rejects scores off the anchored scale", async () => {
    const answer = modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: ["3"] });
    (answer.dimensions.sector as { score: number }).score = 60;
    const { ports } = portsAnswering(answer);
    await expect(
        prepareAcceleratorRun(ctx, ports, run, () => Promise.resolve(false))
    ).rejects.toThrow();
});

it("scores only the matched Programs and leaves the rest of the catalogue unsaved", async () => {
    const unmatched = { ...program, id: "not-in-matching-scope" };
    mockCatalogue.mockResolvedValue([
        { program, contentHash: hashValue(program) },
        { program: unmatched, contentHash: hashValue(unmatched) },
    ]);
    const { ports, structured } = portsAnswering(
        modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: ["3"] })
    );
    const prepared = await prepareAcceleratorRun(ctx, ports, run, () => Promise.resolve(false));
    await prepared.commit({} as never);
    const payload = (structured.mock.calls[0] as unknown[])[3] as string;
    expect(payload).toContain(program.id);
    expect(payload).not.toContain(unmatched.id);
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results.map((result: { programId: string }) => result.programId)).toEqual([program.id]);
});
