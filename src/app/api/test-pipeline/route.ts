/**
 * DEV-ONLY: Direct pipeline test endpoint.
 * Bypasses Inngest to run the full doc ingestion pipeline synchronously.
 * 
 * Usage:
 *   curl -X POST http://localhost:3000/api/test-pipeline \
 *     -H 'Content-Type: application/json' \
 *     -d '{"documentUrl":"http://localhost:8333/pdr-documents/documents/YOUR-FILE.md","documentName":"test","companyId":"2","userId":"user_XXX","documentId":203,"category":"Resume","mimeType":"text/markdown","originalFilename":"test.md"}'
 */
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

export async function POST(request: Request) {
    if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "dev only" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const jobId = (body.jobId as string) ?? `test-${uuid().slice(0, 8)}`;

    // Create a minimal ocrJobs row so pipeline state storage works
    const { db } = await import("~/server/db");
    const { ocrJobs } = await import("~/server/db/schema");

    await db.insert(ocrJobs).values({
        id: jobId,
        documentUrl: body.documentUrl as string,
        status: "processing",
        ocrResult: {},
    }).onConflictDoNothing();

    const { runDocIngestionTool } = await import("~/lib/tools");

    console.log(`[test-pipeline] Starting pipeline for jobId=${jobId}`);
    const start = Date.now();

    try {
        const result = await runDocIngestionTool({
            jobId,
            documentUrl: body.documentUrl as string,
            documentName: (body.documentName as string) ?? "test-doc",
            companyId: (body.companyId as string) ?? "2",
            userId: (body.userId as string) ?? "test-user",
            documentId: (body.documentId as number) ?? 0,
            category: (body.category as string) ?? "Test",
            mimeType: (body.mimeType as string) ?? "text/markdown",
            originalFilename: (body.originalFilename as string) ?? "test.md",
            runtime: {
                updateJobStatus: true,
                markFailureInDb: true,
                fastTextPath: (body.mimeType as string)?.startsWith("text/") ?? false,
            },
        });

        const elapsed = Date.now() - start;
        console.log(`[test-pipeline] Done in ${elapsed}ms — success=${result.success}`);

        return NextResponse.json({ ...result, elapsedMs: elapsed });
    } catch (err) {
        const elapsed = Date.now() - start;
        console.error(`[test-pipeline] Failed after ${elapsed}ms:`, err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : String(err), elapsedMs: elapsed },
            { status: 500 },
        );
    }
}
