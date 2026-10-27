/**
 * The first segment, against a real database: drafted from the company
 * profile (its description and headquarters), and created from places typed
 * the way people write them. Gated like the other integration suites.
 */
import { company } from "@launchstack/store/schema";
import { configureDatabase } from "@launchstack/store/client";
import type { DbClient } from "@launchstack/store/client";
import { getProgram } from "@launchstack/pipelines/distribution/db";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

jest.mock("~/env", () => ({ env: { server: {}, client: {} } }));
// OpenStreetMap's geocoder, answering the way it does for these places.
const mockGeocoded: string[] = [];
jest.mock("@launchstack/pipelines/distribution/geocode", () => ({
    geocodePlace: async (text: string, options: { homeCountry?: string | null } = {}) => {
        mockGeocoded.push(text);
        const known: Record<string, { country: string; region?: string }> = {
            "Baltimore, Maryland, United States": { country: "US", region: "Baltimore" },
            "Baltimore, MD, USA": { country: "US", region: "Baltimore" },
            Netherlands: { country: "NL" },
            "Wilmington, DE": { country: "US", region: "Wilmington" },
        };
        if (text === "Austin")
            return options.homeCountry ? { country: options.homeCountry, region: "Austin" } : null;
        return known[text] ?? null;
    },
}));
let mockDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        return mockDb;
    },
}));

import { companyMetadata } from "~/server/db/schema";
import { createSegment, suggestSegment } from "~/server/prospects/service";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

const fact = (value: string) => ({
    value,
    visibility: "internal",
    usage: "outreach_ok",
    confidence: 0.9,
    priority: "primary",
    status: "active",
    last_updated: new Date().toISOString(),
    sources: [],
});

describeDb("segment setup", () => {
    jest.setTimeout(120_000);

    let testDb: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let withProfile: bigint;
    let bare: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        configureDatabase(testDb.db);
        mockDb = testDb.db;
        const rows = await testDb.db
            .insert(company)
            .values([
                {
                    name: "Ledgerly",
                    description: "Bookkeeping and payroll for independent restaurants",
                    numberOfEmployees: "5",
                },
                { name: "Blank Co", numberOfEmployees: "1" },
            ])
            .returning();
        withProfile = BigInt(rows[0]!.id);
        bare = BigInt(rows[1]!.id);
        await testDb.db.insert(companyMetadata).values({
            companyId: withProfile,
            metadata: {
                schema_version: "1.0.0",
                company: { headquarters: fact("Baltimore, Maryland, United States") },
            } as never,
        });
    }, 120_000);

    afterAll(async () => {
        await testDb?.close();
    });

    const ctx = (companyId: bigint) => ({ companyId, userId: "u1" }) as never;

    it("drafts what you sell and where from the profile, never who buys", async () => {
        const suggestion = await suggestSegment(ctx(withProfile));
        expect(suggestion).toEqual({
            offering: "Bookkeeping and payroll for independent restaurants",
            place: "Baltimore, United States",
            basis: { profile: true, headquarters: true },
        });
    });

    it("says it has nothing to draft from when the profile is empty", async () => {
        expect(await suggestSegment(ctx(bare))).toEqual({
            offering: "",
            place: null,
            basis: { profile: false, headquarters: false },
        });
    });

    it("creates a segment from places as people write them; a bare city is in the company's country", async () => {
        const segment = await createSegment(ctx(withProfile), {
            name: "Restaurants · Austin",
            offering: "Bookkeeping for restaurants",
            industries: ["restaurant"],
            places: ["Austin; Netherlands", "Baltimore, MD, USA"],
        });
        const program = await getProgram(segment.id, withProfile);
        expect(program?.targetTerritories).toEqual([
            { country: "US", region: "Austin" },
            { country: "NL" },
            { country: "US", region: "Baltimore" },
        ]);
        expect(mockGeocoded).toEqual(
            expect.arrayContaining(["Austin", "Netherlands", "Baltimore, MD, USA"])
        );
        // "Who buys" is what discovery and relevance search for.
        expect(program?.categories).toEqual(["restaurant"]);
    });

    it("reads a state code the way the geocoder does, not as a country", async () => {
        const segment = await createSegment(ctx(withProfile), {
            name: "Delaware",
            offering: "Bookkeeping for restaurants",
            industries: ["restaurant"],
            places: ["Wilmington, DE"],
        });
        const program = await getProgram(segment.id, withProfile);
        // Offline, "DE" would read as Germany.
        expect(program?.targetTerritories).toEqual([{ country: "US", region: "Wilmington" }]);
    });

    it("refuses a segment with nowhere to look", async () => {
        await expect(
            createSegment(ctx(bare), {
                name: "Nowhere",
                offering: "x",
                industries: ["y"],
                places: ["Austin"],
            })
        ).rejects.toMatchObject({ status: 400 });
    });
});
