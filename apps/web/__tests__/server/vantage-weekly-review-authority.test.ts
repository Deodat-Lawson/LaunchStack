import {
    assertFrozenSources,
    assertSourcePurpose,
    sourceHash,
    createWeeklyReviewAuthority,
} from "~/server/vantage/weekly-review-authority";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

describe("Weekly Review source authority", () => {
    it("never promotes an actor-readable personal star into company policy", () => {
        expect(() =>
            assertSourcePurpose({
                purpose: "personal-star",
                readable: true,
                companyReadable: false,
            })
        ).not.toThrow();
        expect(() =>
            assertSourcePurpose({
                purpose: "workspace-required",
                readable: true,
                companyReadable: false,
            })
        ).toThrow("required_context_audience");
        expect(() =>
            assertSourcePurpose({
                purpose: "personal-star",
                readable: false,
                companyReadable: false,
            })
        ).toThrow("source_access_denied");
    });
    it("reauthorizes exact frozen versions without requiring latest document heads", () => {
        const frozen = {
            kind: "document" as const,
            id: "31",
            version: "7",
            hash: sourceHash("original"),
            purpose: "retrieved" as const,
        };
        expect(() =>
            assertFrozenSources(
                [frozen],
                [{ ...frozen }, { ...frozen, version: "8", hash: sourceHash("new") }]
            )
        ).not.toThrow();
        expect(() =>
            assertFrozenSources([frozen], [{ ...frozen, hash: sourceHash("mutated") }])
        ).toThrow("source_authority_changed");
        expect(() => assertFrozenSources([frozen], [])).toThrow("source_authority_changed");
    });
    it("fails closed when dispatch has no captured authority epoch", async () => {
        const query: WeeklyReviewQuery = async text =>
            text.includes("SELECT version") ? [{ version: 8 }] : [];
        const authority = createWeeklyReviewAuthority(
            { transaction: work => work(query) },
            async () => ({
                companyId: "1",
                userId: "u",
                role: "member",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" },
            })
        );
        await expect(
            authority.assertCurrentWeeklyReviewAuthority(
                query,
                { companyId: "1", userId: "u" },
                [],
                "dispatch"
            )
        ).rejects.toThrow("source_authority_changed");
        await expect(
            authority.assertCurrentWeeklyReviewAuthority(
                query,
                { companyId: "1", userId: "u", authorityEpoch: "7" },
                [],
                "activation"
            )
        ).rejects.toThrow("source_authority_changed");
    });
    it("re-resolves the actor instead of trusting a preparing actor", async () => {
        const query: WeeklyReviewQuery = async text =>
            text.includes("SELECT version") ? [{ version: 1 }] : [];
        const authority = createWeeklyReviewAuthority(
            { transaction: work => work(query) },
            async () => ({
                companyId: "2",
                userId: "u",
                role: "member",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" },
            })
        );
        await expect(
            authority.assertCurrentWeeklyReviewAuthority(
                query,
                { companyId: "1", userId: "u", authorityEpoch: "1" },
                [],
                "dispatch"
            )
        ).rejects.toThrow("review_access_denied");
    });
});
