import { join } from "node:path";
import {
    CatalogueProgramSchema,
    type ProgramView,
    type TrackerOpportunity,
} from "@launchstack/pipelines/accelerators";
import { loadPublishedCatalogue } from "@launchstack/pipelines/accelerators/catalogue";
import { available } from "@launchstack/pipelines/accelerators/intelligence";
import programFixture from "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json";
import type { ProgramDetailsMap } from "~/app/employer/tools/accelerators/_lib/details";
import {
    DEFAULT_VISION_FILTERS,
    applyVisionFilters,
    nextDeadline,
    readVisionFilters,
    updateVisionParams,
    type VisionFilters,
} from "~/app/employer/tools/accelerators/_lib/vision-filters";
import { programDetails } from "~/server/accelerators/details";

jest.mock("@launchstack/pipelines/accelerators/db", () => ({}));
const program = CatalogueProgramSchema.parse(programFixture);
const baseline = loadPublishedCatalogue(join(__dirname, "../../../../fixtures/accelerators"))
    .dossiers[0]!;
const TODAY = "2026-11-07";
function view(id: string): ProgramView {
    return {
        program: { ...program, id, name: id },
        contentHash: "v1",
        fit: null,
        freshness: { status: "not_assessed", reasons: [], assessedAt: null },
    };
}
function run(
    details: ProgramDetailsMap,
    filters: Partial<VisionFilters> = {},
    tracker: TrackerOpportunity[] = []
) {
    return applyVisionFilters(
        [view("known"), view("unknown")],
        { ...DEFAULT_VISION_FILTERS, ...filters },
        { details, tracker, today: TODAY }
    ).map(item => item.program.id);
}

it("matches published taxonomy facets across the catalogue but never unknowns", () => {
    const dossier = structuredClone(baseline);
    dossier.tags = [
        {
            id: "sector-climate",
            facet: "sector",
            label: "Climate",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        { id: "stage-seed", facet: "stage", label: "Seed", evidenceIds: [dossier.evidence[0]!.id] },
        {
            id: "technology-ai",
            facet: "technology",
            label: "AI",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        {
            id: "geography-europe",
            facet: "geography",
            label: "Europe",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        {
            id: "business-saas",
            facet: "business_model",
            label: "SaaS",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        {
            id: "customer-b2b",
            facet: "customer_type",
            label: "B2B",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        {
            id: "instrument-safe",
            facet: "instrument",
            label: "SAFE",
            evidenceIds: [dossier.evidence[0]!.id],
        },
        {
            id: "benefit-mentoring",
            facet: "benefit",
            label: "Mentoring",
            evidenceIds: [dossier.evidence[0]!.id],
        },
    ];
    const details = { known: programDetails(dossier) };
    expect(
        run(details, {
            sectors: ["sector-climate"],
            stage: "stage-seed",
            region: "geography-europe",
            technology: "technology-ai",
            businessModel: "business-saas",
            customerType: "customer-b2b",
            instrument: "instrument-safe",
            benefit: "benefit-mentoring",
        })
    ).toEqual(["known"]);
    expect(run(details, { sectors: ["not-a-published-sector"] })).toEqual([]);
    expect(run({}, { stage: "stage-seed" })).toEqual([]);
    expect(run({}, { deal: "equity_free" })).toEqual([]);
    expect(run({}, { deal: "fixed_equity" })).toEqual([]);
});

it("only counts real upcoming dossier dates, not narrative dates or catalogue guesses", () => {
    const dossier = structuredClone(baseline);
    dossier.batches.nextDeadline = available(
        "Expected November 2026",
        [dossier.evidence[0]!.id],
        "interpretation"
    );
    dossier.batches.cycles = [];
    const details = { known: programDetails(dossier) };
    expect(nextDeadline(program, details, TODAY)).toBeNull();
    expect(run(details, { deadline: "30" })).toEqual([]);
    dossier.batches.cycles = [
        {
            id: "next",
            label: "Winter",
            announcedDeadline: available(
                { at: null, dateOnly: "2026-12-07", timezone: null, rolling: false },
                [dossier.evidence[0]!.id],
                "fact"
            ),
        },
    ];
    details.known = programDetails(dossier);
    expect(nextDeadline(view("known").program, details, TODAY)).toBe("2026-12-07");
    expect(run(details, { deadline: "30" })).toEqual(["known"]);
    expect(nextDeadline(view("known").program, details, "2026-12-08")).toBeNull();
});

it("keeps pending and untracked views distinct", () => {
    const opportunity: TrackerOpportunity = {
        id: "o1",
        programId: "known",
        cycleId: null,
        priority: "medium",
        status: "applied",
        notes: "",
        submittedOn: null,
        nextAction: null,
        plannedDeadline: null,
        plannedDeadlineOn: null,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        tasks: [],
    };
    expect(run({}, { tracked: "pending" }, [opportunity])).toEqual(["known"]);
    expect(run({}, { tracked: "untracked" }, [opportunity])).toEqual(["unknown"]);
});

it("round-trips dossier tag identifiers and excludes defaults from URLs", () => {
    const filters: Partial<VisionFilters> = {
        sectors: ["sector-climate"],
        stage: "stage-seed",
        benefit: "benefit-mentoring",
        tracked: "untracked",
        deadline: "30",
        sort: "deadline",
        includeIneligible: true,
    };
    const params = updateVisionParams(new URLSearchParams("q=cold"), filters);
    expect(readVisionFilters(params)).toEqual({ ...DEFAULT_VISION_FILTERS, ...filters });
    expect(updateVisionParams(params, DEFAULT_VISION_FILTERS).toString()).toBe("q=cold");
});
