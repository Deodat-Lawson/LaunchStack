/**
 * Property-based tests for Client Prospector shared types.
 * Feature: client-prospector
 */

import * as fc from "fast-check";
import {
    ProspectorInputSchema,
    ProspectorEventDataSchema,
    LatLngSchema,
} from "~/lib/tools/client-prospector/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validLatArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const validLngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

const validLatLngArb = fc.record({
    lat: validLatArb,
    lng: validLngArb,
});

const validQueryArb = fc
    .string({ minLength: 1, maxLength: 1000 })
    .filter((s) => s.trim().length > 0);

const validCompanyContextArb = fc
    .string({ minLength: 1, maxLength: 2000 })
    .filter((s) => s.trim().length > 0);

const validRadiusArb = fc.option(
    fc.integer({ min: 100, max: 50000 }),
    { nil: undefined },
);

const validCategoriesArb = fc.option(
    fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
        minLength: 1,
        maxLength: 5,
    }),
    { nil: undefined },
);

// ─── Property 12: Input serialization round-trip ──────────────────────────────
// **Validates: Requirements 8.1, 8.2**

describe("Feature: client-prospector, Property 12: Input serialization round-trip", () => {
    it("serializing ProspectorInput (with resolved LatLng) to JSON and deserializing with ProspectorEventDataSchema preserves all fields", () => {
        fc.assert(
            fc.property(
                validQueryArb,
                validCompanyContextArb,
                validLatLngArb,
                validRadiusArb,
                validCategoriesArb,
                fc.uuid(), // jobId
                fc.uuid(), // companyId (serialized as string)
                fc.uuid(), // userId
                (
                    query,
                    companyContext,
                    location,
                    radius,
                    categories,
                    jobId,
                    companyId,
                    userId,
                ) => {
                    const resolvedRadius = radius ?? 5000;

                    const eventPayload = {
                        jobId,
                        companyId,
                        userId,
                        query,
                        companyContext,
                        location,
                        radius: resolvedRadius,
                        ...(categories !== undefined && { categories }),
                    };

                    // Serialize to JSON and back
                    const serialized = JSON.stringify(eventPayload);
                    const deserialized = JSON.parse(serialized) as unknown;

                    // Validate with ProspectorEventDataSchema
                    const result =
                        ProspectorEventDataSchema.safeParse(deserialized);

                    expect(result.success).toBe(true);
                    if (!result.success) return;

                    // Verify all fields are preserved
                    expect(result.data.jobId).toBe(jobId);
                    expect(result.data.companyId).toBe(companyId);
                    expect(result.data.userId).toBe(userId);
                    expect(result.data.query).toBe(query);
                    expect(result.data.companyContext).toBe(companyContext);
                    // JSON.stringify(-0) produces "0", so compare against the JSON round-tripped location
                    const expectedLocation = JSON.parse(JSON.stringify(location)) as { lat: number; lng: number };
                    expect(result.data.location).toEqual(expectedLocation);
                    expect(result.data.radius).toBe(resolvedRadius);
                    expect(result.data.categories).toEqual(categories);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("ProspectorInputSchema fields survive round-trip through event payload", () => {
        fc.assert(
            fc.property(
                validQueryArb,
                validCompanyContextArb,
                validLatLngArb,
                validRadiusArb,
                validCategoriesArb,
                (query, companyContext, location, radius, categories) => {
                    const input = {
                        query,
                        companyContext,
                        location,
                        radius,
                        categories,
                    };

                    // Validate original input
                    const inputResult = ProspectorInputSchema.safeParse(input);
                    expect(inputResult.success).toBe(true);
                    if (!inputResult.success) return;

                    // Build event payload from input (location already resolved to LatLng)
                    const eventPayload = {
                        jobId: "test-job-id",
                        companyId: "123",
                        userId: "user-1",
                        query: inputResult.data.query,
                        companyContext: inputResult.data.companyContext,
                        location: inputResult.data.location as { lat: number; lng: number },
                        radius: inputResult.data.radius ?? 5000,
                        categories: inputResult.data.categories,
                    };

                    // Round-trip through JSON
                    const roundTripped = JSON.parse(
                        JSON.stringify(eventPayload),
                    ) as unknown;
                    const eventResult =
                        ProspectorEventDataSchema.safeParse(roundTripped);

                    expect(eventResult.success).toBe(true);
                    if (!eventResult.success) return;

                    // Core input fields must be identical after round-trip
                    expect(eventResult.data.query).toBe(query);
                    expect(eventResult.data.companyContext).toBe(companyContext);
                    const expectedLoc = JSON.parse(JSON.stringify(location)) as { lat: number; lng: number };
                    expect(eventResult.data.location).toEqual(expectedLoc);
                    expect(eventResult.data.categories).toEqual(categories);
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ─── Property 1: Valid input creates a job ────────────────────────────────────
// **Validates: Requirements 1.1, 1.4, 1.5, 1.7**

describe("Feature: client-prospector, Property 1: Valid input is accepted by ProspectorInputSchema", () => {
    it("any valid query, companyContext, and LatLng location passes validation", () => {
        fc.assert(
            fc.property(
                validQueryArb,
                validCompanyContextArb,
                validLatLngArb,
                validRadiusArb,
                validCategoriesArb,
                (query, companyContext, location, radius, categories) => {
                    const result = ProspectorInputSchema.safeParse({
                        query,
                        companyContext,
                        location,
                        radius,
                        categories,
                    });
                    expect(result.success).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("string location also passes validation", () => {
        fc.assert(
            fc.property(
                validQueryArb,
                validCompanyContextArb,
                fc.string({ minLength: 1, maxLength: 500 }),
                (query, companyContext, locationStr) => {
                    const result = ProspectorInputSchema.safeParse({
                        query,
                        companyContext,
                        location: locationStr,
                    });
                    expect(result.success).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ─── Property 2: Invalid input is rejected ────────────────────────────────────
// **Validates: Requirements 1.1, 1.4, 1.5, 1.7**

describe("Feature: client-prospector, Property 2: Invalid input is rejected by ProspectorInputSchema", () => {
    it("empty string query is rejected", () => {
        const result = ProspectorInputSchema.safeParse({
            query: "",
            companyContext: "valid context",
            location: { lat: 40.7, lng: -74.0 },
        });
        expect(result.success).toBe(false);
    });

    it("companyContext exceeding 2000 characters is rejected", () => {
        fc.assert(
            fc.property(
                validQueryArb,
                fc.string({ minLength: 2001, maxLength: 3000 }),
                validLatLngArb,
                (query, longContext, location) => {
                    const result = ProspectorInputSchema.safeParse({
                        query,
                        companyContext: longContext,
                        location,
                    });
                    expect(result.success).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    it("missing location is rejected", () => {
        fc.assert(
            fc.property(validQueryArb, validCompanyContextArb, (query, companyContext) => {
                const result = ProspectorInputSchema.safeParse({
                    query,
                    companyContext,
                });
                expect(result.success).toBe(false);
            }),
            { numRuns: 100 },
        );
    });

    it("query exceeding 1000 characters is rejected", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1001, maxLength: 1500 }),
                validCompanyContextArb,
                validLatLngArb,
                (longQuery, companyContext, location) => {
                    const result = ProspectorInputSchema.safeParse({
                        query: longQuery,
                        companyContext,
                        location,
                    });
                    expect(result.success).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });
});
