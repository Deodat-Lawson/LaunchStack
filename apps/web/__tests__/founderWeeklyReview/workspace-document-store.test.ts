import { sql } from "drizzle-orm";
import { company, document, documentContextChunks, documentVersions } from "@launchstack/core/db/schema";
import { StrictCurrentWorkspaceDocumentStore } from "~/server/founder-weekly-review/workspace-document-store";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL ? describe : describe.skip;
const vector = (index: number) => Array.from({ length: 1536 }, (_, i) => i === index ? 1 : 0);
const vectorSql = (index: number) => sql`${JSON.stringify(vector(index))}::vector(1536)`;

describeDb("strict current workspace document store", () => {
    it("returns only company-owned current-version embedded chunks with deterministic ranking", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [owner] = await test.db.insert(company).values({ name: "Owner", numberOfEmployees: "1" }).returning();
            const [other] = await test.db.insert(company).values({ name: "Other", numberOfEmployees: "1" }).returning();
            const [doc] = await test.db.insert(document).values({ companyId: BigInt(owner!.id), url: "local://a", category: "Product", title: "A" }).returning();
            const [noCurrent] = await test.db.insert(document).values({ companyId: BigInt(owner!.id), url: "local://none", category: "Product", title: "No current" }).returning();
            const [foreign] = await test.db.insert(document).values({ companyId: BigInt(other!.id), url: "local://foreign", category: "Product", title: "Foreign" }).returning();
            const [v1] = await test.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 1, url: "local://a1", mimeType: "text/plain" }).returning();
            const [v2] = await test.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 2, url: "local://a2", mimeType: "text/plain" }).returning();
            const [noneVersion] = await test.db.insert(documentVersions).values({ documentId: BigInt(noCurrent!.id), versionNumber: 1, url: "local://n", mimeType: "text/plain" }).returning();
            const [foreignVersion] = await test.db.insert(documentVersions).values({ documentId: BigInt(foreign!.id), versionNumber: 1, url: "local://f", mimeType: "text/plain" }).returning();
            await test.db.update(document).set({ currentVersionId: BigInt(v2!.id) }).where(sql`${document.id} = ${doc!.id}`);
            await test.db.insert(documentContextChunks).values([
                { documentId: BigInt(doc!.id), versionId: BigInt(v2!.id), content: "current first", tokenCount: 1, charCount: 13, embedding: vectorSql(0) },
                { documentId: BigInt(doc!.id), versionId: BigInt(v2!.id), content: "current second", tokenCount: 1, charCount: 14, embedding: vectorSql(0) },
                { documentId: BigInt(doc!.id), versionId: BigInt(v1!.id), content: "historical", tokenCount: 1, charCount: 10, embedding: vectorSql(0) },
                { documentId: BigInt(doc!.id), versionId: null, content: "legacy", tokenCount: 1, charCount: 6, embedding: vectorSql(0) },
                { documentId: BigInt(noCurrent!.id), versionId: BigInt(noneVersion!.id), content: "no current", tokenCount: 1, charCount: 10, embedding: vectorSql(0) },
                { documentId: BigInt(foreign!.id), versionId: BigInt(foreignVersion!.id), content: "foreign", tokenCount: 1, charCount: 7, embedding: vectorSql(0) },
            ]);
            const store = new StrictCurrentWorkspaceDocumentStore(test.db, { embedQuery: jest.fn().mockResolvedValue(vector(0)) });
            const result = await store.retrieveRelevantCurrentDocumentChunks({ companyId: BigInt(owner!.id), founderContext: "current", topK: 1 });
            expect(result).toMatchObject({ state: "success", hits: [{ documentId: BigInt(doc!.id), versionId: BigInt(v2!.id), documentTitle: "A", content: "current first" }] });
            if (result.state === "success") expect(result.hits).toHaveLength(1);
        } finally { await test.close(); }
    });

    it("collects a computed v1-to-v2 diff plus only a current relevant workspace document", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [owner] = await test.db.insert(company).values({ name: "Owner", numberOfEmployees: "1" }).returning();
            const [other] = await test.db.insert(company).values({ name: "Other", numberOfEmployees: "1" }).returning();
            const [a] = await test.db.insert(document).values({ companyId: BigInt(owner!.id), url: "local://a", category: "Product", title: "Release plan" }).returning();
            const [b] = await test.db.insert(document).values({ companyId: BigInt(owner!.id), url: "local://b", category: "Product", title: "Current blocker" }).returning();
            const [foreign] = await test.db.insert(document).values({ companyId: BigInt(other!.id), url: "local://f", category: "Product", title: "Foreign" }).returning();
            const [a1] = await test.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 1, url: "local://a1", mimeType: "text/plain", createdAt: new Date("2026-01-01T00:00:00.000Z") }).returning();
            const [a2] = await test.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 2, url: "local://a2", mimeType: "text/plain", createdAt: new Date("2026-02-02T00:00:00.000Z") }).returning();
            const [a3] = await test.db.insert(documentVersions).values({ documentId: BigInt(a!.id), versionNumber: 3, url: "local://a3", mimeType: "text/plain", createdAt: new Date("2026-03-01T00:00:00.000Z") }).returning();
            const [b1] = await test.db.insert(documentVersions).values({ documentId: BigInt(b!.id), versionNumber: 1, url: "local://b1", mimeType: "text/plain", createdAt: new Date("2026-01-01T00:00:00.000Z") }).returning();
            const [foreignVersion] = await test.db.insert(documentVersions).values({ documentId: BigInt(foreign!.id), versionNumber: 1, url: "local://f1", mimeType: "text/plain" }).returning();
            await test.db.update(document).set({ currentVersionId: BigInt(a3!.id) }).where(sql`${document.id} = ${a!.id}`);
            await test.db.update(document).set({ currentVersionId: BigInt(b1!.id) }).where(sql`${document.id} = ${b!.id}`);
            await test.db.update(document).set({ currentVersionId: BigInt(foreignVersion!.id) }).where(sql`${document.id} = ${foreign!.id}`);
            await test.db.insert(documentContextChunks).values([
                { documentId: BigInt(a!.id), versionId: BigInt(a1!.id), content: "product release before", contentHash: "a".repeat(64), tokenCount: 1, charCount: 22 },
                { documentId: BigInt(a!.id), versionId: BigInt(a2!.id), content: "product release after", contentHash: "b".repeat(64), tokenCount: 1, charCount: 21 },
                { documentId: BigInt(a!.id), versionId: BigInt(a3!.id), content: "v3 must not diff", contentHash: "c".repeat(64), tokenCount: 1, charCount: 15 },
                { documentId: BigInt(b!.id), versionId: BigInt(b1!.id), content: "current blocker context", contentHash: "d".repeat(64), tokenCount: 1, charCount: 23, embedding: vectorSql(0) },
                { documentId: BigInt(b!.id), versionId: null, content: "legacy relevant", contentHash: "e".repeat(64), tokenCount: 1, charCount: 15, embedding: vectorSql(0) },
                { documentId: BigInt(foreign!.id), versionId: BigInt(foreignVersion!.id), content: "foreign relevant", contentHash: "f".repeat(64), tokenCount: 1, charCount: 16, embedding: vectorSql(0) },
            ]);
            const service = new FounderWeeklyReviewEvidenceService(test.db, () => new Date("2026-02-10T00:00:00.000Z"), { kind: "computed", store: new FounderWeeklyReviewDocumentVersionStore(test.db) }, new StrictCurrentWorkspaceDocumentStore(test.db, { embedQuery: jest.fn().mockResolvedValue(vector(0)) }));
            const input = { companyId: BigInt(owner!.id), reportingPeriod: { start: "2026-02-01", end: "2026-02-07" }, workspaceTimezone: "UTC", founderContext: "blocker", actor: { externalUserId: "u" }, requestKey: "computed-integration" };
            const first = await service.collectFounderWeeklyReviewEvidence(input);
            const second = await service.collectFounderWeeklyReviewEvidence(input);
            expect(first.schemaVersion).toBe("founder-weekly-review-evidence/v2");
            expect(first.items.filter((item) => item.sourceType === "document_change")).toHaveLength(1);
            expect(first.items).toEqual(second.items);
            expect(first.schemaVersion === "founder-weekly-review-evidence/v2" && first.documentChangeAudit).toEqual(
                second.schemaVersion === "founder-weekly-review-evidence/v2" ? second.documentChangeAudit : undefined
            );
            if (first.schemaVersion !== "founder-weekly-review-evidence/v2") throw new Error("Expected computed v2 evidence");
            expect(first.documentChangeAudit.rawChanges).toHaveLength(1);
            expect(first.documentChangeAudit.groups).toHaveLength(1);
            expect(first.documentChangeAudit.groups[0]!.evidenceSourceId).toBe(first.items.find((item) => item.sourceType === "document_change")!.sourceId);
            expect(first.items).toEqual(expect.arrayContaining([
                expect.objectContaining({ sourceType: "document_change", metadata: expect.objectContaining({ previousVersionId: a1!.id, currentVersionId: a2!.id }) }),
            ]));
            const workspaceItem = first.items.find((item) => item.sourceType === "workspace_document");
            expect(workspaceItem).toMatchObject({ sourceType: "workspace_document", title: "Current blocker" });
            expect(workspaceItem).not.toHaveProperty("sourceTimestamp");
            expect(first.items.some((item) => item.excerpt.includes("v3 must not diff") || item.excerpt.includes("legacy relevant") || item.excerpt.includes("foreign relevant"))).toBe(false);
        } finally { await test.close(); }
    });
});
