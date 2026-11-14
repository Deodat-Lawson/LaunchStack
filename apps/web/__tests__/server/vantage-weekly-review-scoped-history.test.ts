import { hashScopedText } from "@launchstack/pipelines/vantage/scoped-evidence";
import {
    createWeeklyReviewAuthority,
    assertSourcePurpose,
} from "~/server/vantage/weekly-review-authority";
import { boundedInternalQuery } from "~/server/vantage/weekly-review-internal-selection";
import { createScopedSourceReader } from "~/server/vantage/weekly-review-scoped-selection";
import type { SourcePurpose, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

function fixture(restricted: boolean, purpose: SourcePurpose = "personal-star") {
    const actor = {
        companyId: "1",
        userId: "u",
        role: "admin",
        canRead: true,
        canMutate: true,
        documentScope: { kind: "everything" as const },
    };
    const state = {
        restricted,
        denied: false,
        text: "selected evidence\noutside evidence",
        chunkId: "9",
        epoch: "1",
    };
    const scope = {
        version: "7",
        expectedParentHash: hashScopedText(state.text),
        qualification: "Configured evidence",
        requiredUnits: [
            {
                id: "selected",
                start: 0,
                end: 17,
                excerptHash: hashScopedText(state.text.slice(0, 17)),
            },
        ],
    };
    const query: WeeklyReviewQuery = async text => {
        if (text.includes("SELECT version")) return [{ version: state.epoch }];
        if (text.includes("FROM pdr_ai_v2_document d"))
            return [
                {
                    id: "31",
                    title: "Evidence",
                    category: "Shared",
                    version_id: "7",
                    version_created_at: "2026-11-01T00:00:00.000Z",
                },
            ];
        if (text.includes("document_settings")) return state.restricted ? [{ restricted: 1 }] : [];
        if (text.includes("AS chunk_count"))
            return [{ chunk_count: 1, text_bytes: Buffer.byteLength(state.text) }];
        if (text.includes("bounded_scoped_chunks"))
            return [{ id: state.chunkId, content: state.text }];
        return [];
    };
    const authority = createWeeklyReviewAuthority(
        { transaction: work => work(query) },
        async () => ({
            ...actor,
            documentScope: state.denied
                ? {
                      kind: "only" as const,
                      allowedCategories: [],
                      deniedDocumentIds: [],
                      allowedDocumentIds: [],
                  }
                : actor.documentScope,
        }),
        { internalRetrievalV1: true, scopedEvidenceV2: true }
    );
    const capture = () =>
        createScopedSourceReader(
            query,
            actor,
            boundedInternalQuery(query).acquisition,
            assertSourcePurpose,
            state.epoch
        )("31", purpose, "2026-11-13T12:00:00.000Z", scope, "scope-1");
    return { actor, state, query, authority, capture };
}

describe("scoped historical authority", () => {
    it.each([false, true])(
        "preserves frozen identity after restricted=%s changes with continued access",
        async restricted => {
            const f = fixture(restricted);
            const captured = await f.capture();
            const frozen = JSON.stringify(captured.dependency);
            f.state.restricted = !restricted;
            for (const phase of ["read", "decision"] as const) {
                await expect(
                    f.authority.assertCurrentWeeklyReviewAuthority(
                        f.query,
                        f.actor,
                        [captured.dependency],
                        phase
                    )
                ).resolves.toBeUndefined();
            }
            expect(JSON.stringify(captured.dependency)).toBe(frozen);
            for (const phase of ["dispatch", "activation"] as const) {
                await expect(
                    f.authority.assertCurrentWeeklyReviewAuthority(
                        f.query,
                        { ...f.actor, authorityEpoch: "1" },
                        [captured.dependency],
                        phase
                    )
                ).rejects.toThrow("source_authority_changed");
            }
            f.state.denied = true;
            for (const phase of ["read", "decision"] as const) {
                await expect(
                    f.authority.assertCurrentWeeklyReviewAuthority(
                        f.query,
                        f.actor,
                        [captured.dependency],
                        phase
                    )
                ).rejects.toThrow("source_access_denied");
            }
        }
    );

    it.each(["company-architecture", "workspace-required"] as const)(
        "rechecks current company audience for %s",
        async purpose => {
            const f = fixture(false, purpose);
            const captured = await f.capture();
            f.state.restricted = true;
            for (const phase of ["read", "decision"] as const) {
                await expect(
                    f.authority.assertCurrentWeeklyReviewAuthority(
                        f.query,
                        f.actor,
                        [captured.dependency],
                        phase
                    )
                ).rejects.toThrow("required_context_audience");
            }
        }
    );

    it.each(["parent", "anchor"])("still rejects changed %s identity", async kind => {
        const f = fixture(false);
        const captured = await f.capture();
        f.state.restricted = true;
        if (kind === "parent") f.state.text += " changed outside selected span";
        else f.state.chunkId = "10";
        await expect(
            f.authority.assertCurrentWeeklyReviewAuthority(
                f.query,
                f.actor,
                [captured.dependency],
                "read"
            )
        ).rejects.toThrow("source_authority_changed");
    });
});
