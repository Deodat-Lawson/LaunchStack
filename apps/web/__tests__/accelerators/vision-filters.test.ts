import {
    CatalogueProgramSchema,
    type ProgramView,
    type TrackerOpportunity,
} from "@launchstack/pipelines/accelerators";

import programFixture from "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json";
import type {
    DemoLayer,
    IllustrativeFit,
    ProgramDetails,
} from "~/app/employer/tools/accelerators/_lib/demo";
import {
    DEFAULT_VISION_FILTERS,
    applyVisionFilters,
    nextDeadline,
    readVisionFilters,
    updateVisionParams,
    type VisionFilters,
} from "~/app/employer/tools/accelerators/_lib/vision-filters";

const program = CatalogueProgramSchema.parse(programFixture);
const TODAY = "2026-11-07";

function view(id: string, cycles: ProgramView["program"]["cycles"] = []): ProgramView {
    return {
        program: { ...program, id, name: id, cycles },
        contentHash: "program-version",
        fit: null,
        fitStale: false,
    };
}

function details(fields: Partial<ProgramDetails> = {}): ProgramDetails {
    return {
        operatingStatus: "active",
        stages: ["seed"],
        generalist: false,
        sectors: [],
        regions: [],
        format: null,
        durationWeeks: null,
        contact: { email: null, phone: null, contactUrl: null },
        applyRoutes: [],
        batches: { cadence: null, next: null, recent: [] },
        selectivity: { acceptanceRatePercent: null, note: null },
        deal: null,
        sources: [],
        ...fields,
    };
}

function fit(
    score: number | null,
    eligibility: IllustrativeFit["eligibility"] = "unknown"
): IllustrativeFit {
    const rated = { score, applicable: true, note: "" };
    return {
        eligibility,
        eligibilityNote: "",
        dimensions: {
            sector: rated,
            stage: rated,
            businessModel: rated,
            portfolio: { score: null, applicable: false, note: "" },
            deal: rated,
            operations: rated,
            value: rated,
        },
    };
}

function opportunity(
    programId: string,
    fields: Partial<TrackerOpportunity> = {}
): TrackerOpportunity {
    return {
        id: `${programId}-opportunity`,
        programId,
        cycleId: null,
        priority: "medium",
        status: "shortlisted",
        notes: "",
        submittedOn: null,
        nextAction: null,
        plannedDeadline: null,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        tasks: [],
        ...fields,
    };
}

function ids(
    programs: string[],
    demo: DemoLayer,
    filters: Partial<VisionFilters>,
    tracker: TrackerOpportunity[] = []
): string[] {
    return applyVisionFilters(
        programs.map(id => view(id)),
        { ...DEFAULT_VISION_FILTERS, ...filters },
        {
            demo,
            tracker,
            today: TODAY,
        }
    ).map(item => item.program.id);
}

describe("sector facet", () => {
    it("matches any selected sector, keeps generalists, and never matches unknown details", () => {
        const demo: DemoLayer = {
            details: {
                climate: details({ sectors: ["climate"] }),
                hardware: details({ sectors: ["hardware"] }),
                generalist: details({ generalist: true }),
                fintech: details({ sectors: ["fintech"] }),
            },
            fits: {},
        };
        expect(
            ids(["climate", "hardware", "generalist", "fintech", "undocumented"], demo, {
                sectors: ["climate", "hardware"],
                sort: "name",
            })
        ).toEqual(["climate", "generalist", "hardware"]);
    });
});

describe("deadline window", () => {
    const next = (deadline: string, deadlineKind: "announced" | "expected" = "announced") =>
        details({
            batches: { cadence: null, next: { label: "x", deadline, deadlineKind }, recent: [] },
        });
    const demo: DemoLayer = {
        details: {
            inThirty: next("2026-12-07"),
            inForty: next("2026-12-17"),
            past: next("2026-11-01"),
            expected: next("2026-11-20", "expected"),
        },
        fits: {},
    };
    const all = ["inThirty", "inForty", "past", "expected"];

    it("counts only announced, upcoming deadlines inside the window", () => {
        expect(ids(all, demo, { deadline: "30", sort: "name" })).toEqual(["inThirty"]);
        expect(ids(all, demo, { deadline: "90", sort: "name" })).toEqual(["inForty", "inThirty"]);
    });

    it("sorts by the nearest announced deadline and puts unknown ones last", () => {
        expect(ids(all, demo, { sort: "deadline" })).toEqual([
            "inThirty",
            "inForty",
            "past",
            "expected",
        ]);
    });

    it("prefers the nearest recorded Cycle deadline over an announced intake", () => {
        const recorded = view("recorded", [
            {
                id: "closed",
                label: "Closed",
                deadlineAt: null,
                deadlineTimezone: null,
                dateOnly: "2026-11-01",
                rolling: false,
                sourceIds: [program.sources[0]!.id],
            },
            {
                id: "open",
                label: "Open",
                deadlineAt: "2026-11-20T23:59:00-08:00",
                deadlineTimezone: "America/Los_Angeles",
                rolling: false,
                sourceIds: [program.sources[0]!.id],
            },
        ]);
        expect(nextDeadline(recorded.program, demo, TODAY)).toBe("2026-11-20");
        expect(nextDeadline(view("inForty").program, demo, TODAY)).toBe("2026-12-17");
    });
});

describe("tracker facets", () => {
    const demo: DemoLayer = { details: {}, fits: {} };
    const tracker = [
        opportunity("applied", { status: "applied", priority: "low" }),
        opportunity("interviewing", { status: "interviewing" }),
        opportunity("rejected", { status: "rejected", priority: "high" }),
    ];
    const all = ["applied", "interviewing", "rejected", "untracked"];

    it("treats applied and interviewing as pending, and separates untracked Programs", () => {
        expect(ids(all, demo, { tracked: "pending", sort: "name" }, tracker)).toEqual([
            "applied",
            "interviewing",
        ]);
        expect(ids(all, demo, { tracked: "untracked" }, tracker)).toEqual(["untracked"]);
    });

    it("sorts tracked Programs by priority with untracked ones last", () => {
        expect(ids(all, demo, { sort: "priority" }, tracker)).toEqual([
            "rejected",
            "interviewing",
            "applied",
            "untracked",
        ]);
    });
});

describe("eligibility and fit ordering", () => {
    const demo: DemoLayer = {
        details: {},
        fits: { strong: fit(75), weak: fit(25), excluded: fit(100, "ineligible"), thin: fit(null) },
    };
    const all = ["weak", "thin", "strong", "excluded", "unscored"];

    it("hides confirmed ineligible Programs unless asked to include them", () => {
        expect(ids(all, demo, {})).not.toContain("excluded");
        expect(ids(all, demo, { includeIneligible: true })[0]).toBe("excluded");
    });

    it("ranks by overall fit and keeps scores without enough evidence after scored ones", () => {
        expect(ids(all, demo, {})).toEqual(["strong", "weak", "thin", "unscored"]);
    });
});

it("round-trips filters through the URL and leaves defaults out of it", () => {
    const filters: Partial<VisionFilters> = {
        sectors: ["climate", "hardware"],
        stage: "seed",
        deadline: "30",
        tracked: "pending",
        sort: "deadline",
        includeIneligible: true,
    };
    const params = updateVisionParams(new URLSearchParams("q=cold"), filters);
    expect(readVisionFilters(params)).toEqual({ ...DEFAULT_VISION_FILTERS, ...filters });
    const cleared = updateVisionParams(params, DEFAULT_VISION_FILTERS);
    expect(cleared.toString()).toBe("q=cold");
});
