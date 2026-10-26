/** Explicit synthetic-only, idempotent canonical-profile update. Never seeds reports or calls AI. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { configureDatabase, createDb } from "@launchstack/store/client";
import { company, document, documentVersions } from "@launchstack/store/schema";
import { companyMetadata, companyProfileSources } from "@launchstack/tools/company-context/schema";
import {
    assembleMetadata,
    diffMetadata,
    flattenFacts,
    READER_VERSION,
    saveProfileLocked,
} from "@launchstack/pipelines/company-metadata";
import { listCountedSources } from "../../../pipelines/src/company-metadata/db";
import { documentGrants, documentSettings, users } from "~/server/db/schema";
import {
    buildOrbitCompanyFixture,
    ORBIT_COMPANY_SOURCE_DOCUMENT,
} from "~/server/vantage/experiments/orbit-company-fixture";
import { SOPHIA_SYNTHETIC_COMPANY_PREFIX } from "~/server/vantage/experiments/sophia-composition-v0";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = resolve(root, "test-output/vantage-context-demo/runtime");
const journalFile = resolve(runtime, "company-rich-v1.json");
const stable = (value: unknown): unknown =>
    value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? String(value)
          : Array.isArray(value)
            ? value.map(stable)
            : value && typeof value === "object"
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, child]) => [key, stable(child)])
                )
              : value;
const hash = (value: unknown) =>
    createHash("sha256")
        .update(JSON.stringify(stable(value)))
        .digest("hex");

async function main() {
    if (
        process.argv.slice(2).join(" ") !== "--apply" ||
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true" ||
        process.env.VANTAGE_TL_TEST_MODE !== "true"
    )
        throw Error("Explicit owned local fixture mode required.");
    const raw = process.env.VANTAGE_TL_TEST_DATABASE_URL;
    if (!raw || process.env.DATABASE_URL !== raw) throw Error("Dedicated target binding required.");
    const target = new URL(raw);
    if (
        target.protocol !== "postgres:" ||
        target.hostname !== "127.0.0.1" ||
        target.port !== "55437" ||
        target.pathname !== "/vantage_week2_tl_contract_v1" ||
        target.username !== "vantage_week2_tl" ||
        target.search ||
        target.hash
    )
        throw Error("Wrong isolated database target.");
    const descriptor = JSON.parse(readFileSync(resolve(runtime, "fixture.json"), "utf8")) as {
        schemaVersion: string;
        fixtureId: string;
        companyId: string;
        actorId: string;
        weeks: { asOf: string }[];
    };
    if (
        descriptor.schemaVersion !== "vantage-context-demo/v1" ||
        descriptor.actorId !== `sophia-fixture-${descriptor.fixtureId}` ||
        !/^\d+$/.test(descriptor.companyId)
    )
        throw Error("Wrong synthetic descriptor.");
    const at = new Date(),
        asOf = descriptor.weeks.at(-1)!.asOf;
    if (!Number.isFinite(Date.parse(asOf)) || at.getTime() > Date.parse(asOf))
        throw Error(
            "Fixture writes must be within the existing explicit cutoff; no timestamps were backdated."
        );
    const client = createDb({ url: raw, maxConnections: 3 });
    configureDatabase(client.db);
    const database = client.db,
        companyId = BigInt(descriptor.companyId);
    const creationKey = `vantage-context-company-rich/${descriptor.fixtureId}/v1`;
    try {
        const [owner] = await database
            .select()
            .from(company)
            .where(eq(company.id, Number(companyId)));
        const [actor] = await database
            .select()
            .from(users)
            .where(and(eq(users.userId, descriptor.actorId), eq(users.companyId, companyId)));
        if (owner?.name !== `${SOPHIA_SYNTHETIC_COMPANY_PREFIX}${descriptor.fixtureId}` || !actor)
            throw Error("Synthetic ownership or actor mismatch.");
        const [prior] = await database
            .select()
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, companyId));
        if (!prior || prior.buildStatus !== "idle")
            throw Error("Existing idle canonical profile required.");
        const [existing] = await database
            .select()
            .from(document)
            .where(and(eq(document.companyId, companyId), eq(document.creationKey, creationKey)));
        if (existing) {
            if (!existsSync(journalFile))
                throw Error(
                    "Existing enrichment needs its preserved local proof; refusing an ambiguous replay."
                );
            const journal = JSON.parse(readFileSync(journalFile, "utf8"));
            const [version] = await database
                .select()
                .from(documentVersions)
                .where(eq(documentVersions.id, Number(existing.currentVersionId)));
            if (
                journal.companyId !== descriptor.companyId ||
                journal.documentId !== String(existing.id) ||
                journal.versionId !== String(existing.currentVersionId) ||
                journal.metadataHash !== hash(prior.metadata) ||
                hash(version?.ocrMetadata) !== journal.versionPayloadHash
            )
                throw Error("Existing enrichment changed; it was preserved.");
            console.log(
                JSON.stringify({
                    syntheticOnly: true,
                    mode: "verified-idempotent-no-write",
                    companyId: descriptor.companyId,
                    documentId: journal.documentId,
                    versionId: journal.versionId,
                    canonicalReviewState: "unreviewed",
                })
            );
            return;
        }
        if (existsSync(journalFile))
            throw Error("A previously enriched source is missing; it was not recreated.");
        const expected = hash(prior.metadata);
        let proof: Record<string, unknown> | undefined;
        await saveProfileLocked(
            companyId,
            async (current, tx) => {
                if (!current || hash(current) !== expected)
                    throw Error("Canonical profile changed before lock; refusing stale update.");
                const [doc] = await tx
                    .insert(document)
                    .values({
                        companyId,
                        title: ORBIT_COMPANY_SOURCE_DOCUMENT.title,
                        category: "Synthetic Privacy Board",
                        creationKey,
                        url: `local://vantage-context-company-rich/${descriptor.fixtureId}/v1`,
                        createdAt: at,
                        updatedAt: at,
                    })
                    .returning();
                const payload = {
                    text: ORBIT_COMPANY_SOURCE_DOCUMENT.text,
                    vantageSynthetic: {
                        fixtureId: descriptor.fixtureId,
                        kind: "company-rich/v1",
                        modelCalled: false,
                    },
                };
                const [version] = await tx
                    .insert(documentVersions)
                    .values({
                        documentId: BigInt(doc!.id),
                        versionNumber: 1,
                        url: `local://vantage-context-company-rich-version/${descriptor.fixtureId}/v1`,
                        mimeType: "text/plain",
                        ocrProcessed: true,
                        ocrMetadata: payload,
                        createdAt: at,
                    })
                    .returning();
                await tx
                    .update(document)
                    .set({ currentVersionId: BigInt(version!.id), updatedAt: at })
                    .where(eq(document.id, doc!.id));
                const fixture = buildOrbitCompanyFixture({
                    companyId: String(companyId),
                    documentId: String(doc!.id),
                    versionId: String(version!.id),
                    now: at,
                    asOf,
                    quoteMode: "none",
                });
                await tx.insert(companyProfileSources).values({
                    companyId,
                    documentId: BigInt(doc!.id),
                    versionId: BigInt(version!.id),
                    role: "about_us",
                    roleBy: "rules",
                    reason: "Explicit fully fictional, source-derived fixture; no extraction model or human approval was invoked.",
                    status: "done",
                    facts: fixture.sourceFacts,
                    factCount: fixture.fictionalReviewDocument.record.reviewedFieldPaths.length,
                    passages: { total: 1, kept: 1, dropped: {} },
                    readerVersion: READER_VERSION,
                    modelId: "synthetic-fixture/no-model",
                    readAt: at,
                    createdAt: at,
                    updatedAt: null,
                });
                const reviewPayload = {
                    text: fixture.fictionalReviewDocument.text,
                    vantageSynthetic: {
                        fixtureId: descriptor.fixtureId,
                        companyProfileReview: {
                            ...fixture.fictionalReviewDocument.record,
                            sourceContentSha256: createHash("sha256")
                                .update(ORBIT_COMPANY_SOURCE_DOCUMENT.text)
                                .digest("hex"),
                        },
                    },
                };
                const [reviewDoc] = await tx
                    .insert(document)
                    .values({
                        companyId,
                        title: fixture.fictionalReviewDocument.title,
                        category: "Synthetic Privacy Board",
                        creationKey: creationKey + "/fictional-review",
                        url: `local://vantage-context-company-rich/${descriptor.fixtureId}/fictional-review`,
                        createdAt: at,
                        updatedAt: at,
                    })
                    .returning();
                const [reviewVersion] = await tx
                    .insert(documentVersions)
                    .values({
                        documentId: BigInt(reviewDoc!.id),
                        versionNumber: 1,
                        url: `local://vantage-context-company-rich-version/${descriptor.fixtureId}/fictional-review`,
                        mimeType: "text/plain",
                        ocrProcessed: true,
                        ocrMetadata: reviewPayload,
                        createdAt: at,
                    })
                    .returning();
                await tx
                    .update(document)
                    .set({ currentVersionId: BigInt(reviewVersion!.id), updatedAt: at })
                    .where(eq(document.id, reviewDoc!.id));
                for (const id of [doc!.id, reviewDoc!.id]) {
                    await tx.insert(documentSettings).values({
                        companyId,
                        documentId: BigInt(id),
                        restricted: true,
                        updatedBy: descriptor.actorId,
                    });
                    await tx.insert(documentGrants).values({
                        companyId,
                        documentId: BigInt(id),
                        principalType: "user",
                        principalId: String(actor.id),
                        level: "view",
                        grantedBy: descriptor.actorId,
                    });
                }
                const counted = await listCountedSources(companyId, tx);
                const next = assembleMetadata(
                    String(companyId),
                    counted.map(row => ({
                        documentId: Number(row.documentId),
                        title: row.title,
                        facts: row.facts!,
                    })),
                    current,
                    at
                );
                next.provenance.extraction_model = "synthetic-fixture/no-model";
                proof = {
                    schemaVersion: "vantage-context-company-rich-proof/v1",
                    syntheticOnly: true,
                    fixtureId: descriptor.fixtureId,
                    companyId: String(companyId),
                    actorId: descriptor.actorId,
                    documentId: String(doc!.id),
                    versionId: String(version!.id),
                    versionPayloadHash: hash(payload),
                    fictionalReviewDocumentId: String(reviewDoc!.id),
                    fictionalReviewVersionId: String(reviewVersion!.id),
                    fictionalReviewRecord: reviewPayload.vantageSynthetic.companyProfileReview,
                    canonicalReviewState: "unreviewed",
                    metadataHash: hash(next),
                    previousMetadataHash: expected,
                    fieldMap: fixture.fieldMap,
                    actualRecordedAt: at.toISOString(),
                    asOf,
                    provenanceMode: fixture.provenanceMode,
                    factCount: flattenFacts(next).length,
                    sourceRows: counted.map(row => ({
                        documentId: String(row.documentId),
                        versionId: String(row.versionId),
                    })),
                    reportsTouched: 0,
                    modelCalled: false,
                };
                return { metadata: next, diff: diffMetadata(current, next) };
            },
            { changedBy: `synthetic-fixture/${descriptor.actorId}`, changeType: "extraction" }
        );
        if (!proof) throw Error("Enrichment produced no proof.");
        mkdirSync(runtime, { recursive: true });
        writeFileSync(journalFile, JSON.stringify(proof, null, 2) + "\n", {
            flag: "wx",
            mode: 0o600,
        });
        console.log(
            JSON.stringify({
                syntheticOnly: true,
                mode: "canonical-source-assembly",
                companyId: String(companyId),
                documentId: proof.documentId,
                versionId: proof.versionId,
                factCount: proof.factCount,
                canonicalReviewState: "unreviewed",
                reportsTouched: 0,
                modelCalled: false,
            })
        );
    } finally {
        await client.close();
    }
}
main().catch(() => {
    console.error(
        "[context-demo] Rich company fixture unavailable; no credentials were printed. Inspect retained local proof before retrying."
    );
    process.exitCode = 1;
});
