import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import type {
    createWeeklyReviewAuthority as AuthorityFactory,
    WeeklyReviewAuthorityActor,
} from "../../apps/web/src/server/vantage/weekly-review-authority";
import type { WeeklyReviewQuery } from "../../apps/web/src/server/vantage/weekly-review-types";
import {
    evaluateRetrievalOffline,
    type RetrievalEvaluationInput,
    type RetrievalEvaluationCandidate,
    type RetrievalCandidateInput,
} from "../../pipelines/src/vantage/retrieval-evaluation";

import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "../../pipelines/src/vantage/weekly-review-v21";
import {
    canonicalParentText,
    compileScopedEvidence,
    hashScopedText,
    type ScopedParent,
} from "../../pipelines/src/vantage/scoped-evidence";

let sophia: {
    createDynamicRetrievalProviderV0(options: unknown): {
        retrieve(input: unknown): Promise<{
            sourceRegistry: { source: { id: string; version: string } }[];
            diagnostics: unknown;
            status: string;
        }>;
    };
};
let sophiaPin: unknown;
let createWeeklyReviewAuthority: typeof AuthorityFactory;
const sourceHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// Standalone extraction of the relational fixture adapter from
// apps/web/__tests__/server/vantage-budget-retrieval.test.ts.
// Executes the actual collectors against a deterministic query fake.
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
interface OrbitFixture {
    schemaVersion: string;
    reportWindow: { weekStart: string; exclusiveCutoff: string };
    contextPlan: { architectureKey: string; requiredKeys: string[]; starredKeys: string[] };
    replayInput: { candidateId: string; asOf: string; role: string };
    documents: Doc[];
}
interface SourceManifest {
    sha: string;
    files: { path: string; sha256: string }[];
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
            assert.equal(params[0], actor.companyId);
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
                assert.match(text, /created_at\s*<=/);
                assert.match(text, /company_id\s*=\s*\$1/);
                assert.match(text, /LIMIT\s+(?:64|\$\d+)/i);
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
        authority: (flag?: boolean, scopedEvidenceV2 = false) =>
            createWeeklyReviewAuthority(
                { transaction: work => work(query) },
                async () => actor,
                flag === undefined ? undefined : { internalRetrievalV1: flag, scopedEvidenceV2 }
            ),
    };
}

async function main() {
    // Pin workspace source resolution even when dependency junctions target an older checkout.
    const temporary = mkdtempSync(path.join(tmpdir(), "vantage-offline-tsconfig-"));
    const configPath = path.join(temporary, "tsconfig.json");
    writeFileSync(
        configPath,
        JSON.stringify({
            compilerOptions: {
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "Bundler",
                baseUrl: process.cwd(),
                paths: {
                    "~/*": ["apps/web/src/*"],
                    "@launchstack/pipelines/*": ["pipelines/src/*"],
                },
            },
        })
    );
    try {
        const authority = (await tsImport(
            pathToFileURL(path.resolve("apps/web/src/server/vantage/weekly-review-authority.ts"))
                .href,
            {
                parentURL: pathToFileURL(path.resolve("scripts/eval/vantage-retrieval-offline.ts"))
                    .href,
                tsconfig: configPath,
            }
        )) as { createWeeklyReviewAuthority: typeof AuthorityFactory };
        createWeeklyReviewAuthority = authority.createWeeklyReviewAuthority;
        const sourceRoot =
            process.env.VANTAGE_SOPHIA_SOURCE_ROOT ??
            "C:/Users/junku/orca/LaunchStack/test-output/implementation-vantage-production-20261109/test-output/vantage-retrieval-audit-20261109/sophia-source";
        const sourceManifest = JSON.parse(
            readFileSync(path.join(sourceRoot, "source-manifest.json"), "utf8")
        ) as SourceManifest;
        assert.equal(sourceManifest.sha, "d53cefc7c048dbaecc5d1eee387686211570f082");
        for (const file of sourceManifest.files) {
            assert.equal(
                sourceHash(readFileSync(path.join(sourceRoot, file.path), "utf8")),
                file.sha256
            );
        }
        sophiaPin = sourceManifest;
        sophia = (await tsImport(
            pathToFileURL(
                path.join(sourceRoot, "pipelines/src/vantage/dynamic-retrieval/retrieve.ts")
            ).href,
            {
                parentURL: pathToFileURL(path.resolve("scripts/eval/vantage-retrieval-offline.ts"))
                    .href,
                tsconfig: configPath,
            }
        )) as typeof sophia;
        await runReplay();
    } finally {
        rmSync(configPath);
        rmdirSync(temporary);
    }
}

async function runReplay() {
    const fixturePath = path.resolve(
        "apps/web/__tests__/server/fixtures/vantage-budget-orbit-v1.json"
    );
    const fixtureBytes = readFileSync(fixturePath);
    const fixture = JSON.parse(fixtureBytes.toString("utf8")) as OrbitFixture;
    const docs = fixture.documents;
    assert.equal(docs.length, 28);
    assert.equal(
        docs.reduce((count, doc) => count + doc.versions.length, 0),
        29
    );
    for (const document of docs) {
        for (const version of document.versions) {
            assert.equal(sourceHash(version.text), version.sha256);
        }
    }
    const cutoff = fixture.reportWindow.exclusiveCutoff;
    const byKey = new Map(docs.map(document => [document.key, document.id]));
    const corpus = docs
        .filter(document => document.expectedReadability === "readable")
        .flatMap(document => {
            const version = [...document.versions]
                .filter(version => Date.parse(version.createdAt) <= Date.parse(cutoff))
                .sort(
                    (a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id)
                )[0];
            return version
                ? [
                      {
                          id: document.id,
                          version: version.id,
                          hash: sourceHash(version.text),
                          citation: `doc:${document.id}@${version.id}`,
                          companyId: "1",
                          authorized: true,
                          availableAt: version.createdAt,
                          text: version.text,
                      },
                  ]
                : [];
        });
    assert.equal(corpus.length, 27);
    const input: RetrievalEvaluationInput = {
        corpusId: fixture.schemaVersion,
        corpusVersion: createHash("sha256").update(fixtureBytes).digest("hex"),
        companyId: "1",
        cutoff,
        cutoffInclusive: true,
        query: "Frozen Orbit weekly-review context collection",
        topK: 16,
        budgets: {
            maxAcquired: 64,
            maxSelected: 16,
            maxSelectedCharacters: 100000,
            maxElapsedMs: 3000,
        },
        corpus,
    };
    const implementationFiles = [
        "apps/web/src/server/vantage/weekly-review-authority.ts",
        "apps/web/src/server/vantage/weekly-review-internal-selection.ts",
        "apps/web/src/server/vantage/weekly-review-scoped-selection.ts",
        "pipelines/src/vantage/weekly-review-v21.ts",
        "pipelines/src/vantage/scoped-evidence.ts",
        "scripts/eval/vantage-retrieval-offline.ts",
    ];
    const implementationHashes = Object.fromEntries(
        implementationFiles.map(file => [
            file,
            createHash("sha256").update(readFileSync(file)).digest("hex"),
        ])
    );
    const payloads: Record<string, unknown> = {};
    const replayInput = (sources: WeeklyReviewInput["sources"]): WeeklyReviewInput => ({
        candidateId: fixture.replayInput.candidateId,
        week: fixture.reportWindow.weekStart,
        asOf: fixture.replayInput.asOf,
        role: fixture.replayInput.role,
        mandatoryCoverage: {
            required: fixture.contextPlan.requiredKeys.length + 1,
            included: sources.filter(
                source =>
                    source.purpose === "company-architecture" ||
                    source.purpose === "workspace-required"
            ).length,
        },
        sources,
    });
    const captureBudget = (
        name: string,
        sources: WeeklyReviewInput["sources"],
        profile: "legacy" | "internal-v1"
    ) => {
        const projected = replayInput(sources);
        const selectedIds = new Set(sources.map(source => source.ref.split("@")[0]!.slice(4)));
        const configuredRequiredCoverage = {
            required: requiredIds.length,
            included: requiredIds.filter(id => selectedIds.has(id)).length,
        };
        assert.deepEqual(configuredRequiredCoverage, { required: 6, included: 6 });
        assert.deepEqual(projected.mandatoryCoverage, configuredRequiredCoverage);
        payloads[name] = {
            configuredRequiredCoverage,
            selectedDocumentKeys: sources.map(
                source => docs.find(doc => doc.id === source.ref.split("@")[0]!.slice(4))?.key
            ),
            serializedGenerationDataBytes: Buffer.byteLength(JSON.stringify(projected)),
            budget: calculateWeeklyReviewBudget(projected, profile),
            measurement:
                "serialized data payload and deterministic preflight, excludes HTTP/system/schema token overhead",
        };
    };
    const collectorCandidate = (
        name: "A-production" | "B-budget-v1" | "D-scoped-candidate",
        flag: boolean,
        scoped = false
    ): RetrievalEvaluationCandidate => ({
        name,
        implementation: JSON.stringify({
            internalRetrievalV1: flag,
            scopedEvidenceV2: scoped,
            sourceSha256: implementationHashes,
        }),
        run: async (frozen, signal) => {
            signal.throwIfAborted();
            const replay = setup(
                structuredClone(docs),
                fixture.contextPlan.requiredKeys.map((key: string) => byKey.get(key)!),
                fixture.contextPlan.starredKeys.map((key: string) => byKey.get(key)!),
                byKey.get(fixture.contextPlan.architectureKey)
            );
            replay.actor.role = fixture.replayInput.role;
            const context = await replay
                .authority(flag, scoped)
                .collectWeeklyReviewContext(replay.actor, fixture.reportWindow.weekStart, {
                    candidateId: fixture.replayInput.candidateId,
                    asOf: fixture.replayInput.asOf,
                });
            signal.throwIfAborted();
            assert.equal(frozen.cutoff, cutoff);
            assert.deepEqual(context.mandatoryCoverage, { required: 6, included: 6 });
            captureBudget(name, context.sources, flag ? "internal-v1" : "legacy");
            const acquiredIds = [
                ...new Set(
                    replay.calls
                        .filter(call => call.text.includes("document_context_chunks"))
                        .map(call => String(call.params[0]))
                ),
            ];
            return {
                acquiredIds,
                selected: context.sources.map(source => ({
                    id: source.id,
                    version: source.version,
                    hash: source.hash,
                    citation: source.ref,
                })),
            };
        },
    });
    const requiredIds = [
        fixture.contextPlan.architectureKey,
        ...fixture.contextPlan.requiredKeys,
    ].map((key: string) => byKey.get(key)!);
    const starIds = fixture.contextPlan.starredKeys.map((key: string) => byKey.get(key)!);
    assert.equal(new Set(requiredIds).size, 6);
    assert.equal(new Set(starIds).size, 4);
    const reservedIds = [...requiredIds, ...starIds];
    assert.equal(new Set(reservedIds).size, 10);
    const cMetadata: Record<string, unknown> = {};
    const candidates: RetrievalEvaluationCandidate[] = [
        collectorCandidate("A-production", false),
        collectorCandidate("B-budget-v1", true),
        {
            name: "C-exact-sophia-lexical",
            implementation: JSON.stringify({
                exactSophiaExport: sophiaPin,
                adapter: "required-and-stars-first-then-pinned-lexical-budget-admission/v1",
                sourceSha256: implementationHashes,
            }),
            run: async (frozen: Readonly<RetrievalCandidateInput>, signal: AbortSignal) => {
                const optional = frozen.corpus.filter(source => !reservedIds.includes(source.id));
                const metadata = optional.map(source => ({
                    source: { kind: "doc", id: source.id, version: source.version },
                    title: docs.find(doc => doc.id === source.id)!.title,
                    topics: [docs.find(doc => doc.id === source.id)!.category],
                    changedAt: source.availableAt,
                }));
                const ranker = sophia.createDynamicRetrievalProviderV0({
                    metadata,
                    maxCandidates: 64,
                    signal,
                    primaryRolePreference: true,
                });
                const ranked = await ranker.retrieve({
                    contractVersion: "v0-proposed",
                    actor: {
                        principalRef: "synthetic-reader",
                        companyId: "1",
                        audience: { kind: "actor", principalRef: "synthetic-reader" },
                        aclDigest: "frozen-orbit-acl",
                    },
                    verifiedRoleContext: {
                        contractVersion: "v0-proposed",
                        authenticatedPrincipalRef: "synthetic-reader",
                        roleIds: ["operations"],
                        primaryRoleId: "operations",
                        mappingVersion: "hypothetical-operations-v1",
                        roles: [
                            {
                                roleId: "operations",
                                description: "Operations lead",
                                responsibilities: [
                                    "release readiness",
                                    "security review",
                                    "delivery dependencies",
                                ],
                                priorities: ["unresolved decisions", "rollback readiness"],
                            },
                        ],
                        provenance: {
                            kind: "user-confirmed",
                            source: "explicitly hypothetical offline role condition",
                        },
                        userConfirmed: true,
                        fallback: false,
                    },
                    reportWindow: {
                        startInclusive: fixture.reportWindow.weekStart + "T00:00:00.000Z",
                        endExclusive: cutoff,
                        asOf: cutoff,
                    },
                    sourceCatalog: optional.map(source => ({
                        source: { kind: "doc", id: source.id, version: source.version },
                        companyId: "1",
                        access: "allowed",
                        aclDigest: "frozen-orbit-acl",
                        audience: { kind: "company", companyId: "1" },
                        sourceDate: source.availableAt,
                        checkedAt: cutoff,
                        excerpt: source.text,
                    })),
                    budgets: {
                        maxSources: 64,
                        maxExcerptChars: frozen.budgets.maxSelectedCharacters,
                        maxTokens: 128000,
                        maxQueries: 2,
                        timeoutMs: frozen.budgets.maxElapsedMs,
                    },
                });
                signal.throwIfAborted();
                const sourceFor = (id: string) => {
                    const source = frozen.corpus.find(item => item.id === id)!;
                    return {
                        kind: "document",
                        id: source.id,
                        ref: source.citation,
                        version: source.version,
                        hash: source.hash,
                        title: docs.find(doc => doc.id === id)!.title,
                        text: source.text,
                        purpose:
                            id === requiredIds[0]
                                ? "company-architecture"
                                : requiredIds.includes(id)
                                  ? "workspace-required"
                                  : starIds.includes(id)
                                    ? "personal-star"
                                    : "retrieved",
                        audience:
                            docs.find(doc => doc.id === id)!.audience === "company"
                                ? "company"
                                : "actor",
                    };
                };
                const selected = reservedIds.map(sourceFor);
                const skipped: { id: string; reason: string; budgetReasons: string[] }[] = [];
                for (const entry of ranked.sourceRegistry) {
                    const source = sourceFor(entry.source.id);
                    const nextBudget = calculateWeeklyReviewBudget(
                        replayInput([...selected, source]),
                        "internal-v1"
                    );
                    if (selected.length >= frozen.budgets.maxSelected || !nextBudget.feasible) {
                        skipped.push({
                            id: entry.source.id,
                            reason:
                                selected.length >= frozen.budgets.maxSelected
                                    ? "source_count"
                                    : "runtime_budget",
                            budgetReasons: nextBudget.reasons,
                        });
                        continue;
                    }
                    selected.push(source);
                }
                captureBudget("C-exact-sophia-lexical", selected, "internal-v1");
                cMetadata.ranking = {
                    status: ranked.status,
                    diagnostics: ranked.diagnostics,
                    skippedAfterRanking: skipped,
                    roleCondition:
                        "Hypothetical confirmed Operations lead, independent from workspace membership role. No role-quality claim.",
                    stateMetadata:
                        "No historical open/resolved state invented from text or current timestamps.",
                };
                return {
                    acquiredIds: frozen.corpus.map(source => source.id),
                    selected: selected.map(source => {
                        const evidence = frozen.corpus.find(item => item.citation === source.ref)!;
                        return {
                            id: evidence.id,
                            version: evidence.version,
                            hash: evidence.hash,
                            citation: evidence.citation,
                        };
                    }),
                };
            },
        },
        collectorCandidate("D-scoped-candidate", true, true),
    ];
    const report = await evaluateRetrievalOffline(input, candidates);
    assert.equal(report.candidates.length, 4);
    for (const candidate of report.candidates) {
        assert.equal(candidate.status, "valid", JSON.stringify(candidate));
        assert.ok(
            candidate.output!.selected.length >= 10 && candidate.output!.selected.length <= 16
        );
        assert.equal(candidate.metrics.criticalEvidenceRecallAtK.value, null);
    }
    const selectedA = report.candidates[0]!.output!.selected;
    const selectedB = report.candidates[1]!.output!.selected;
    const references = (selected: typeof selectedA) =>
        selected.map(item => JSON.stringify(item)).sort();
    assert.deepEqual(references(selectedA), references(selectedB));
    assert.deepEqual(report.candidates[3]!.output!.selected, selectedB);
    const longParent: ScopedParent = {
        companyId: "1",
        documentId: "controlled-long-parent",
        version: "1",
        versionDate: "2026-10-23T12:00:00.000Z",
        availableAt: "2026-10-23T12:00:00.000Z",
        title: "Controlled long required source",
        purpose: "company-architecture",
        originalCompleteness: "unknown",
        chunks: Array.from({ length: 129 }, (_, ordinal) => ({
            id: "chunk-" + ordinal,
            ordinal,
            text: "a".repeat(255),
        })),
    };
    const parentText = canonicalParentText(longParent);
    const excerpt = parentText.slice(0, 2000);
    const scoped = compileScopedEvidence(
        {
            actorId: "synthetic-reader",
            companyId: "1",
            documentId: longParent.documentId,
            version: "1",
            asOf: cutoff,
            expectedParentHash: hashScopedText(parentText),
            selectedUnitIds: ["approved-span"],
        },
        longParent,
        {
            actorId: "synthetic-reader",
            companyId: "1",
            documentId: longParent.documentId,
            version: "1",
            authorized: true,
            purpose: "company-architecture",
            audience: "company",
            companyReadable: true,
            aclRevision: "controlled-acl",
            authorityRevision: "controlled-explicit-admin-policy",
            finiteScope: {
                qualification:
                    "Explicitly approved controlled capacity-test span. No semantic coverage claim.",
                requiredUnits: [
                    {
                        id: "approved-span",
                        start: 0,
                        end: excerpt.length,
                        excerptHash: hashScopedText(excerpt),
                    },
                ],
            },
        }
    );
    const longContext = {
        candidateId: "controlled-long-capacity",
        week: fixture.reportWindow.weekStart,
        asOf: cutoff,
        role: fixture.replayInput.role,
        mandatoryCoverage: { required: 1, included: 1 },
    };
    const wholeBudget = calculateWeeklyReviewBudget(
        {
            ...longContext,
            sources: [
                {
                    ref: "doc:controlled-long-parent@1",
                    version: "1",
                    hash: hashScopedText(parentText),
                    purpose: "company-architecture",
                    title: longParent.title,
                    text: parentText,
                },
            ],
        },
        "internal-v1"
    );
    const scopedBudget = calculateWeeklyReviewBudget(
        {
            ...longContext,
            sources: scoped.modelFacingProjection.sources,
            scopedEvidence: [scoped.dependency],
        },
        "scoped-v2"
    );
    assert.equal(wholeBudget.feasible, false);
    assert.equal(scopedBudget.feasible, true);
    const controlledLongCapacity = {
        corpus: "separate provisional controlled fixture, distinct from Orbit28",
        parentBytes: Buffer.byteLength(parentText),
        parentChunks: longParent.chunks.length,
        selectedSpanCharacters: excerpt.length,
        parentHash: hashScopedText(parentText),
        scopeHash: scoped.dependency.scopeHash,
        coverage: scoped.dependency.coverage,
        wholeBudget,
        scopedBudget,
        semanticClaim:
            "No semantic relevance or sufficient-evidence assertion. Administrator approves only this finite scope.",
    };
    const identicalSelectionOrder = JSON.stringify(selectedA) === JSON.stringify(selectedB);
    const result = {
        ...report,
        candidatePayloadMeasurements: payloads,
        sophiaComparison: cMetadata,
        controlledLongCapacity,
        replay: {
            fixtureDocuments: docs.length,
            authorizedCutoffCorpusCount: corpus.length,
            queryMode: "offline-relational-query-fake",
            implementationHashes,
            compared:
                "actual A/B collectors, exact Sophia lexical optional ranking with preserved required/stars and budget admission, actual scoped-enabled collector with no configured Orbit scopes",
            originalOrbitScopePolicy:
                "No approved finite scope exists. D retains whole-document policy and matches B.",
            identicalAandBSelectedReferenceSet: true,
            identicalSelectionOrder,
            pending: [
                "Joseph enterprise gold and Sophia independent review",
                "database-backed ranking and semantic decision quality evaluation",
            ],
        },
    };
    const serialized = JSON.stringify(result, null, 2) + "\n";
    const outputPath = process.argv[2];
    if (outputPath) {
        const resolved = path.resolve(outputPath);
        mkdirSync(path.dirname(resolved), { recursive: true });
        writeFileSync(resolved, serialized);
        console.log(
            JSON.stringify({
                outputPath: resolved,
                candidates: report.candidates.map(candidate => ({
                    name: candidate.name,
                    status: candidate.status,
                    acquired: candidate.output!.acquiredIds.length,
                    selected: candidate.output!.selected.length,
                    elapsedMs: candidate.elapsedMs,
                })),
                identicalAandBSelectedReferenceSet: true,
                identicalSelectionOrder,
                manifestSha256: report.manifestSha256,
            })
        );
    } else console.log(serialized);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
