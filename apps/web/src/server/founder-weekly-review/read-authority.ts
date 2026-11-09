import { and, eq, inArray } from "drizzle-orm";
import { document } from "@launchstack/store/schema";
import type { FounderWeeklyReviewRunRecord } from "@launchstack/pipelines/founder-weekly-review";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopeAllows } from "~/lib/authz/scope";
import { db } from "~/server/db";

function forbidden(): never {
    throw Object.assign(new Error("Report source access is unavailable"), {
        status: 403,
        code: "forbidden",
    });
}

/** Legacy snapshots have no independent ACL for manual/founder text. Keep that
 * content private to its creator; every document is reauthorized even for them.
 * No current-head comparison: an authorized historical source remains readable.
 */
export async function authorizeLegacyReviewRead(run: FounderWeeklyReviewRunRecord): Promise<void> {
    if (!run.reviewPayload) return;
    const result = await requireWorkspaceContext();
    if (
        !result.success ||
        result.data.companyId !== run.companyId ||
        !result.data.can("documents.read")
    )
        forbidden();
    const ctx = result.data;
    if (!run.evidenceSnapshot) forbidden();
    const ids = new Set<string>();
    for (const item of run.evidenceSnapshot.items) {
        const raw = item.metadata.documentId;
        if (raw !== undefined) {
            if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) forbidden();
            if (!Number.isSafeInteger(Number(raw))) forbidden();
            ids.add(raw);
        } else if (
            item.sourceType === "workspace_document" ||
            item.sourceType === "document_change" ||
            item.sourceType === "customer_feedback"
        ) {
            forbidden();
        } else if (`user:${ctx.authUserId}` !== run.createdByActorId) forbidden();
    }
    if (!ids.size) return;
    const rows = await db
        .select({ id: document.id, category: document.category })
        .from(document)
        .where(
            and(eq(document.companyId, ctx.companyId), inArray(document.id, [...ids].map(Number)))
        );
    const scope = await ctx.documentScope();
    if (rows.length !== ids.size || rows.some(row => !scopeAllows(scope, row))) forbidden();
}
