import "server-only";

/**
 * Feedback reads and writes, with who-may-see-what applied in the query.
 *
 * A report is visible to its reporter and to triagers; an `idea` is visible
 * to everyone signed in. Anything else is a 404 — the same answer as an id
 * that does not exist, so ids cannot be probed. What a visible report shows
 * each reader is ./present. Failures the routes answer with are
 * `WorkspaceError`s (~/server/workspace/errors), worded at the route.
 */

import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";

import { company } from "@launchstack/store/schema";

import { copy } from "~/i18n/copy";
import type {
    BugSeverity,
    FeedbackDetail,
    FeedbackKind,
    FeedbackListItem,
    FeedbackReply,
    FeedbackScope,
    FeedbackStatus,
    FeedbackContext,
    StoredFeedbackContext,
} from "~/lib/feedback/contract";
import { db } from "~/server/db";
import {
    feedbackAttachments,
    feedbackReplies,
    feedbackReports,
    feedbackVotes,
} from "~/server/db/schema";
import { badRequest, forbidden, notFound } from "~/server/workspace/errors";

import { feedbackEnabled } from "./access";
import { feedbackAppVersion } from "./app-version";
import type { NormalizedFeedbackImage } from "./images";
import { notifyReporter } from "./notify";
import { feedbackPeople } from "./people";
import {
    presentDetail,
    presentListItem,
    presentReply,
    seesPrivateParts,
    type FeedbackViewer,
    type ReportFacts,
} from "./present";

export type { FeedbackViewer } from "./present";

const reports = feedbackReports;

// ---------------------------------------------------------------------------
// Shared query pieces
// ---------------------------------------------------------------------------

/** Null for triagers (they see everything). */
function visibleTo(viewer: FeedbackViewer): SQL | undefined {
    if (viewer.triager) return undefined;
    return or(eq(reports.reporterUserId, viewer.authUserId), eq(reports.kind, "idea"));
}

/** `%`, `_` and the escape itself match literally; the rest is a substring. */
export function likePattern(q: string): string {
    return `%${q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

function factColumns(viewer: FeedbackViewer) {
    return {
        id: reports.id,
        kind: reports.kind,
        title: reports.title,
        status: reports.status,
        severity: reports.severity,
        votes: reports.voteCount,
        reporterUserId: reports.reporterUserId,
        companyId: reports.companyId,
        currentWorkspaceName: company.name,
        stampedWorkspaceName: sql<string | null>`${reports.context} ->> 'workspaceName'`,
        createdAt: reports.createdAt,
        lastActivityAt: reports.lastActivityAt,
        replies: sql<number>`(select count(*)::int from ${feedbackReplies} where ${feedbackReplies.reportId} = ${reports.id})`,
        attachments: sql<number>`(select count(*)::int from ${feedbackAttachments} where ${feedbackAttachments.reportId} = ${reports.id})`,
        voted: sql<boolean>`exists (select 1 from ${feedbackVotes} where ${feedbackVotes.reportId} = ${reports.id} and ${feedbackVotes.userId} = ${viewer.authUserId})`,
        lastReplyFromTeam: sql<
            boolean | null
        >`(select ${feedbackReplies.fromTeam} from ${feedbackReplies} where ${feedbackReplies.reportId} = ${reports.id} order by ${feedbackReplies.createdAt} desc, ${feedbackReplies.id} desc limit 1)`,
    };
}

type FactRow = {
    id: number;
    kind: FeedbackKind;
    title: string;
    status: FeedbackStatus;
    severity: BugSeverity | null;
    votes: number;
    reporterUserId: string;
    companyId: bigint | null;
    currentWorkspaceName: string | null;
    stampedWorkspaceName: string | null;
    createdAt: Date;
    lastActivityAt: Date;
    replies: number;
    attachments: number;
    voted: boolean;
    lastReplyFromTeam: boolean | null;
};

function toFacts(row: FactRow): ReportFacts {
    return {
        id: Number(row.id),
        kind: row.kind,
        title: row.title,
        status: row.status,
        severity: row.severity,
        votes: Number(row.votes),
        voted: Boolean(row.voted),
        reporterUserId: row.reporterUserId,
        workspaceName: row.currentWorkspaceName ?? row.stampedWorkspaceName ?? null,
        replies: Number(row.replies),
        attachments: Number(row.attachments),
        lastReplyFromTeam: row.lastReplyFromTeam,
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt,
    };
}

/** The report, if this viewer may see it; a 404 otherwise. */
async function loadVisible(viewer: FeedbackViewer, id: number) {
    const [row] = await db
        .select({
            id: reports.id,
            kind: reports.kind,
            title: reports.title,
            status: reports.status,
            severity: reports.severity,
            reporterUserId: reports.reporterUserId,
            companyId: reports.companyId,
        })
        .from(reports)
        .where(and(eq(reports.id, id), visibleTo(viewer)));
    if (!row) throw notFound();
    return { ...row, id: Number(row.id) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListFeedbackOptions {
    scope: FeedbackScope;
    kind?: FeedbackKind;
    status?: FeedbackStatus;
    q?: string;
    sort: "votes" | "recent";
    limit: number;
}

export async function listFeedback(
    viewer: FeedbackViewer,
    options: ListFeedbackOptions
): Promise<FeedbackListItem[]> {
    if (options.scope === "triage" && !viewer.triager) {
        throw forbidden(copy("errors.feedback.triagersOnly"));
    }
    const filters: (SQL | undefined)[] = [visibleTo(viewer)];
    if (options.scope === "mine") filters.push(eq(reports.reporterUserId, viewer.authUserId));
    if (options.scope === "ideas") filters.push(eq(reports.kind, "idea"));
    if (options.kind) filters.push(eq(reports.kind, options.kind));
    if (options.status) filters.push(eq(reports.status, options.status));
    const q = options.q?.trim();
    if (q) {
        const pattern = likePattern(q);
        filters.push(
            sql`(${reports.title} ilike ${pattern} escape '\\' or ${reports.body} ilike ${pattern} escape '\\')`
        );
    }

    const order =
        options.sort === "votes"
            ? [desc(reports.voteCount), desc(reports.lastActivityAt), desc(reports.id)]
            : [desc(reports.lastActivityAt), desc(reports.id)];

    const rows = (await db
        .select(factColumns(viewer))
        .from(reports)
        .leftJoin(company, eq(company.id, reports.companyId))
        .where(and(...filters))
        .orderBy(...order)
        .limit(Math.min(Math.max(options.limit, 1), 100))) as FactRow[];

    const facts = rows.map(toFacts);
    const people = viewer.triager
        ? await feedbackPeople(facts.map(report => report.reporterUserId))
        : new Map();
    return facts.map(report => presentListItem(report, viewer, people));
}

export async function getFeedbackReport(
    viewer: FeedbackViewer,
    id: number
): Promise<FeedbackDetail> {
    const [row] = (await db
        .select({
            ...factColumns(viewer),
            body: reports.body,
            context: reports.context,
        })
        .from(reports)
        .leftJoin(company, eq(company.id, reports.companyId))
        .where(and(eq(reports.id, id), visibleTo(viewer)))) as (FactRow & {
        body: string;
        context: StoredFeedbackContext | null;
    })[];
    if (!row) throw notFound();
    const report = { ...toFacts(row), body: row.body, context: row.context ?? {} };

    const [replies, attachments] = await Promise.all([
        db
            .select({
                id: feedbackReplies.id,
                authorUserId: feedbackReplies.authorUserId,
                fromTeam: feedbackReplies.fromTeam,
                body: feedbackReplies.body,
                createdAt: feedbackReplies.createdAt,
            })
            .from(feedbackReplies)
            .where(eq(feedbackReplies.reportId, id))
            .orderBy(asc(feedbackReplies.createdAt), asc(feedbackReplies.id)),
        seesPrivateParts(viewer, report)
            ? db
                  .select({
                      id: feedbackAttachments.id,
                      contentType: feedbackAttachments.contentType,
                      width: feedbackAttachments.width,
                      height: feedbackAttachments.height,
                  })
                  .from(feedbackAttachments)
                  .where(eq(feedbackAttachments.reportId, id))
                  .orderBy(asc(feedbackAttachments.id))
            : Promise.resolve([]),
    ]);

    const people = await feedbackPeople([
        report.reporterUserId,
        ...replies.map(reply => reply.authorUserId),
    ]);
    return presentDetail(
        report,
        replies.map(reply => ({ ...reply, id: Number(reply.id) })),
        attachments.map(attachment => ({ ...attachment, id: Number(attachment.id) })),
        viewer,
        people
    );
}

/** A screenshot's bytes — for the reporter and triagers only; null otherwise. */
export async function readFeedbackAttachment(
    viewer: FeedbackViewer,
    reportId: number,
    attachmentId: number
): Promise<{ contentType: string; data: Buffer } | null> {
    const [row] = await db
        .select({ contentType: feedbackAttachments.contentType, data: feedbackAttachments.data })
        .from(feedbackAttachments)
        .innerJoin(reports, eq(reports.id, feedbackAttachments.reportId))
        .where(
            and(
                eq(feedbackAttachments.id, attachmentId),
                eq(feedbackAttachments.reportId, reportId),
                viewer.triager ? undefined : eq(reports.reporterUserId, viewer.authUserId)
            )
        );
    return row ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateFeedbackInput {
    kind: FeedbackKind;
    title: string;
    body: string;
    severity?: BugSeverity;
    context: FeedbackContext;
}

export interface CreatedFeedback {
    id: number;
    kind: FeedbackKind;
    title: string;
    severity: BugSeverity | null;
}

export async function createFeedbackReport(args: {
    reporter: FeedbackViewer & { companyId: bigint | null };
    input: CreateFeedbackInput;
    images: readonly NormalizedFeedbackImage[];
}): Promise<CreatedFeedback> {
    if (!feedbackEnabled()) throw forbidden(copy("errors.feedback.disabled"));
    const { reporter, input, images } = args;
    const severity = input.kind === "bug" ? (input.severity ?? null) : null;

    let workspaceName: string | undefined;
    if (reporter.companyId !== null) {
        const [workspace] = await db
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(reporter.companyId)));
        workspaceName = workspace?.name ?? undefined;
    }
    // The client's context is parsed by the contract (unknown keys dropped);
    // these two are the server's to say.
    const context: StoredFeedbackContext = {
        ...input.context,
        appVersion: feedbackAppVersion(),
        ...(workspaceName ? { workspaceName } : {}),
    };

    const id = await db.transaction(async tx => {
        const [row] = await tx
            .insert(reports)
            .values({
                kind: input.kind,
                title: input.title,
                body: input.body,
                severity,
                reporterUserId: reporter.authUserId,
                companyId: reporter.companyId,
                context,
                // An idea starts with its author's vote.
                voteCount: input.kind === "idea" ? 1 : 0,
            })
            .returning({ id: reports.id });
        const reportId = Number(row!.id);
        if (input.kind === "idea") {
            await tx.insert(feedbackVotes).values({ reportId, userId: reporter.authUserId });
        }
        if (images.length > 0) {
            await tx.insert(feedbackAttachments).values(
                images.map(image => ({
                    reportId,
                    contentType: image.contentType,
                    width: image.width,
                    height: image.height,
                    byteSize: image.byteSize,
                    data: image.data,
                }))
            );
        }
        return reportId;
    });

    return { id, kind: input.kind, title: input.title, severity };
}

export async function updateFeedbackReport(
    viewer: FeedbackViewer,
    id: number,
    patch: { status?: FeedbackStatus; severity?: BugSeverity | null }
): Promise<FeedbackDetail> {
    if (!viewer.triager) throw forbidden(copy("errors.feedback.triagersOnly"));
    const report = await loadVisible(viewer, id);
    if (patch.severity != null && report.kind !== "bug") {
        throw badRequest(copy("errors.feedback.severityBugsOnly"));
    }

    const statusChanged = patch.status !== undefined && patch.status !== report.status;
    const values: Partial<typeof reports.$inferInsert> = {};
    if (statusChanged) values.status = patch.status;
    if (patch.severity !== undefined && report.kind === "bug") values.severity = patch.severity;

    if (Object.keys(values).length > 0) {
        await db.transaction(async tx => {
            await tx
                .update(reports)
                .set({
                    ...values,
                    ...(statusChanged
                        ? { statusChangedAt: sql`now()`, lastActivityAt: sql`now()` }
                        : {}),
                })
                .where(eq(reports.id, id));
            if (statusChanged) {
                await notifyReporter(tx, {
                    report,
                    actorUserId: viewer.authUserId,
                    detail: { event: "status", status: patch.status },
                });
            }
        });
    }
    return getFeedbackReport(viewer, id);
}

export async function replyToFeedback(
    viewer: FeedbackViewer,
    id: number,
    body: string
): Promise<FeedbackReply> {
    const report = await loadVisible(viewer, id);
    if (!seesPrivateParts(viewer, report)) throw forbidden(copy("errors.feedback.cannotReply"));

    const reply = await db.transaction(async tx => {
        const [row] = await tx
            .insert(feedbackReplies)
            .values({
                reportId: id,
                authorUserId: viewer.authUserId,
                fromTeam: viewer.triager,
                body,
            })
            .returning({
                id: feedbackReplies.id,
                authorUserId: feedbackReplies.authorUserId,
                fromTeam: feedbackReplies.fromTeam,
                body: feedbackReplies.body,
                createdAt: feedbackReplies.createdAt,
            });
        await tx
            .update(reports)
            .set({ lastActivityAt: sql`now()` })
            .where(eq(reports.id, id));
        if (viewer.triager) {
            await notifyReporter(tx, {
                report,
                actorUserId: viewer.authUserId,
                detail: { event: "reply" },
            });
        }
        return row!;
    });

    const people = await feedbackPeople([viewer.authUserId]);
    return presentReply({ ...reply, id: Number(reply.id) }, report, viewer, people);
}

/** Adds (`on`) or removes the viewer's vote. Ideas only. */
export async function setFeedbackVote(
    viewer: FeedbackViewer,
    id: number,
    on: boolean
): Promise<{ votes: number; voted: boolean }> {
    const report = await loadVisible(viewer, id);
    if (report.kind !== "idea") throw badRequest(copy("errors.feedback.votesIdeasOnly"));

    const votes = await db.transaction(async tx => {
        const changed = on
            ? await tx
                  .insert(feedbackVotes)
                  .values({ reportId: id, userId: viewer.authUserId })
                  .onConflictDoNothing()
                  .returning({ id: feedbackVotes.id })
            : await tx
                  .delete(feedbackVotes)
                  .where(
                      and(
                          eq(feedbackVotes.reportId, id),
                          eq(feedbackVotes.userId, viewer.authUserId)
                      )
                  )
                  .returning({ id: feedbackVotes.id });
        if (changed.length > 0) {
            // An increment re-reads the row under its lock: concurrent votes all count.
            const [row] = await tx
                .update(reports)
                .set({
                    voteCount: on
                        ? sql`${reports.voteCount} + 1`
                        : sql`greatest(${reports.voteCount} - 1, 0)`,
                })
                .where(eq(reports.id, id))
                .returning({ votes: reports.voteCount });
            return Number(row?.votes ?? 0);
        }
        const [row] = await tx
            .select({ votes: reports.voteCount })
            .from(reports)
            .where(eq(reports.id, id));
        return Number(row?.votes ?? 0);
    });
    return { votes, voted: on };
}
