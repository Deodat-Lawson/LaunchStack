/**
 * Re-embedding against a real Postgres: it must make a new version of the
 * same stored file and queue that version's pipeline run — never rerun the
 * current version, whose chunks indexing would insert a second time.
 *
 * Gated like the other integration suites: runs on a throwaway database
 * migrated with both ledgers when LAUNCHSTACK_TEST_DATABASE_URL (or
 * DATABASE_URL) points at a local server.
 */

import { and, eq } from "drizzle-orm";

import { configureDatabase, type DbClient } from "@launchstack/store/client";
import {
    company,
    document,
    documentVersions,
    eventOutbox,
    ocrJobs,
} from "@launchstack/store/schema";
import {
    findReembedTarget,
    loadReembedDocument,
    reembedDocument,
} from "~/server/services/reembed-source";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("re-embedding a source (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;

    /** A processed document: one version, its job in `status`, routed as given. */
    async function addProcessed(
        title: string,
        {
            mimeType = "application/pdf",
            status = "completed",
            dispatchOptions = {},
            ocrEnabled = true,
            ocrMetadata = null,
            creationKey = null,
        }: {
            mimeType?: string;
            status?: "queued" | "processing" | "completed" | "failed";
            dispatchOptions?: Record<string, unknown>;
            ocrEnabled?: boolean;
            ocrMetadata?: Record<string, unknown> | null;
            creationKey?: string | null;
        } = {}
    ) {
        const url = `/api/files/${encodeURIComponent(title)}`;
        const [doc] = await test.db
            .insert(document)
            .values({
                companyId,
                title,
                category: "Team",
                url,
                mimeType,
                fileType: mimeType,
                ocrEnabled,
                ocrProcessed: status === "completed",
                ocrMetadata,
                creationKey,
            })
            .returning();
        const jobId = `job-${title}`;
        const [version] = await test.db
            .insert(documentVersions)
            .values({
                documentId: BigInt(doc!.id),
                versionNumber: 1,
                url,
                mimeType,
                fileSize: BigInt(2048),
                uploadedBy: "auth_ada",
                ocrJobId: jobId,
                ocrProcessed: status === "completed",
            })
            .returning();
        await test.db.insert(ocrJobs).values({
            id: jobId,
            companyId,
            documentId: BigInt(doc!.id),
            versionId: BigInt(version!.id),
            userId: "auth_ada",
            status,
            // The absolute URL the worker fetched — the row's own is relative.
            documentUrl: `https://app.test${url}`,
            documentName: title,
            dispatchOptions: { mimeType, ...dispatchOptions },
        });
        await test.db
            .update(document)
            .set({ currentVersionId: BigInt(version!.id), ocrJobId: jobId })
            .where(eq(document.id, doc!.id));
        return { id: doc!.id, versionId: version!.id, jobId, url };
    }

    async function target(id: number) {
        const doc = await loadReembedDocument(id, undefined);
        expect(doc).not.toBeNull();
        return (await findReembedTarget(doc!, undefined))!;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        // The lifecycle and the index-key lookup read the engine's slot.
        configureDatabase(test.db);
        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "20" })
            .returning();
        companyId = BigInt(co!.id);
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("makes a new version of the same file and queues its run", async () => {
        const pdf = await addProcessed("handbook.pdf", {
            dispatchOptions: { originalFilename: "Handbook.pdf", preferredProvider: "DOCLING" },
        });

        const result = await reembedDocument({ target: await target(pdf.id), userId: "auth_bea" });

        expect(result).toMatchObject({
            status: "reembedding",
            documentId: pdf.id,
            versionNumber: 2,
        });
        if (result.status !== "reembedding") throw new Error("unreachable");

        const [doc] = await test.db.select().from(document).where(eq(document.id, pdf.id));
        expect(doc!.currentVersionId).toBe(BigInt(result.versionId));
        expect(doc!.url).toBe(pdf.url);

        const [version] = await test.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.id, result.versionId));
        // The same stored file, read again: the viewer labels it a re-embed by this.
        expect(version).toMatchObject({ url: pdf.url, mimeType: "application/pdf" });
        expect(version!.fileSize).toBe(BigInt(2048));
        expect(version!.uploadedBy).toBe("auth_bea");

        const [job] = await test.db.select().from(ocrJobs).where(eq(ocrJobs.id, result.jobId));
        expect(job).toMatchObject({
            status: "queued",
            versionId: BigInt(result.versionId),
            // The URL the worker could fetch last time, not the relative row URL.
            documentUrl: `https://app.test${pdf.url}`,
        });
        expect(job!.dispatchOptions).toMatchObject({
            originalFilename: "Handbook.pdf",
            preferredProvider: "DOCLING",
            mimeType: "application/pdf",
        });

        const [event] = await test.db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.eventId, `source.version.created:${result.jobId}`));
        expect(event).toMatchObject({ status: "pending", eventType: "source.version.created" });

        // The first version and its job are left as they were.
        const [oldJob] = await test.db.select().from(ocrJobs).where(eq(ocrJobs.id, pdf.jobId));
        expect(oldJob!.status).toBe("completed");
    });

    it("converges on one version when asked twice for the same current version", async () => {
        const pdf = await addProcessed("twice.pdf");
        const doc = await target(pdf.id);

        const first = await reembedDocument({ target: doc, userId: "auth_ada" });
        const second = await reembedDocument({ target: doc, userId: "auth_ada" });

        expect(second).toEqual(first);
        const versions = await test.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, BigInt(pdf.id)));
        expect(versions).toHaveLength(2);
    });

    it("leaves a run that is under way alone", async () => {
        const pdf = await addProcessed("busy.pdf", { status: "processing" });

        const result = await reembedDocument({ target: await target(pdf.id), userId: "auth_ada" });

        expect(result).toEqual({ status: "already_running" });
        const versions = await test.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, BigInt(pdf.id)));
        expect(versions).toHaveLength(1);
    });

    it("starts a failed file over from the beginning", async () => {
        const pdf = await addProcessed("failed.pdf", { status: "failed" });

        const result = await reembedDocument({ target: await target(pdf.id), userId: "auth_ada" });

        expect(result).toMatchObject({ status: "reembedding", versionNumber: 2 });
    });

    it("refuses an archive, whose files are embedded on their own", async () => {
        const zip = await addProcessed("bundle.zip", { mimeType: "application/zip" });

        const result = await reembedDocument({ target: await target(zip.id), userId: "auth_ada" });

        expect(result).toEqual({ status: "archive" });
    });

    it("re-embeds a recording's transcript, carrying its transcription along", async () => {
        const recording = await addProcessed("call.m4a", {
            mimeType: "audio/mp4",
            ocrEnabled: false,
            creationKey: "upload:call:audio-source",
        });
        const segments = [{ start: 0, end: 2, text: "Hello" }];
        const transcriptionMetadata = {
            source: "transcription",
            audioDocumentId: recording.id,
            segments,
        };
        const transcript = await addProcessed("call (Transcription)", {
            mimeType: "text/plain",
            ocrMetadata: transcriptionMetadata,
            dispatchOptions: { transcriptionMetadata, originalFilename: "call-transcription.txt" },
        });

        const doc = await loadReembedDocument(recording.id, undefined);
        const found = await findReembedTarget(doc!, undefined);
        expect(found?.id).toBe(transcript.id);

        const result = await reembedDocument({ target: found!, userId: "auth_ada" });
        expect(result).toMatchObject({ status: "reembedding", documentId: transcript.id });
        if (result.status !== "reembedding") throw new Error("unreachable");

        const [job] = await test.db.select().from(ocrJobs).where(eq(ocrJobs.id, result.jobId));
        expect(job!.dispatchOptions).toMatchObject({
            transcriptionMetadata: { audioDocumentId: recording.id, segments },
        });
        // The recording itself gets no version.
        const recordingVersions = await test.db
            .select()
            .from(documentVersions)
            .where(
                and(
                    eq(documentVersions.documentId, BigInt(recording.id)),
                    eq(documentVersions.versionNumber, 2)
                )
            );
        expect(recordingVersions).toHaveLength(0);
    });

    it("finds nothing to read for a recording with no transcript", async () => {
        const lone = await addProcessed("lonely.mp3", {
            mimeType: "audio/mpeg",
            ocrEnabled: false,
            creationKey: "upload:lonely:audio-source",
        });

        const doc = await loadReembedDocument(lone.id, undefined);
        await expect(findReembedTarget(doc!, undefined)).resolves.toBeNull();
    });
});
