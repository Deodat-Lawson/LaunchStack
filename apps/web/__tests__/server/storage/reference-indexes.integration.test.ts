import { sql } from "drizzle-orm";
import {
    company,
    document,
    documentVersions,
    ocrJobs,
    uploadBatches,
    uploadBatchFiles,
} from "@launchstack/store/schema";
import { brandChannels, brandMedia } from "~/server/db/schema/brand";
import { collabAgentPersona } from "~/server/db/schema/collab";
import { connectorConnections } from "~/server/db/schema/connectors";
import { workspaceSessionMessages, workspaceSessions } from "~/server/db/schema/workspace-sessions";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

const target = "https://stored.example/2500";
const arms = [
    {
        label: "document.url",
        index: "document_url_idx",
        query: sql`SELECT 1 FROM ${document} WHERE ${document.url} = ${target}`,
    },
    {
        label: "document.websitePreview",
        index: "document_website_preview_url_idx",
        query: sql`SELECT 1 FROM ${document} WHERE ${document.ocrMetadata}->'websitePreview'->>'url' = ${target}`,
    },
    {
        label: "document.audioUrl",
        index: "document_audio_url_idx",
        query: sql`SELECT 1 FROM ${document} WHERE ${document.ocrMetadata}->>'audioUrl' = ${target}`,
    },
    {
        label: "version.url",
        index: "doc_versions_url_idx",
        query: sql`SELECT 1 FROM ${documentVersions} WHERE ${documentVersions.url} = ${target}`,
    },
    {
        label: "version.websitePreview",
        index: "doc_versions_website_preview_url_idx",
        query: sql`SELECT 1 FROM ${documentVersions} WHERE ${documentVersions.ocrMetadata}->'websitePreview'->>'url' = ${target}`,
    },
    {
        label: "version.audioUrl",
        index: "doc_versions_audio_url_idx",
        query: sql`SELECT 1 FROM ${documentVersions} WHERE ${documentVersions.ocrMetadata}->>'audioUrl' = ${target}`,
    },
    {
        label: "ocr_jobs.document_url",
        index: "ocr_jobs_document_url_idx",
        query: sql`SELECT 1 FROM ${ocrJobs} JOIN ${document} ON ${document.id} = ${ocrJobs.documentId} WHERE ${ocrJobs.documentUrl} = ${target} AND ${ocrJobs.status} IN ('queued', 'processing')`,
    },
    {
        label: "upload_batch_files.storage_url",
        index: "upload_batch_files_storage_url_idx",
        query: sql`SELECT 1 FROM ${uploadBatchFiles} WHERE ${uploadBatchFiles.storageUrl} = ${target} AND ${uploadBatchFiles.status} IN ('queued', 'uploaded', 'processing', 'failed')`,
    },
    {
        label: "brand_media.storage_url",
        index: "brand_media_storage_url_idx",
        query: sql`SELECT 1 FROM ${brandMedia} WHERE ${brandMedia.storageUrl} = ${target}`,
    },
    {
        label: "brand_channels.avatar_url",
        index: "brand_channels_avatar_url_idx",
        query: sql`SELECT 1 FROM ${brandChannels} WHERE ${brandChannels.avatarUrl} = ${target}`,
    },
    {
        label: "collab_agent_persona.avatar_url",
        index: "collab_persona_avatar_url_idx",
        query: sql`SELECT 1 FROM ${collabAgentPersona} WHERE ${collabAgentPersona.avatarUrl} = ${target}`,
    },
    {
        label: "workspace_session_messages.attachments",
        index: "workspace_session_messages_attachments_idx",
        query: sql`SELECT 1 FROM ${workspaceSessionMessages} WHERE ${workspaceSessionMessages.attachments} @> ${JSON.stringify([{ url: target }])}::jsonb`,
    },
    {
        label: "workspace_session_messages.metadata.send.attachments",
        index: "workspace_session_messages_metadata_idx",
        query: sql`SELECT 1 FROM ${workspaceSessionMessages} WHERE ${workspaceSessionMessages.metadata} @> ${JSON.stringify({ send: { attachments: [{ url: target }] } })}::jsonb`,
    },
    {
        label: "workspace_sessions.queued_messages",
        index: "workspace_sessions_queued_messages_idx",
        query: sql`SELECT 1 FROM ${workspaceSessions} WHERE ${workspaceSessions.queuedMessages} @> ${JSON.stringify([{ send: { attachments: [{ url: target }] } }])}::jsonb`,
    },
];
const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("exact storage reference index plans (integration)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        const [tenant] = await test.db
            .insert(company)
            .values({ name: "Index plans", numberOfEmployees: "1" })
            .returning();
        const companyId = tenant!.id;
        for (const statement of [
            sql`INSERT INTO ${document} (company_id, url, title, category, ocr_metadata)
                SELECT ${companyId}, 'https://stored.example/' || n, 'Document ' || n, 'Test',
                    jsonb_build_object('websitePreview', jsonb_build_object('url', 'https://stored.example/' || n), 'audioUrl', 'https://stored.example/' || n)
                FROM generate_series(1, 5000) n`,
            sql`INSERT INTO ${documentVersions} (document_id, version_number, url, mime_type, ocr_metadata)
                SELECT id, 1, url, 'text/plain', ocr_metadata FROM ${document}`,
            sql`INSERT INTO ${ocrJobs} (id, document_id, company_id, user_id, document_url, document_name, status)
                SELECT 'index-job-' || id, id, company_id, 'index-user', url, title, 'processing' FROM ${document}`,
            sql`INSERT INTO ${uploadBatches} (id, company_id, created_by_user_id)
                VALUES ('index-batch', ${companyId}, 'index-user')`,
            sql`INSERT INTO ${uploadBatchFiles} (batch_id, company_id, user_id, filename, storage_url, status)
                SELECT 'index-batch', company_id, 'index-user', title, url, 'uploaded' FROM ${document}`,
            sql`INSERT INTO ${brandMedia} (id, company_id, uploaded_by_user_id, storage_url, mime_type, size)
                SELECT 'index-media-' || id, company_id, 'index-user', url, 'text/plain', 1 FROM ${document}`,
            sql`INSERT INTO ${collabAgentPersona} (id, company_id, key, display_name, role, system_prompt, avatar_url)
                SELECT 'index-persona-' || id, company_id, 'index-key-' || id, title, 'test', '', url FROM ${document}`,
        ]) {
            await test.db.execute(statement);
        }
        const [connection] = await test.db
            .insert(connectorConnections)
            .values({
                companyId: BigInt(companyId),
                provider: "linkedin",
                providerAccountId: "index-account",
                scopes: "",
            })
            .returning();
        await test.db.execute(sql`
            INSERT INTO ${brandChannels} (id, company_id, connection_id, platform, kind, external_id, name, capabilities, avatar_url)
            SELECT 'index-channel-' || id, company_id, ${connection!.id}, 'linkedin', 'member', 'index-external-' || id, title, '{}'::jsonb, url FROM ${document};
        `);
        await test.db.insert(workspaceSessions).values({
            id: "index-session",
            companyId: BigInt(companyId),
            userId: "index-user",
            title: "Attachment index",
        });
        await test.db.execute(sql`
            INSERT INTO ${workspaceSessionMessages} (session_id, seq, role, text, attachments, metadata)
            SELECT 'index-session', id, 'user', title, jsonb_build_array(jsonb_build_object('url', url)),
                jsonb_build_object('send', jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('url', url))))
            FROM ${document}
        `);
        await test.db.execute(sql`
            INSERT INTO ${workspaceSessions} (id, company_id, user_id, title, queued_messages)
            SELECT 'index-queue-' || id, company_id, 'index-user', title,
                jsonb_build_array(jsonb_build_object('send', jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('url', url)))))
            FROM ${document}
        `);
        for (const table of [
            document,
            documentVersions,
            ocrJobs,
            uploadBatchFiles,
            brandMedia,
            brandChannels,
            collabAgentPersona,
            workspaceSessionMessages,
            workspaceSessions,
        ]) {
            await test.db.execute(sql`ANALYZE ${table}`);
        }
    });
    afterAll(async () => {
        await test?.close();
    });

    it.each(arms)("uses $index for exact $label equality", async ({ label, index, query }) => {
        // Natural plans on 5,000 rows per guarded table: no enable_seqscan override.
        const plan = await test.db.execute<{ "QUERY PLAN": string }>(
            sql`EXPLAIN (COSTS FALSE) ${query}`
        );
        const text = plan.map(line => line["QUERY PLAN"]).join("\n");
        expect(text).toContain(index);
        console.info(`STORAGE_GUARD_EXPLAIN ${label}\n${text}\nEND_STORAGE_GUARD_EXPLAIN`);
    });
});
