import { assertLocalDatabaseUrl, parseCollectEvidenceArgs } from "../../scripts/collect-founder-weekly-review-evidence.lib";

const BASE_ARGS = [
    "--company",
    "5",
    "--start",
    "2026-02-16",
    "--end",
    "2026-02-22",
    "--tz",
    "UTC",
];

describe("parseCollectEvidenceArgs", () => {
    it("parses the minimal required flags", () => {
        const input = parseCollectEvidenceArgs(BASE_ARGS);
        expect(input.companyId).toBe(5n);
        expect(input.reportingPeriod).toEqual({ start: "2026-02-16", end: "2026-02-22" });
        expect(input.workspaceTimezone).toBe("UTC");
        expect(input.founderContext).toBeUndefined();
        expect(input.actor).toBeUndefined();
        expect(input.contextEntryId).toBeUndefined();
        expect(input.out).toBeUndefined();
    });

    it("attaches founder context, actor, and a stable contextEntryId together", () => {
        const input = parseCollectEvidenceArgs([
            ...BASE_ARGS,
            "--founder-context",
            "Shipped billing v2",
            "--actor",
            "user_123",
            "--out",
            "snap.json",
        ]);
        expect(input.founderContext).toBe("Shipped billing v2");
        expect(input.actor).toEqual({ externalUserId: "user_123" });
        expect(input.contextEntryId).toBe("cli:5:2026-02-16:2026-02-22");
        expect(input.out).toBe("snap.json");
    });

    it("throws when --founder-context is given without --actor", () => {
        expect(() =>
            parseCollectEvidenceArgs([...BASE_ARGS, "--founder-context", "note"])
        ).toThrow(/--founder-context requires --actor/);
    });

    it.each([
        ["company", ["--start", "2026-02-16", "--end", "2026-02-22", "--tz", "UTC"]],
        ["start", ["--company", "5", "--end", "2026-02-22", "--tz", "UTC"]],
        ["end", ["--company", "5", "--start", "2026-02-16", "--tz", "UTC"]],
        ["tz", ["--company", "5", "--start", "2026-02-16", "--end", "2026-02-22"]],
    ])("throws when required flag --%s is missing", (flag, args) => {
        expect(() => parseCollectEvidenceArgs(args)).toThrow(
            new RegExp(`Missing required flag --${flag}`)
        );
    });

    it("rejects a non-integer company id", () => {
        expect(() =>
            parseCollectEvidenceArgs(["--company", "abc", "--start", "2026-02-16", "--end", "2026-02-22", "--tz", "UTC"])
        ).toThrow(/must be an integer company id/);
    });

    it("rejects a non-positive company id", () => {
        expect(() =>
            parseCollectEvidenceArgs(["--company", "0", "--start", "2026-02-16", "--end", "2026-02-22", "--tz", "UTC"])
        ).toThrow(/must be a positive company id/);
    });

    it("rejects a malformed date shape", () => {
        expect(() =>
            parseCollectEvidenceArgs(["--company", "5", "--start", "2026/02/16", "--end", "2026-02-22", "--tz", "UTC"])
        ).toThrow(/must be a YYYY-MM-DD date/);
    });

    it("rejects a shaped-but-impossible calendar date", () => {
        expect(() =>
            parseCollectEvidenceArgs(["--company", "5", "--start", "2026-02-30", "--end", "2026-03-05", "--tz", "UTC"])
        ).toThrow(/must be a real calendar date/);
    });

    it("allows start equal to end (single-day period)", () => {
        const input = parseCollectEvidenceArgs([
            "--company", "5", "--start", "2026-02-16", "--end", "2026-02-16", "--tz", "UTC",
        ]);
        expect(input.reportingPeriod).toEqual({ start: "2026-02-16", end: "2026-02-16" });
    });

    it("throws when start is after end", () => {
        expect(() =>
            parseCollectEvidenceArgs(["--company", "5", "--start", "2026-02-22", "--end", "2026-02-16", "--tz", "UTC"])
        ).toThrow(/must be before or the same as/);
    });
});

describe("assertLocalDatabaseUrl", () => {
    it("accepts a localhost url", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgresql://user:pass@localhost:5433/launchstack")
        ).not.toThrow();
    });

    it("accepts a 127.0.0.1 url", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgres://127.0.0.1:5432/db")
        ).not.toThrow();
    });

    it("rejects a remote (non-local) url", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgresql://user:pass@ep-fake.neon.tech/db")
        ).toThrow(/non-local database/);
    });

    it("rejects when NODE_ENV is production, even for a local db url", () => {
        const env = process.env as Record<string, string | undefined>;
        const previous = env.NODE_ENV;
        env.NODE_ENV = "production";
        try {
            expect(() =>
                assertLocalDatabaseUrl("postgresql://localhost:5433/db")
            ).toThrow(/NODE_ENV=production/);
        } finally {
            if (previous === undefined) {
                delete env.NODE_ENV;
            } else {
                env.NODE_ENV = previous;
            }
        }
    });
});
