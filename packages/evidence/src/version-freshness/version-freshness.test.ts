import { describe, expect, it } from "vitest";

import {
    computeFreshness,
    DEFAULT_FRESHNESS_POLICY,
    isValidFreshnessPolicy,
    type FreshnessPolicy,
} from "../index";

const policy: FreshnessPolicy = { freshWithinDays: 30, staleAfterDays: 180 };
const now = "2026-08-09T00:00:00.000Z";

const daysBefore = (iso: string, days: number): string =>
    new Date(Date.parse(iso) - days * 86_400_000).toISOString();

describe("computeFreshness", () => {
    it("classifies the three tiers", () => {
        expect(computeFreshness(daysBefore(now, 1), now, policy)).toBe("fresh");
        expect(computeFreshness(daysBefore(now, 90), now, policy)).toBe("aging");
        expect(computeFreshness(daysBefore(now, 365), now, policy)).toBe("stale");
    });

    it("is fresh exactly at freshWithinDays and aging just past it", () => {
        expect(computeFreshness(daysBefore(now, 30), now, policy)).toBe("fresh");
        expect(
            computeFreshness(
                new Date(Date.parse(daysBefore(now, 30)) - 1).toISOString(),
                now,
                policy
            )
        ).toBe("aging");
    });

    it("is aging exactly at staleAfterDays and stale just past it", () => {
        expect(computeFreshness(daysBefore(now, 180), now, policy)).toBe("aging");
        expect(
            computeFreshness(
                new Date(Date.parse(daysBefore(now, 180)) - 1).toISOString(),
                now,
                policy
            )
        ).toBe("stale");
    });

    it("treats a future lastUpdatedAt as fresh", () => {
        expect(computeFreshness(daysBefore(now, -5), now, policy)).toBe("fresh");
    });

    it("throws on an invalid policy", () => {
        expect(() =>
            computeFreshness(now, now, { freshWithinDays: 180, staleAfterDays: 30 })
        ).toThrow(RangeError);
        expect(() =>
            computeFreshness(now, now, { freshWithinDays: 30, staleAfterDays: 30 })
        ).toThrow(RangeError);
        expect(() =>
            computeFreshness(now, now, { freshWithinDays: -1, staleAfterDays: 30 })
        ).toThrow(RangeError);
    });

    it("throws on unparseable timestamps", () => {
        expect(() => computeFreshness("not-a-date", now, policy)).toThrow(RangeError);
        expect(() => computeFreshness(now, "not-a-date", policy)).toThrow(RangeError);
    });
});

describe("freshness policy", () => {
    it("ships a 30/180 default that callers may override", () => {
        expect(DEFAULT_FRESHNESS_POLICY).toEqual({
            freshWithinDays: 30,
            staleAfterDays: 180,
        });
        expect(isValidFreshnessPolicy(DEFAULT_FRESHNESS_POLICY)).toBe(true);
    });

    it("validates ordering and finiteness", () => {
        expect(isValidFreshnessPolicy({ freshWithinDays: 0, staleAfterDays: 1 })).toBe(true);
        expect(isValidFreshnessPolicy({ freshWithinDays: 5, staleAfterDays: 5 })).toBe(false);
        expect(
            isValidFreshnessPolicy({
                freshWithinDays: 5,
                staleAfterDays: Number.POSITIVE_INFINITY,
            })
        ).toBe(false);
    });
});
