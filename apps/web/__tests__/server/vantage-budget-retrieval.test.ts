import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
    createWeeklyReviewAuthority,
    sourceHash,
    type WeeklyReviewAuthorityActor,
} from "~/server/vantage/weekly-review-authority";
import { calculateWeeklyReviewBudget } from "@launchstack/pipelines/vantage/weekly-review-v21";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

const fixturePath = path.join(__dirname, "fixtures/vantage-budget-orbit-v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
type Version = { id: string; createdAt: string; text: string; sha256?: string; chunks?: string[] };
type Doc = {
    id: string;
    key: string;
    title: string;
    category: string;
    audience: string;
    expectedReadability: string;
    updatedAt: string;
    versions: Version[];
};
const identity = {
    candidateId: "11111111-1111-4111-8111-111111111111",
    asOf: "2026-11-09T12:00:00.000Z",
};
const week = "2026-10-19";
function document(id: number, text = "Evidence.", date = "2026-10-23T00:00:00Z"): Doc {
    return {
        id: String(id),
        key: `synthetic-${id}`,
        title: `Document ${id}`,
        category: "Shared",
        audience: "company",
        expectedReadability: "readable",
        updatedAt: date,
        versions: [{ id: String(id + 1000), createdAt: date, text }],
    };
}

// A relational fixture adapter: versions are filtered/sorted by timestamps,
// ACL is evaluated by the production scope resolver, and every unrecognized
// query fails. SQL predicates and bounded acquisition are asserted separately.
function setup(
    docs: Doc[],
    required: string[] = [],
    stars: string[] = [],
    architecture = docs[0]!.id
) {
    const calls: { text: string; params: unknown[] }[] = [];
    const denied = docs.filter(d => d.expectedReadability !== "readable").map(d => Number(d.id));
    const actor: WeeklyReviewAuthorityActor = {
        companyId: "1",
        userId: "synthetic-reader",
        role: "member",
        canRead: true,
        canMutate: true,
        documentScope: {
            kind: "except",
            deniedCategories: [],
            deniedDocumentIds: denied,
            allowedDocumentIds: [],
        },
    };
    const query: WeeklyReviewQuery = async (text, params = []) => {
        calls.push({ text, params });
        if (
            text.includes("set_config") ||
            text.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs")
        )
            return [];
        if (text.includes("SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs"))
            return [{ version: 1 }];
        if (text.includes("FROM pdr_ai_v2_vantage_weekly_review_policy"))
            return [{ architecture_document_id: architecture, required_document_ids: required }];
        if (text.includes("FROM pdr_ai_v2_vantage_weekly_review_preferences"))
            return [{ star_document_ids: stars, version: 1 }];
        if (text.includes("FROM pdr_ai_v2_document_settings"))
            return docs.find(d => d.id === String(params[0]))?.audience === "company"
                ? []
                : [{ restricted: 1 }];
        if (text.includes("pdr_ai_v2_document_context_chunks")) {
            const d = docs.find(d => d.id === String(params[0]));
            const v = d?.versions.find(v => v.id === String(params[1]));
            if (!v) return [];
            const chunks = v.chunks ?? [v.text];
            const probe = text.includes("LIMIT 129") ? chunks.slice(0, 129) : chunks;
            const joined = probe.join("\n");
            if (text.includes("count(") || text.includes("COUNT("))
                return [
                    {
                        chunk_count: probe.length,
                        text_bytes: Buffer.byteLength(joined),
                        text_chars: joined.length,
                    },
                ];
            return probe.map(content => ({ content }));
        }
        if (text.includes("FROM pdr_ai_v2_document")) {
            expect(params[0]).toBe(actor.companyId);
            const lateral = text.includes("LATERAL");
            const cutoff = params.find(p => typeof p === "string" && /^2026-.*T/.test(p)) as
                | string
                | undefined;
            const row = (d: Doc) => {
                const exact =
                    text.includes("d.id=$2::bigint") && typeof params[2] === "string"
                        ? params[2]
                        : null;
                const v = [...d.versions]
                    .filter(v =>
                        exact
                            ? v.id === exact
                            : !cutoff || new Date(v.createdAt) <= new Date(cutoff)
                    )
                    .sort(
                        (a, b) =>
                            b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id)
                    )[0];
                return {
                    id: d.id,
                    title:
                        lateral &&
                        text.includes("octet_length(d.title)") &&
                        Buffer.byteLength(d.title) > 1024
                            ? null
                            : d.title,
                    category: d.category,
                    version_id: v?.id ?? null,
                    version_created_at: v?.createdAt ?? null,
                };
            };
            if (text.includes("d.id=$2::bigint"))
                return docs
                    .filter(d => d.id === String(params[1]))
                    .map(row)
                    .filter(r => lateral || r.version_id);
            if (lateral) {
                expect(text).toMatch(/created_at\s*<=/);
                expect(text).toMatch(/company_id\s*=\s*\$1/);
                expect(text).toMatch(/LIMIT\s+(?:64|\$\d+)/i);
                const excluded = params.find(Array.isArray) as string[] | undefined;
                return docs
                    .filter(d => !excluded?.includes(d.id))
                    .map(row)
                    .sort(
                        (a, b) =>
                            (a.version_created_at === null
                                ? 1
                                : b.version_created_at === null
                                  ? -1
                                  : String(b.version_created_at).localeCompare(
                                        String(a.version_created_at)
                                    )) || Number(b.id) - Number(a.id)
                    )
                    .slice(0, 64);
            }
            return [...docs]
                .sort(
                    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || Number(b.id) - Number(a.id)
                )
                .slice(0, 20)
                .map(d => ({ id: d.id }));
        }
        throw new Error("Unexpected SQL: " + text);
    };
    return {
        actor,
        calls,
        query,
        authority: (flag?: boolean) =>
            createWeeklyReviewAuthority(
                { transaction: work => work(query) },
                async () => actor,
                flag === undefined ? undefined : { internalRetrievalV1: flag }
            ),
    };
}

describe("budget-aware internal selection acceptance (offline, no providers)", () => {
    it("freezes all 28 original synthetic documents without changing source text or labels", () => {
        expect(fixture.documents).toHaveLength(28);
        for (const d of fixture.documents)
            for (const v of d.versions)
                expect(createHash("sha256").update(v.text).digest("hex")).toBe(v.sha256);
        expect(fixture.provenance.noSemanticLabelsAdded).toBe(true);
        expect(fixture).not.toHaveProperty("userId");
        expect(fixture).not.toHaveProperty("companyId");
    });
    it("keeps omitted feature configuration byte-equivalent to explicit false", async () => {
        const s = setup([document(1), document(2)]);
        const implicit = await s.authority().collectWeeklyReviewContext(s.actor, week, identity);
        const explicit = await s
            .authority(false)
            .collectWeeklyReviewContext(s.actor, week, identity);
        expect(explicit).toEqual(implicit);
        expect(implicit).not.toHaveProperty("selectionDiagnostics");
    });
    it("skips an individually valid oversized optional and still admits a later small source", async () => {
        const s = setup([
            document(1, "a".repeat(3000)),
            document(3, "x".repeat(5000), "2026-10-25T00:00:00Z"),
            document(2, "Small useful evidence."),
        ]);
        const result = await s.authority(true).collectWeeklyReviewContext(s.actor, week, identity);
        expect(result.sources.map(s => s.id)).toEqual(["1", "2"]);
        expect(result.selectionDiagnostics!.omitted).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "3", reason: "budget_exceeded" }),
            ])
        );
    });
    it.each(["required", "star"])(
        "fails aggregate %s overflow during collection before dispatch is possible",
        async kind => {
            const s = setup(
                [document(1, "a".repeat(4000)), document(2, "b".repeat(4000))],
                kind === "required" ? ["2"] : [],
                kind === "star" ? ["2"] : []
            );
            await expect(
                s.authority(true).collectWeeklyReviewContext(s.actor, week, identity)
            ).rejects.toThrow("mandatory_context_budget_exceeded");
        }
    );
    it.each(["company", "preferences"] as const)(
        "validates pending %s configuration against required sources and actor stars together",
        async kind => {
            const docs = [
                document(1),
                document(2, "r".repeat(4000)),
                document(3, "s".repeat(4000)),
            ];
            // Company update adds required 2 to persisted star 3; preference update
            // adds star 3 to persisted required 2. Each edited subset fits alone.
            const s = setup(
                docs,
                kind === "preferences" ? ["2"] : [],
                kind === "company" ? ["3"] : []
            );
            s.actor.canConfigure = true;
            const legacy = s.authority(false);
            const bounded = s.authority(true);
            const validate = (authority: typeof legacy) =>
                kind === "company"
                    ? authority.validateCompanySources(s.query, s.actor, "1", ["2"])
                    : authority.validatePreferenceSources(s.query, s.actor, ["3"]);
            await expect(validate(legacy)).resolves.toHaveLength(kind === "company" ? 2 : 1);
            s.calls.length = 0;
            await expect(validate(bounded)).rejects.toThrow("mandatory_context_budget_exceeded");
            const readIds = s.calls
                .filter(c => c.text.includes("FROM pdr_ai_v2_document d"))
                .map(c => c.params[1]);
            expect(readIds).toEqual(["1", "2", "3"]);
            expect(s.calls.some(c => c.text.includes("FOR UPDATE"))).toBe(true);
        }
    );
    it.each(["company", "preferences"] as const)(
        "rechecks fresh %s configuration capability after the epoch barrier",
        async kind => {
            const s = setup([document(1), document(2)]);
            s.actor.canConfigure = true;
            const preparingActor = { ...s.actor };
            const query: WeeklyReviewQuery = async (text, params) => {
                const rows = await s.query(text, params);
                if (text.includes("SELECT version FROM")) {
                    s.actor.canConfigure = false;
                    s.actor.canMutate = false;
                }
                return rows;
            };
            const authority = createWeeklyReviewAuthority(
                { transaction: work => work(query) },
                async () => s.actor,
                { internalRetrievalV1: true }
            );
            const pending =
                kind === "company"
                    ? authority.validateCompanySources(query, preparingActor, "1", ["2"])
                    : authority.validatePreferenceSources(query, preparingActor, ["2"]);
            await expect(pending).rejects.toThrow(
                kind === "company" ? "review_configuration_denied" : "review_mutation_denied"
            );
            expect(
                s.calls.some(
                    c =>
                        c.text.includes("weekly_review_policy") ||
                        c.text.includes("FROM pdr_ai_v2_document d")
                )
            ).toBe(false);
        }
    );
    it("distinguishes authorized temporal unavailability from denied access without leaking denied metadata", async () => {
        const secret = {
            ...document(3, "PRIVATE BODY"),
            title: "PRIVATE TITLE",
            expectedReadability: "denied",
        };
        const future = document(2, "Future body.", "2026-11-01T00:00:00Z");
        const s = setup([document(1), future, secret]);
        const result = await s.authority(true).collectWeeklyReviewContext(s.actor, week, identity);
        expect(result.selectionDiagnostics!.deniedCount).toBe(1);
        expect(result.selectionDiagnostics!.omitted).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "2",
                    reason: "source_version_unavailable",
                    temporalEligibility: "unavailable",
                }),
            ])
        );
        expect(result.sources.map(s => s.id)).toEqual(["1"]);
        const safe = JSON.stringify(result);
        expect(safe).not.toContain("PRIVATE");
        expect(result.selectionDiagnostics!.omitted.some(o => o.id === "3")).toBe(false);
        expect(
            s.calls
                .filter(c => c.text.includes("document_context_chunks"))
                .every(c => c.params[0] !== "3")
        ).toBe(true);
        const required = setup([document(1), future], ["2"]);
        await expect(
            required.authority(true).collectWeeklyReviewContext(required.actor, week, identity)
        ).rejects.toThrow("source_version_unavailable");
    });
    it("uses inclusive cutoff versions even when post-cutoff current heads dominate recent documents", async () => {
        const historical = document(2, "At cutoff.", "2026-10-26T00:00:00.000Z");
        historical.updatedAt = "2026-11-05T00:00:00Z";
        historical.versions.push({
            id: "9000",
            createdAt: "2026-11-05T00:00:00Z",
            text: "POST CUTOFF BODY",
        });
        const futures = Array.from({ length: 25 }, (_, i) =>
            document(i + 10, "POST CUTOFF BODY", "2026-11-06T00:00:00Z")
        );
        const s = setup([document(1), historical, ...futures]);
        const before = await s.authority(false).collectWeeklyReviewContext(s.actor, week, identity);
        const after = await s.authority(true).collectWeeklyReviewContext(s.actor, week, identity);
        expect(before.sources.map(s => s.id)).not.toContain("2");
        expect(after.sources.find(s => s.id === "2")).toMatchObject({
            version: "1002",
            text: "At cutoff.",
        });
        expect(JSON.stringify(after)).not.toContain("POST CUTOFF BODY");
        for (const call of s.calls.filter(
            c =>
                c.text.includes("bounded_chunks") ||
                (c.text.includes("document_context_chunks") && c.text.includes("LIMIT"))
        ))
            expect(call.text).toMatch(/LIMIT 129/);
    });
    it("finishes the full 64-readable-candidate scan within the query envelope", async () => {
        const s = setup(Array.from({ length: 65 }, (_, i) => document(i + 1, "x")));
        const context = await s.authority(true).collectWeeklyReviewContext(s.actor, week, identity);
        expect(context.sources).toHaveLength(16);
        expect(context.selectionDiagnostics!.omitted).toHaveLength(49);
        expect(context.selectionDiagnostics!.acquisition.queryCount).toBeLessThanOrEqual(768);
        expect(context.selectionDiagnostics!.acquisition.queryCount).toBe(s.calls.length);
        expect(context.selectionDiagnostics!.acquisition.loadedTextBytes).toBe(65);
        expect(context.selectionDiagnostics!.deniedCount).toBe(0);
    });
    it("releases the transaction at the actor-loader deadline even if the loader never resolves", async () => {
        jest.useFakeTimers();
        try {
            const s = setup([document(1)]);
            let released = false;
            const loadActor = jest.fn(() => new Promise<WeeklyReviewAuthorityActor>(() => {}));
            const authority = createWeeklyReviewAuthority(
                {
                    transaction: async work => {
                        try {
                            return await work(s.query);
                        } finally {
                            released = true;
                        }
                    },
                },
                loadActor,
                { internalRetrievalV1: true }
            );
            const pending = authority.collectWeeklyReviewContext(s.actor, week, identity);
            const rejected = expect(pending).rejects.toThrow("retrieval_acquisition_timeout");
            await jest.advanceTimersByTimeAsync(0);
            expect(loadActor).toHaveBeenCalledTimes(1);
            expect(released).toBe(false);
            await jest.advanceTimersByTimeAsync(2999);
            expect(released).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            await rejected;
            expect(released).toBe(true);
            expect(jest.getTimerCount()).toBe(0);
            expect(s.calls.some(c => c.text.includes("weekly_review_policy"))).toBe(false);
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });
    it.each(["129 chunks", "long title"])(
        "keeps historical %s readable while new preparation rejects acquisition limits",
        async kind => {
            const old = document(1, "x");
            if (kind === "129 chunks") {
                old.versions[0]!.chunks = Array(129).fill("x");
                old.versions[0]!.text = old.versions[0]!.chunks.join("\n");
            } else old.title = "t".repeat(1025);
            const s = setup([old]);
            const dependency = {
                kind: "document" as const,
                id: old.id,
                version: old.versions[0]!.id,
                hash: sourceHash(old.versions[0]!.text),
                purpose: "company-architecture" as const,
            };
            await expect(
                s
                    .authority(true)
                    .assertCurrentWeeklyReviewAuthority(s.query, s.actor, [dependency], "read")
            ).resolves.toBeUndefined();
            expect(
                s.calls.some(
                    c => c.text.includes("set_config") || c.text.includes("bounded_chunks")
                )
            ).toBe(false);
            s.calls.length = 0;
            await expect(
                s
                    .authority(true)
                    .assertCurrentWeeklyReviewAuthority(s.query, s.actor, [dependency], "prepare")
            ).rejects.toThrow("source_context_unavailable");
            expect(s.calls.some(c => c.text.includes("set_config"))).toBe(true);
            if (kind === "129 chunks") {
                expect(s.calls.some(c => c.text.includes("bounded_chunks"))).toBe(true);
                expect(s.calls.some(c => c.text.startsWith("SELECT content FROM"))).toBe(false);
            }
        }
    );
    it("records lower-ranked eligible omissions after the source-count cap", async () => {
        const s = setup(Array.from({ length: 20 }, (_, i) => document(i + 1)));
        const result = await s.authority(true).collectWeeklyReviewContext(s.actor, week, identity);
        expect(result.sources).toHaveLength(16);
        expect(result.selectionDiagnostics!.omitted).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    reason: "ranked_lower",
                    temporalEligibility: "eligible",
                }),
            ])
        );
    });
    it("replays the unchanged trial corpus and optionally records a bounded before/after comparison", async () => {
        const docs = fixture.documents as Doc[];
        const byKey = new Map(docs.map(d => [d.key, d.id]));
        const s = setup(
            docs,
            fixture.contextPlan.requiredKeys.map((k: string) => byKey.get(k)!),
            fixture.contextPlan.starredKeys.map((k: string) => byKey.get(k)!),
            byKey.get(fixture.contextPlan.architectureKey)
        );
        s.actor.role = fixture.replayInput.role;
        const replayIdentity = {
            candidateId: fixture.replayInput.candidateId,
            asOf: fixture.replayInput.asOf,
        };
        const before = await s
            .authority(false)
            .collectWeeklyReviewContext(s.actor, week, replayIdentity);
        const after = await s
            .authority(true)
            .collectWeeklyReviewContext(s.actor, week, replayIdentity);
        expect(after.mandatoryCoverage).toEqual({ required: 6, included: 6 });
        expect(after.sources.length).toBeLessThanOrEqual(16);
        expect(after.selectionDiagnostics).toMatchObject({
            schemaVersion: "vantage-internal-selection/v1",
            cutoff: "2026-10-26T00:00:00.000Z",
            budget: { feasible: true },
        });
        expect(
            after.sources.every(
                source => docs.find(d => d.id === source.id)?.expectedReadability === "readable"
            )
        ).toBe(true);
        const input = (context: typeof before) => ({
            ...replayIdentity,
            week,
            role: context.role,
            mandatoryCoverage: context.mandatoryCoverage,
            sources: context.sources,
        });
        const reservedIds = before.sources
            .filter(source => source.purpose !== "retrieved")
            .map(source => source.id);
        expect(reservedIds).toHaveLength(10);
        const capacityVariants = [];
        for (const addedAsciiBytes of [722, 723, 2600, 2601]) {
            const variantDocs = docs.map(d => ({
                ...d,
                versions: d.versions.map(v => ({ ...v })),
            }));
            const target = variantDocs
                .find(d => d.id === "100")!
                .versions.find(v => v.id === "107")!;
            target.text += "x".repeat(addedAsciiBytes);
            const variant = setup(
                variantDocs,
                fixture.contextPlan.requiredKeys.map((k: string) => byKey.get(k)!),
                fixture.contextPlan.starredKeys.map((k: string) => byKey.get(k)!),
                byKey.get(fixture.contextPlan.architectureKey)
            );
            variant.actor.role = fixture.replayInput.role;
            const legacy = await variant
                .authority(false)
                .collectWeeklyReviewContext(variant.actor, week, replayIdentity);
            const selected = await variant
                .authority(true)
                .collectWeeklyReviewContext(variant.actor, week, replayIdentity);
            const legacyBudget = calculateWeeklyReviewBudget(input(legacy));
            const internalBudget = calculateWeeklyReviewBudget(input(selected), "internal-v1");
            expect(legacy.sources.map(source => source.ref)).toEqual(
                before.sources.map(source => source.ref)
            );
            expect(legacyBudget.inputBytes).toBe(8084 + addedAsciiBytes);
            expect(internalBudget.feasible).toBe(true);
            expect(internalBudget.reportReserveBytes).toBeGreaterThanOrEqual(2800);
            expect(internalBudget.maxReportBytes).toBeGreaterThanOrEqual(2800);
            expect(
                selected.sources
                    .filter(source => source.purpose !== "retrieved")
                    .map(source => source.id)
            ).toEqual(reservedIds);
            expect(selected.mandatoryCoverage).toEqual({ required: 6, included: 6 });
            expect(selected.selectionDiagnostics!.selected).toHaveLength(selected.sources.length);
            expect(selected.sources.length).toBeLessThanOrEqual(16);
            const omitted = selected.selectionDiagnostics!.omitted;
            expect(
                selected.sources.length +
                    omitted.length +
                    selected.selectionDiagnostics!.deniedCount
            ).toBe(28);
            capacityVariants.push({
                addedAsciiBytes,
                mutatedSource: {
                    id: "100",
                    version: "107",
                    mutation: "append ASCII x to cloned text only; fixture unchanged",
                },
                evidence:
                    "offline structural capacity only; no Generation, Judge or semantic claim",
                before: {
                    selectedCount: legacy.sources.length,
                    selected: legacy.sources.map(source => ({
                        id: source.id,
                        version: source.version,
                        purpose: source.purpose,
                    })),
                    budget: legacyBudget,
                },
                after: {
                    selectedCount: selected.sources.length,
                    omittedCount: omitted.length,
                    deniedCount: selected.selectionDiagnostics!.deniedCount,
                    reservedCount: reservedIds.length,
                    selected: selected.selectionDiagnostics!.selected,
                    omitted,
                    budget: internalBudget,
                    mandatoryCoverage: selected.mandatoryCoverage,
                },
            });
        }
        expect(
            docs.find(d => d.id === "100")!.versions.find(v => v.id === "107")!.text.length
        ).toBe(321);
        const comparison = {
            schemaVersion: "vantage-budget-offline-comparison/v1",
            evidence:
                "mocked-query offline structural selection only; no Generation, Judge, database, semantic gain, relevance metric or live provider claim",
            baselineCommit: fixture.provenance.baselineCommit,
            fixtureSha256: createHash("sha256").update(readFileSync(fixturePath)).digest("hex"),
            identity: replayIdentity,
            before: {
                selected: before.sources.map(s => ({
                    id: s.id,
                    version: s.version,
                    purpose: s.purpose,
                })),
                mandatoryCoverage: before.mandatoryCoverage,
                legacyBudget: calculateWeeklyReviewBudget(input(before)),
                internalBudget: calculateWeeklyReviewBudget(input(before), "internal-v1"),
            },
            after: {
                selected: after.sources.map(s => ({
                    id: s.id,
                    version: s.version,
                    purpose: s.purpose,
                })),
                diagnostics: after.selectionDiagnostics,
            },
            capacityVariants,
            sourceIdentityChanges: {
                added: after.sources
                    .filter(s => !before.sources.some(b => b.ref === s.ref))
                    .map(s => s.ref),
                removed: before.sources
                    .filter(s => !after.sources.some(a => a.ref === s.ref))
                    .map(s => s.ref),
            },
            missingLabels: [
                "No relevance goldens added",
                "No semantic output evaluated",
                "No latency or cost measurement",
            ],
        };
        if (process.env.VANTAGE_BUDGET_COMPARISON_OUTPUT) {
            const out = path.resolve(process.env.VANTAGE_BUDGET_COMPARISON_OUTPUT);
            expect(out).toContain(path.sep + "test-output" + path.sep);
            mkdirSync(path.dirname(out), { recursive: true });
            writeFileSync(out, JSON.stringify(comparison, null, 2) + "\n");
        }
    });
});
