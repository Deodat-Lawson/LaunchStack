import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    hashValue,
    MAX_PROGRAMS_PER_RUN,
    type CatalogueProgram,
    type PortfolioEvidenceLookup,
} from "@launchstack/pipelines/accelerators";
import {
    PROPOSAL_CREDITS,
    type OrgProfile,
    type ProposalPorts,
    type RunRecord,
} from "@launchstack/pipelines/proposals";

const mockCatalogue = jest.fn();
const mockDossiers = jest.fn();
const mockSave = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    listCatalogue: (...args: unknown[]) => mockCatalogue(...args),
    listProgramIntelligence: (...args: unknown[]) => mockDossiers(...args),
    saveCompanyMatches: (...args: unknown[]) => mockSave(...args),
}));
const mockProfile = jest.fn();
jest.mock("@launchstack/pipelines/proposals/db", () => ({
    loadOrgProfile: (...args: unknown[]) => mockProfile(...args),
}));
jest.mock("~/server/accelerators/portfolio-evidence", () => ({
    portfolioEvidenceFor: () => () => Promise.resolve({ supported: false }),
}));

import { prepareAcceleratorRun, SCORING_BATCH_SIZE } from "~/server/accelerators/run";

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
const ctx = { runId: "run-1", companyId: 9n, userId: "u1", scope: { kind: "everything" } as const };
const unsupported: () => PortfolioEvidenceLookup = () => () =>
    Promise.resolve({ supported: false });
let program: CatalogueProgram;

function runFor(programIds: unknown): RunRecord {
    return { id: "run-1", kind: "programs", input: { programs: { programIds } } } as RunRecord;
}
function catalogueOf(ids: string[]) {
    return ids.map(id => {
        const entry = { ...program, id };
        return { program: entry, contentHash: hashValue(entry) };
    });
}

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
    mockDossiers.mockResolvedValue([]);
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
const goodAnswer = () =>
    modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: ["3"] });

type Answer = (programId: string) => unknown;

/** Answers every Program the payload names; the schema check is the real one. */
function portsAnswering(answer: Answer = goodAnswer) {
    const structured = jest.fn(
        async (
            _stage: unknown,
            schema: { parse(v: unknown): unknown },
            _system: string,
            user: string
        ) => {
            const { programs } = JSON.parse(user) as { programs: { id: string }[] };
            return {
                result: schema.parse({
                    assessments: Object.fromEntries(programs.map(({ id }) => [id, answer(id)])),
                }),
                modelId: "fixture",
            };
        }
    );
    return { ports: { structured } as unknown as ProposalPorts, structured };
}
const payloadIds = (call: unknown[]) =>
    (JSON.parse(call[3] as string) as { programs: { id: string }[] }).programs.map(({ id }) => id);

it("asks the accelerator stage for every dimension except portfolio", async () => {
    const { ports, structured } = portsAnswering();
    await prepareAcceleratorRun(ctx, ports, runFor([program.id]), unsupported);
    expect(structured.mock.calls[0]![0]).toBe("acceleratorScore");
    const schema = structured.mock.calls[0]![1] as { parse(v: unknown): unknown };
    const withPortfolio = goodAnswer() as { dimensions: Record<string, unknown> };
    withPortfolio.dimensions.portfolio = withPortfolio.dimensions.stage;
    expect(() => schema.parse({ assessments: { [program.id]: withPortfolio } })).toThrow();
});

it("completes the assessment by rubric rule and saves it under the current rubric", async () => {
    const sourceId = program.sources[0]!.id;
    const { ports } = portsAnswering();
    const asked: string[] = [];
    const prepared = await prepareAcceleratorRun(ctx, ports, runFor([program.id]), () => id => {
        asked.push(id);
        return Promise.resolve({ supported: false });
    });
    await prepared.commit({} as never);
    expect(asked).toEqual([program.id]);
    expect(prepared.amount).toBe(PROPOSAL_CREDITS.programs);
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

it("grades portfolio for a Supported Program from its nearest past companies", async () => {
    const { ports } = portsAnswering();
    const prepared = await prepareAcceleratorRun(
        ctx,
        ports,
        runFor([program.id]),
        () => () =>
            Promise.resolve({
                supported: true,
                companyEvidenceIds: [3],
                matches: [
                    {
                        companyId: "yc:a",
                        name: "A",
                        batch: "W21",
                        similarity: 0.62,
                        sharedTerms: [],
                    },
                    {
                        companyId: "yc:b",
                        name: "B",
                        batch: "S22",
                        similarity: 0.6,
                        sharedTerms: [],
                    },
                ],
            })
    );
    await prepared.commit({} as never);
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results[0].assessment.dimensions.portfolio).toMatchObject({
        score: 75,
        applicable: true,
        evidence: { sourceIds: [], companyEvidenceIds: [3] },
    });
    expect(results[0].assessment.dimensions.portfolio.evidence.portfolioCompanies).toHaveLength(2);
});

it("splits the selection into batches and merges every batch's results", async () => {
    const ids = Array.from(
        { length: 23 },
        (_, index) => `program-${String(index).padStart(2, "0")}`
    );
    mockCatalogue.mockResolvedValue(catalogueOf(ids));
    const { ports, structured } = portsAnswering();
    const prepared = await prepareAcceleratorRun(
        ctx,
        ports,
        runFor([...ids].reverse()),
        unsupported
    );
    await prepared.commit({} as never);
    const batches = structured.mock.calls.map(call => payloadIds(call as unknown[]));
    expect(batches.map(batch => batch.length)).toEqual([SCORING_BATCH_SIZE, SCORING_BATCH_SIZE, 3]);
    // Batches are formed from the sorted selection, so the same choice repeats its batches.
    expect(batches.flat()).toEqual(ids);
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results.map((result: { programId: string }) => result.programId)).toEqual(ids);
    expect(prepared.amount).toBe(PROPOSAL_CREDITS.programs * 23);
    expect(prepared.summary.counts).toEqual({ matched: 23, notAssessed: 0 });
});

it("scores and saves only the chosen subset, leaving other Programs untouched", async () => {
    mockCatalogue.mockResolvedValue(catalogueOf(["alpha", "beta", "gamma"]));
    const { ports, structured } = portsAnswering();
    const prepared = await prepareAcceleratorRun(
        ctx,
        ports,
        runFor(["gamma", "alpha"]),
        unsupported
    );
    await prepared.commit({} as never);
    expect(payloadIds(structured.mock.calls[0] as unknown[])).toEqual(["alpha", "gamma"]);
    expect(structured.mock.calls[0]![3]).not.toContain('"beta"');
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results.map((result: { programId: string }) => result.programId)).toEqual([
        "alpha",
        "gamma",
    ]);
});

it("leaves a Program the model cannot assess validly out, without failing the run", async () => {
    mockCatalogue.mockResolvedValue(catalogueOf(["alpha", "beta", "gamma"]));
    const { ports, structured } = portsAnswering(id =>
        id === "beta"
            ? modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: [] })
            : goodAnswer()
    );
    const prepared = await prepareAcceleratorRun(
        ctx,
        ports,
        runFor(["alpha", "beta", "gamma"]),
        unsupported
    );
    await prepared.commit({} as never);
    // One failed batch call, then each Program alone.
    expect(structured.mock.calls.map(call => payloadIds(call as unknown[]))).toEqual([
        ["alpha", "beta", "gamma"],
        ["alpha"],
        ["beta"],
        ["gamma"],
    ]);
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results.map((result: { programId: string }) => result.programId)).toEqual([
        "alpha",
        "gamma",
    ]);
    expect(prepared.summary.counts).toEqual({ matched: 2, notAssessed: 1 });
    expect(prepared.amount).toBe(PROPOSAL_CREDITS.programs * 2);
});

it("fails the run, saving and charging nothing, when no Program can be assessed", async () => {
    const { ports } = portsAnswering(() =>
        modelAnswer({ sourceIds: [program.sources[0]!.id], companyEvidenceIds: [] })
    );
    await expect(
        prepareAcceleratorRun(ctx, ports, runFor([program.id]), unsupported)
    ).rejects.toThrow();
    expect(mockSave).not.toHaveBeenCalled();
});

it("fails the run on an error that is not a validation failure", async () => {
    const structured = jest.fn().mockRejectedValue(new Error("model endpoint down"));
    await expect(
        prepareAcceleratorRun(
            ctx,
            { structured } as unknown as ProposalPorts,
            runFor([program.id]),
            unsupported
        )
    ).rejects.toThrow("model endpoint down");
    expect(structured).toHaveBeenCalledTimes(1);
});

it.each([
    ["no selection", undefined],
    ["an empty selection", []],
    ["a duplicate", ["abovea-startup-accelerator", "abovea-startup-accelerator"]],
    ["an unknown Program", ["abovea-startup-accelerator", "not-in-catalogue"]],
    ["too many Programs", Array.from({ length: MAX_PROGRAMS_PER_RUN + 1 }, (_, i) => `p-${i}`)],
])("rejects %s before asking the model", async (_label, programIds) => {
    const { ports, structured } = portsAnswering();
    await expect(
        prepareAcceleratorRun(ctx, ports, runFor(programIds), unsupported)
    ).rejects.toMatchObject({ status: 400, code: "invalid_programs" });
    expect(structured).not.toHaveBeenCalled();
});

it("rejects evidence IDs the Program or profile does not have", async () => {
    const { ports } = portsAnswering(() =>
        modelAnswer({ sourceIds: ["not-a-source"], companyEvidenceIds: ["99"] })
    );
    await expect(
        prepareAcceleratorRun(ctx, ports, runFor([program.id]), unsupported)
    ).rejects.toThrow();
});

it("rejects scores off the anchored scale", async () => {
    const answer = goodAnswer();
    (answer.dimensions.sector as { score: number }).score = 60;
    const { ports } = portsAnswering(() => answer);
    await expect(
        prepareAcceleratorRun(ctx, ports, runFor([program.id]), unsupported)
    ).rejects.toThrow();
});

it("sends structured dossier facts and lets the model cite their evidence", async () => {
    const slot = (value: unknown, evidenceIds: string[]) => ({
        state: "available",
        detail: null,
        evidenceIds,
        claim: "fact",
        value,
    });
    const unchecked = {
        state: "not_checked",
        detail: "Not checked",
        evidenceIds: [],
        claim: null,
        value: null,
    };
    mockDossiers.mockResolvedValue([
        {
            contentHash: "x",
            dossier: {
                programId: program.id,
                evidence: [
                    {
                        id: "check-deal-1",
                        url: "https://example.com/terms",
                        title: "Terms",
                        excerpt: "$150,000 for 5% equity.",
                        checkedAt: "2026-11-01T00:00:00Z",
                        kind: "fact",
                        origin: "official",
                        page: "terms",
                    },
                ],
                identity: {
                    location: slot("Berlin", []),
                    operatingStatus: unchecked,
                    applicationsOpen: unchecked,
                },
                audience: {
                    stages: slot(["Pre-seed"], []),
                    sectors: slot(["AI"], []),
                    technologies: unchecked,
                    businessModels: unchecked,
                    customerTypes: unchecked,
                    geography: unchecked,
                    constraints: unchecked,
                },
                deal: {
                    state: "available",
                    summary: slot("$150k for 5%", ["check-deal-1"]),
                    components: [],
                },
                batches: {
                    cycles: [],
                    nextDeadline: unchecked,
                    historicalCadence: unchecked,
                    announcedStarts: unchecked,
                },
                tags: [{ id: "sector-ai", facet: "sector", label: "AI", evidenceIds: [] }],
            },
        },
    ]);
    const { ports, structured } = portsAnswering(() =>
        modelAnswer({ sourceIds: ["check-deal-1"], companyEvidenceIds: ["3"] })
    );
    const prepared = await prepareAcceleratorRun(ctx, ports, runFor([program.id]), unsupported);
    const sent = JSON.parse(structured.mock.calls[0]![3]) as {
        programs: { facts: Record<string, unknown>; evidence: { id: string }[] }[];
    };
    expect(sent.programs[0]!.facts).toMatchObject({
        location: { value: "Berlin" },
        sectors: { value: ["AI"] },
        deal: { summary: { value: "$150k for 5%", evidenceIds: ["check-deal-1"] } },
        tags: [{ facet: "sector", label: "AI" }],
    });
    expect(sent.programs[0]!.evidence.map(item => item.id)).toEqual(["check-deal-1"]);
    await prepared.commit({} as never);
    const [, , results] = mockSave.mock.calls[0]!;
    expect(results[0].assessment.dimensions.sector.evidence.sourceIds).toEqual(["check-deal-1"]);
});
