import {
    CatalogueProgramSchema,
    type ProgramCycle,
    type ProgramView,
} from "@launchstack/pipelines/accelerators";

import programFixture from "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json";
import {
    DEFAULT_DISCOVERY_FILTERS,
    filterPrograms,
    rankPrograms,
    readDiscoveryFilters,
    updateDiscoveryParams,
    type DiscoveryFilters,
} from "~/app/employer/tools/accelerators/_lib/discovery";

const program = CatalogueProgramSchema.parse(programFixture);

function view(
    id: string,
    score: number | null | "unmatched" = "unmatched",
    options: { stale?: boolean; program?: Partial<ProgramView["program"]> } = {}
): ProgramView {
    return {
        program: {
            ...program,
            id,
            name: id,
            description: { ...program.description, text: "General business support" },
            targetApplicants: { ...program.targetApplicants, text: "Company founders" },
            cycles: [],
            ...options.program,
        },
        contentHash: "program-version",
        fitStale: options.stale ?? false,
        fit:
            score === "unmatched"
                ? null
                : {
                      assessment: {
                          score,
                          reasons: [],
                          concerns: [],
                          unknowns: [],
                          sourceIds: [],
                          companyEvidenceIds: [],
                      },
                      profileHash: "profile-version",
                      programHash: "program-version",
                      checkedAt: "2026-11-02T00:00:00Z",
                  },
    };
}

function cycle(id: string, fields: Partial<ProgramCycle> = {}): ProgramCycle {
    return {
        id,
        label: id,
        deadlineAt: null,
        deadlineTimezone: null,
        rolling: false,
        sourceIds: [program.sources[0]!.id],
        ...fields,
    };
}

function ids(programs: readonly ProgramView[], filters: Partial<DiscoveryFilters> = {}) {
    return filterPrograms(programs, { ...DEFAULT_DISCOVERY_FILTERS, ...filters }).map(
        item => item.program.id
    );
}

describe("Program text search", () => {
    const programs = [
        view("match", "unmatched", {
            program: {
                name: "NorthStar Lab",
                description: { ...program.description, text: "Robotics research" },
                targetApplicants: { ...program.targetApplicants, text: "Technical scientists" },
                location: { ...program.description, text: "Singapore" },
                cycles: [cycle("winter", { label: "Winter cohort" })],
            },
        }),
        view("other"),
    ];

    it.each([
        ["name", "northSTAR"],
        ["description", "rObOtics"],
        ["target applicants", "SCIENTISTS"],
        ["location", "sINGAPORE"],
        ["Cycle label", "WINTER"],
    ])("finds case-insensitive terms in the %s", (_field, q) => {
        expect(ids(programs, { q })).toEqual(["match"]);
    });

    it("requires every term while allowing terms to occur in different fields", () => {
        expect(
            ids(programs, { q: "  NORTHSTAR\t robotics scientists\n singapore winter  " })
        ).toEqual(["match"]);
        expect(ids(programs, { q: "northstar robotics missing" })).toEqual([]);
    });

    it("treats whitespace as an empty search and supports absent location and Cycles", () => {
        expect(ids(programs, { q: " \t\n " })).toEqual(["match", "other"]);
        expect(ids(programs, { q: "other" })).toEqual(["other"]);
        expect(ids([programs[1]!], { q: "singapore" })).toEqual([]);
    });

    it("does not search source metadata or invent classifications", () => {
        const sourceOnly = view("plain", "unmatched", {
            program: {
                sources: [{ ...program.sources[0]!, quote: "source-only-healthcare" }],
                websiteUrl: "https://metadata-only.example/",
            },
        });
        expect(ids([sourceOnly], { q: "source-only-healthcare" })).toEqual([]);
        expect(ids([sourceOnly], { q: "metadata-only" })).toEqual([]);
    });
});

describe("saved fit filters", () => {
    const programs = [
        view("zero", 0),
        view("scored", 76),
        view("unscorable", null),
        view("unmatched"),
        view("stale-numeric", 100, { stale: true }),
        view("stale-null", null, { stale: true }),
    ];

    it.each<[DiscoveryFilters["fit"], string[]]>([
        ["all", ["zero", "scored", "unscorable", "unmatched", "stale-numeric", "stale-null"]],
        ["scored", ["zero", "scored"]],
        ["unmatched", ["unmatched"]],
        ["unscorable", ["unscorable"]],
        ["stale", ["stale-numeric", "stale-null"]],
    ])("keeps the %s status distinct", (fit, expected) => {
        expect(ids(programs, { fit })).toEqual(expected);
    });

    it("includes unknown and stale fits when the minimum is any score", () => {
        expect(ids(programs, { minScore: null })).toEqual([
            "zero",
            "scored",
            "unscorable",
            "unmatched",
            "stale-numeric",
            "stale-null",
        ]);
    });

    const numericPrograms = [
        view("zero", 0),
        view("below-25", 24),
        view("at-25", 25),
        view("below-50", 49),
        view("at-50", 50),
        view("below-75", 74),
        view("at-75", 75),
        view("maximum", 100),
        view("unscorable", null),
        view("unmatched"),
        view("stale", 100, { stale: true }),
    ];

    it.each<[NonNullable<DiscoveryFilters["minScore"]>, string[]]>([
        [0, ["zero", "below-25", "at-25", "below-50", "at-50", "below-75", "at-75", "maximum"]],
        [25, ["at-25", "below-50", "at-50", "below-75", "at-75", "maximum"]],
        [50, ["at-50", "below-75", "at-75", "maximum"]],
        [75, ["at-75", "maximum"]],
    ])(
        "applies an inclusive minimum of %s only to current numeric scores",
        (minScore, expected) => {
            expect(ids(numericPrograms, { minScore })).toEqual(expected);
        }
    );

    it("combines the fit status and minimum instead of treating missing scores as zero", () => {
        expect(ids(programs, { fit: "unscorable", minScore: 0 })).toEqual([]);
        expect(ids(programs, { fit: "unmatched", minScore: 0 })).toEqual([]);
        expect(ids(programs, { fit: "stale", minScore: 0 })).toEqual([]);
        expect(ids(programs, { fit: "scored", minScore: 0 })).toEqual(["zero", "scored"]);
    });
});

describe("factual intake filters", () => {
    const programs = [
        view("no-cycles"),
        view("unconfirmed", "unmatched", { program: { cycles: [cycle("unknown")] } }),
        view("rolling", "unmatched", {
            program: { cycles: [cycle("rolling", { rolling: true })] },
        }),
        view("exact-date", "unmatched", {
            program: {
                cycles: [
                    cycle("exact", {
                        deadlineAt: "2000-01-01T12:00:00Z",
                        deadlineTimezone: "UTC",
                    }),
                ],
            },
        }),
        view("date-only", "unmatched", {
            program: { cycles: [cycle("date", { dateOnly: "2000-01-01" })] },
        }),
        view("multiple-cycles", "unmatched", {
            program: {
                cycles: [
                    cycle("rolling", { rolling: true }),
                    cycle("dated", { dateOnly: "2027-01-01" }),
                    cycle("unknown"),
                ],
            },
        }),
        view("rolling-with-date", "unmatched", {
            program: { cycles: [cycle("both", { rolling: true, dateOnly: "2027-01-01" })] },
        }),
    ];

    it.each<[DiscoveryFilters["intake"], string[]]>([
        [
            "all",
            [
                "no-cycles",
                "unconfirmed",
                "rolling",
                "exact-date",
                "date-only",
                "multiple-cycles",
                "rolling-with-date",
            ],
        ],
        ["rolling", ["rolling", "multiple-cycles", "rolling-with-date"]],
        ["dated", ["exact-date", "date-only", "multiple-cycles", "rolling-with-date"]],
        ["unknown", ["no-cycles", "unconfirmed"]],
    ])("uses only recorded Cycle facts for %s intake", (intake, expected) => {
        expect(ids(programs, { intake })).toEqual(expected);
    });
});

it("combines all four controls with AND", () => {
    const rolling = { cycles: [cycle("rolling", { rolling: true })] };
    const programs = [
        view("deeptech-match", 75, { program: rolling }),
        view("other-search", 90, { program: rolling }),
        view("deeptech-stale", 90, { stale: true, program: rolling }),
        view("deeptech-low", 74, { program: rolling }),
        view("deeptech-dated", 90, {
            program: { cycles: [cycle("dated", { dateOnly: "2027-01-01" })] },
        }),
    ];
    expect(
        ids(programs, { q: "DEEPTECH", fit: "scored", minScore: 75, intake: "rolling" })
    ).toEqual(["deeptech-match"]);
});

it("ranks current scores first, keeps a real zero, and sorts remaining ties by locale name", () => {
    const programs = Object.freeze([
        view("Zulu", 75),
        view("Unknown", null),
        view("Zero", 0),
        view("Stale", 100, { stale: true }),
        view("Alpha", 75),
        view("Missing"),
    ]);
    const before = JSON.stringify(programs);
    const ranked = rankPrograms(programs, "en");
    expect(ids(ranked)).toEqual(["Alpha", "Zulu", "Zero", "Missing", "Stale", "Unknown"]);
    expect(ids(ranked, { minScore: 75 })).toEqual(["Alpha", "Zulu"]);
    expect(ids(ranked, DEFAULT_DISCOVERY_FILTERS)).toEqual([
        "Alpha",
        "Zulu",
        "Zero",
        "Missing",
        "Stale",
        "Unknown",
    ]);
    expect(JSON.stringify(programs)).toBe(before);
});

it("uses the supplied locale for name ordering", () => {
    const programs = [view("Åland"), view("Zulu")];
    expect(rankPrograms(programs, "sv").map(item => item.program.id)).toEqual(["Zulu", "Åland"]);
    expect(rankPrograms(programs, "en").map(item => item.program.id)).toEqual(["Åland", "Zulu"]);
});

describe("discovery query state", () => {
    it("reads the four controls, preserving a numeric zero and the typed search text", () => {
        const params = new URLSearchParams(
            "q=++robotics+&fit=unscorable&minScore=0&intake=unknown"
        );
        expect(readDiscoveryFilters(params)).toEqual({
            q: "  robotics ",
            fit: "unscorable",
            minScore: 0,
            intake: "unknown",
        });
    });

    it.each(["", "unknown", "-1", "1", "100", "00", "25.0"])(
        "does not coerce an unsupported minimum %j into a score",
        minScore => {
            const params = new URLSearchParams({ fit: "invalid", intake: "invalid", minScore });
            expect(readDiscoveryFilters(params)).toEqual(DEFAULT_DISCOVERY_FILTERS);
        }
    );

    it("round-trips edits without losing unrelated or repeated query parameters", () => {
        const params = new URLSearchParams("q=old&fit=stale&panel=notes&panel=sources");
        const before = params.toString();
        const next = updateDiscoveryParams(params, {
            q: "robotics lab",
            minScore: 0,
            intake: "dated",
        });
        expect(readDiscoveryFilters(new URLSearchParams(next.toString()))).toEqual({
            q: "robotics lab",
            fit: "stale",
            minScore: 0,
            intake: "dated",
        });
        expect(next.getAll("panel")).toEqual(["notes", "sources"]);
        expect(params.toString()).toBe(before);
    });

    it("resets exactly the four controls and restores all Programs in ranked order", () => {
        const params = new URLSearchParams(
            "q=robotics&fit=scored&minScore=75&intake=rolling&panel=notes"
        );
        const reset = updateDiscoveryParams(params, DEFAULT_DISCOVERY_FILTERS);
        expect(reset.toString()).toBe("panel=notes");
        const ranked = rankPrograms([view("Unknown"), view("Top", 75), view("Zero", 0)], "en");
        expect(ids(ranked, readDiscoveryFilters(reset))).toEqual(["Top", "Zero", "Unknown"]);
    });
});
