import {
    assertFrozenSources,
    assertSourcePurpose,
    sourceHash,
    createWeeklyReviewAuthority,
    type WeeklyReviewAuthorityActor,
} from "~/server/vantage/weekly-review-authority";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

describe("Weekly Review source authority", () => {
    it.each(["configuration", "preferences"] as const)(
        "rechecks %s capability after the authority-lock barrier",
        async kind => {
            let actor: WeeklyReviewAuthorityActor = {
                companyId: "1",
                userId: "u",
                role: "admin",
                canRead: true,
                canMutate: true,
                canConfigure: true,
                documentScope: { kind: "everything" },
            };
            let entered!: () => void, release!: () => void;
            const atLock = new Promise<void>(resolve => {
                entered = resolve;
            });
            const unlocked = new Promise<void>(resolve => {
                release = resolve;
            });
            const queries: string[] = [];
            const query: WeeklyReviewQuery = async text => {
                queries.push(text);
                if (text.includes("SELECT version")) {
                    entered();
                    await unlocked;
                    return [{ version: 2 }];
                }
                return [];
            };
            const authority = createWeeklyReviewAuthority(
                { transaction: work => work(query) },
                async () => actor
            );
            const validation =
                kind === "configuration"
                    ? authority.validateCompanySources(
                          query,
                          { companyId: "1", userId: "u" },
                          "31",
                          []
                      )
                    : authority.validatePreferenceSources(query, { companyId: "1", userId: "u" }, [
                          "31",
                      ]);
            await atLock;
            actor = {
                ...actor,
                role: kind === "configuration" ? "member" : "viewer",
                canConfigure: false,
                canMutate: kind === "configuration",
            };
            const assertion = expect(validation).rejects.toThrow(
                kind === "configuration" ? "review_configuration_denied" : "review_mutation_denied"
            );
            release();
            await assertion;
            expect(queries.some(text => text.includes("FROM pdr_ai_v2_document d"))).toBe(false);
        }
    );
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
