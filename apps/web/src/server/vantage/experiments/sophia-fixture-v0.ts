/** Reusable synthetic-only PostgreSQL fixture. No model calls and no production entry point. */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { category, company, document, documentVersions } from "@launchstack/store/schema";
import {
    companyMetadata,
    companyProfileSources,
    type MetadataFact,
} from "@launchstack/tools/company-context/schema";
import {
    createEmptyMetadata,
    METADATA_SCHEMA_VERSION,
    READER_VERSION,
} from "@launchstack/pipelines/company-metadata";
import { generationSnapshot, reportPeriod, vantageEvidence } from "@launchstack/pipelines/vantage";
import type { BusinessRoleContextV0 } from "@launchstack/pipelines/vantage/context-v0";
import {
    documentGrants,
    documentSettings,
    folderSettings,
    userCompanyMemberships,
    users,
    workspaceRoles,
} from "~/server/db/schema";
import type { db } from "~/server/db";
import {
    assertSophiaSyntheticDatabaseV0,
    SOPHIA_SYNTHETIC_COMPANY_PREFIX,
    SOPHIA_SYNTHETIC_DOCUMENT_PREFIX,
    type SophiaCompositionRequestV0,
} from "./sophia-composition-v0";

export async function seedSophiaCompositionFixtureV0(database: typeof db) {
    await assertSophiaSyntheticDatabaseV0(database);
    const fixtureId = randomUUID(),
        stamp = new Date("2026-10-16T16:00:00Z");
    const owned = await database
        .insert(company)
        .values([
            { name: `${SOPHIA_SYNTHETIC_COMPANY_PREFIX}${fixtureId}`, numberOfEmployees: "2" },
            {
                name: `${SOPHIA_SYNTHETIC_COMPANY_PREFIX}foreign ${fixtureId}`,
                numberOfEmployees: "1",
            },
        ])
        .returning({ id: company.id });
    const companyId = BigInt(owned[0]!.id),
        foreignCompanyId = BigInt(owned[1]!.id);
    const actorId = `sophia-fixture-${fixtureId}`;
    const [actor] = await database
        .insert(users)
        .values({
            userId: actorId,
            email: `${actorId}@example.invalid`,
            name: "Synthetic Sophia evaluator",
            companyId,
        })
        .returning({ id: users.id });
    const actorPk = BigInt(actor!.id);
    await database.insert(workspaceRoles).values({
        companyId,
        slug: "sophia-fixture-reader",
        name: "Synthetic scoped reader",
        permissions: ["documents.read", "documents.edit"],
        createdBy: actorId,
    });
    await database
        .insert(userCompanyMemberships)
        .values({ userId: actorPk, companyId, role: "sophia-fixture-reader", status: "active" });
    const [board] = await database
        .insert(category)
        .values({ companyId, name: "Synthetic Privacy Board" })
        .returning({ id: category.id });
    await database.insert(folderSettings).values({
        companyId,
        categoryId: BigInt(board!.id),
        visibility: "restricted",
        updatedBy: actorId,
    });
    const window = {
        startInclusive: "2026-10-12T04:00:00.000Z",
        endExclusive: "2026-10-19T04:00:00.000Z",
        asOf: "2026-10-19T16:00:00.000Z",
    };
    const qa =
        "QA deletion verification for synthetic run-17: 3 of 3 sample accounts were deleted. QA reports its sample passed. This sample result is not a recorded privacy sign-off.";
    const ops =
        "Independent operations audit of synthetic run-17: 2 of 3 sample accounts were fully deleted; one record remained. The account list may differ from QA's. No reconciled shared sample was supplied.";
    const specs = {
        company: {
            text: "Synthetic Orbit builds onboarding software for pilot operators. Privacy is a constraint: access needs a deletion acceptance review, not only an engineering test pass.",
        },
        privacyStar: {
            text: "Human privacy review record: retain the deletion go/no-go question until a named privacy reviewer compares QA and operations samples and records approval. This document contains no approval record.",
        },
        deletionQa: {
            text: qa,
            origin: {
                connector: "synthetic-qa-fixture",
                id: "run-17-report",
                revision: "fixture-revision-1",
            },
        },
        deletionCopy: {
            text: qa,
            origin: {
                connector: "synthetic-qa-fixture",
                id: "run-17-report",
                revision: "fixture-revision-1",
            },
        },
        independentOps: {
            text: ops,
            origin: {
                connector: "synthetic-ops-fixture",
                id: "run-17-audit",
                revision: "fixture-revision-1",
            },
        },
        olderBlocker: {
            text: "Engineering deletion reliability blocker: identify which run-17 accounts remain after deletion.",
            old: true,
            state: { asOf: window.asOf, value: "open" },
        },
        olderResolved: {
            text: "Engineering deployment reliability test was resolved in an earlier review.",
            old: true,
            state: { asOf: window.asOf, value: "resolved" },
        },
        pendingQuestion: {
            text: "Historical human-kept review question: is deletion acceptance ready? Progress is unverified.",
            old: true,
            pendingQuestion: { humanReview: "kept" },
        },
        irrelevant: { text: "Synthetic internal lunch menu changed this week." },
        hidden: { text: "SECRET_UNAUTHORIZED_SOPHIA_BODY" },
        foreign: { text: "SECRET_FOREIGN_SOPHIA_BODY" },
    };
    type Key = keyof typeof specs;
    const docs = {} as Record<Key, { id: string; versionId: string; text: string }>;
    for (const [key, spec] of Object.entries(specs) as Array<[Key, (typeof specs)[Key]]>) {
        const foreign = key === "foreign",
            restricted = key === "privacyStar" || key === "hidden";
        const time = "old" in spec ? new Date("2026-09-01T16:00:00Z") : stamp;
        const [doc] = await database
            .insert(document)
            .values({
                companyId: foreign ? foreignCompanyId : companyId,
                title: key === "hidden" ? "SECRET_UNAUTHORIZED_SOPHIA_TITLE" : `Synthetic ${key}`,
                category: restricted ? "Synthetic Privacy Board" : "General",
                creationKey: `${SOPHIA_SYNTHETIC_DOCUMENT_PREFIX}${fixtureId}/${key}`,
                url: `local://synthetic-sophia/${fixtureId}/${key}`,
                createdAt: time,
                updatedAt: time,
            })
            .returning({ id: document.id });
        const [version] = await database
            .insert(documentVersions)
            .values({
                documentId: BigInt(doc!.id),
                versionNumber: 1,
                url: `local://synthetic-sophia-version/${fixtureId}/${key}`,
                mimeType: "text/plain",
                ocrProcessed: true,
                ocrMetadata: {
                    text: spec.text,
                    vantageSynthetic: {
                        ...("origin" in spec ? { origin: spec.origin } : {}),
                        ...("state" in spec ? { state: spec.state } : {}),
                        ...("pendingQuestion" in spec
                            ? { pendingQuestion: spec.pendingQuestion }
                            : {}),
                    },
                },
                createdAt: time,
            })
            .returning({ id: documentVersions.id });
        docs[key] = { id: String(doc!.id), versionId: String(version!.id), text: spec.text };
        await database
            .update(document)
            .set({ currentVersionId: BigInt(version!.id), updatedAt: time })
            .where(eq(document.id, doc!.id));
        if (restricted)
            await database.insert(documentSettings).values({
                companyId,
                documentId: BigInt(doc!.id),
                restricted: true,
                updatedBy: actorId,
            });
    }
    await database.insert(documentGrants).values({
        companyId,
        documentId: BigInt(docs.privacyStar.id),
        principalType: "user",
        principalId: String(actorPk),
        level: "view",
        grantedBy: actorId,
    });
    const sourceFact = (value: string): MetadataFact => ({
        value,
        visibility: "internal",
        usage: "no_outreach",
        confidence: 0.95,
        priority: "normal",
        status: "active",
        last_updated: stamp.toISOString(),
        sources: [
            {
                doc_id: Number(docs.company.id),
                version_id: Number(docs.company.versionId),
                doc_name: "Synthetic company privacy and onboarding",
                extracted_at: stamp.toISOString(),
                quote: value,
            },
        ],
    });
    const metadata = createEmptyMetadata(String(companyId), stamp);
    metadata.company.name = sourceFact("Synthetic Orbit");
    metadata.company.description = sourceFact("Builds onboarding software for pilot operators.");
    metadata.policies.privacy_review = sourceFact(
        "Pilot access needs a deletion acceptance review; an engineering test pass alone is insufficient."
    );
    await database.insert(companyMetadata).values({
        companyId,
        schemaVersion: METADATA_SCHEMA_VERSION,
        metadata,
        buildStatus: "idle",
        createdAt: stamp,
        updatedAt: stamp,
        builtAt: stamp,
    });
    await database.insert(companyProfileSources).values({
        companyId,
        documentId: BigInt(docs.company.id),
        versionId: BigInt(docs.company.versionId),
        role: "about_us",
        roleBy: "model",
        status: "done",
        facts: { company: metadata.company, policies: metadata.policies },
        factCount: 3,
        passages: { total: 1, kept: 1, dropped: {} },
        readerVersion: READER_VERSION,
        modelId: "synthetic-profile-extractor",
        readAt: stamp,
        createdAt: stamp,
        updatedAt: null,
    });
    for (const [title, body] of [
        ["Synthetic run-17 QA", qa],
        ["Synthetic run-17 independent operations", ops],
    ])
        await database.insert(vantageEvidence).values({
            id: randomUUID(),
            companyId,
            createdByUserId: actorId,
            kind: "note",
            title: title!,
            body: body!,
            source: title,
            observedAt: "2026-10-16",
            visibility: "private",
            tags: ["synthetic", "sophia-composition", fixtureId],
            createdAt: stamp,
            updatedAt: null,
        });
    const nativeSnapshot = await generationSnapshot(
        companyId,
        reportPeriod(new Date(window.asOf), "2026-10-12"),
        "configured-model",
        { actorId }
    );
    const nativeGenerationInput = nativeSnapshot.input;
    const roleContext: BusinessRoleContextV0 = {
        contractVersion: "v0-proposed",
        authenticatedPrincipalRef: actorId,
        roleIds: ["founder", "engineering"],
        primaryRoleId: "founder",
        mappingVersion: `synthetic-role-map/${fixtureId}/v1`,
        roles: [
            {
                roleId: "founder",
                description: "Synthetic founder business-role fixture",
                responsibilities: ["Privacy and pilot onboarding acceptance"],
                priorities: ["Resolve deletion verification conflicts before pilot access"],
            },
            {
                roleId: "engineering",
                description: "Synthetic engineering business-role fixture",
                responsibilities: ["Deletion reliability and QA verification"],
                priorities: ["Investigate unresolved engineering blockers"],
            },
        ],
        provenance: { kind: "server", source: "explicit-synthetic-Joseph-test-port" },
        userConfirmed: false,
        fallback: false,
    };
    let joseph = {
        roleContext,
        roleProfileVersions: {
            founder: "synthetic-founder/v1",
            engineering: "synthetic-engineering/v1",
        },
        starDocumentIds: [docs.privacyStar.id],
    };
    const budgets = {
        maxSources: 20,
        maxExcerptChars: 12000,
        maxTokens: 16000,
        timeoutMs: 5000,
        maxQueries: 3,
    };
    const request: SophiaCompositionRequestV0 = {
        runId: nativeGenerationInput.runId,
        inputVersion: nativeGenerationInput.inputVersion,
        nativeInput: nativeGenerationInput,
        expectedReportFingerprint: nativeSnapshot.expectedReportFingerprint,
        reportWindow: window,
        budgets,
        documentIds: Object.values(docs).map(doc => doc.id),
        starDocumentIds: joseph.starDocumentIds,
        roleContext: joseph.roleContext,
        roleProfileVersions: joseph.roleProfileVersions,
    };
    async function cleanup() {
        const ids = owned.map(row => row.id);
        const current = await database
            .select({ id: company.id, name: company.name })
            .from(company)
            .where(inArray(company.id, ids));
        if (current.some(row => !row.name.startsWith(SOPHIA_SYNTHETIC_COMPANY_PREFIX)))
            throw new Error("Refusing to remove a company without the owned synthetic marker.");
        await database.delete(company).where(inArray(company.id, ids));
    }
    return {
        fixtureId,
        companyId: String(companyId),
        foreignCompanyId: String(foreignCompanyId),
        actorId,
        actorPk: String(actorPk),
        docs,
        nativeGenerationInput,
        request,
        resolveJosephFixture: async () => structuredClone(joseph),
        replaceJosephFixture: (next: typeof joseph) => {
            joseph = structuredClone(next);
        },
        cleanup,
    };
}
