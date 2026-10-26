import "server-only";

/**
 * What each person is shown of a report — the visibility rules, as pure
 * functions over rows the store has already read (so they are tested
 * without a database).
 *
 * - Triagers see everything: who filed it (name and email), from which
 *   workspace, whether the thread waits on the team, the context and the
 *   screenshots.
 * - The reporter sees their own report in full, less the triage-only fields.
 * - Anyone else reading an idea on the board sees the idea, its votes and its
 *   thread — never who filed it, its context or its screenshots (a page URL or
 *   a screenshot can show their workspace). The reporter's replies come back
 *   with an empty name (the tab says "Requester"); the team's carry the
 *   triager's name.
 *
 * Emails are only ever sent to triagers. Who may see a report at all is the
 * store's query, not this module.
 */

import type {
    BugSeverity,
    FeedbackAttachment,
    FeedbackDetail,
    FeedbackKind,
    FeedbackListItem,
    FeedbackPerson,
    FeedbackReply,
    FeedbackStatus,
    StoredFeedbackContext,
} from "~/lib/feedback/contract";

import type { FeedbackPersonRecord } from "./people";

export interface FeedbackViewer {
    /** Auth subject id. */
    authUserId: string;
    triager: boolean;
}

/** One report as the list query reads it. */
export interface ReportFacts {
    id: number;
    kind: FeedbackKind;
    title: string;
    status: FeedbackStatus;
    severity: BugSeverity | null;
    votes: number;
    voted: boolean;
    reporterUserId: string;
    /** The workspace's current name, else the name stamped when it was filed. */
    workspaceName: string | null;
    replies: number;
    attachments: number;
    /** Null when nobody has replied. */
    lastReplyFromTeam: boolean | null;
    createdAt: Date;
    lastActivityAt: Date;
}

export interface ReportDetailFacts extends ReportFacts {
    body: string;
    context: StoredFeedbackContext;
}

export interface ReplyFacts {
    id: number;
    authorUserId: string;
    fromTeam: boolean;
    body: string;
    createdAt: Date;
}

export interface AttachmentFacts {
    id: number;
    contentType: string;
    width: number | null;
    height: number | null;
}

export type People = ReadonlyMap<string, FeedbackPersonRecord>;

export function feedbackAttachmentUrl(reportId: number, attachmentId: number): string {
    return `/api/feedback/${reportId}/attachments/${attachmentId}`;
}

function isReporter(viewer: FeedbackViewer, report: Pick<ReportFacts, "reporterUserId">): boolean {
    return report.reporterUserId === viewer.authUserId;
}

/** Sees the context and the screenshots: the reporter and triagers. */
export function seesPrivateParts(
    viewer: FeedbackViewer,
    report: Pick<ReportFacts, "reporterUserId">
): boolean {
    return viewer.triager || isReporter(viewer, report);
}

function person(people: People, authUserId: string, withEmail: boolean): FeedbackPerson {
    const record = people.get(authUserId);
    const name = record?.name ?? "";
    return withEmail ? { name, email: record?.email ?? "" } : { name };
}

/** The last word in the thread is the reporter's — or nobody has answered a new report yet. */
export function awaitingReply(report: Pick<ReportFacts, "lastReplyFromTeam" | "status">): boolean {
    return report.lastReplyFromTeam === null
        ? report.status === "new"
        : report.lastReplyFromTeam === false;
}

export function presentListItem(
    report: ReportFacts,
    viewer: FeedbackViewer,
    people: People
): FeedbackListItem {
    const item: FeedbackListItem = {
        id: report.id,
        kind: report.kind,
        title: report.title,
        status: report.status,
        severity: report.kind === "bug" ? report.severity : null,
        votes: report.votes,
        voted: report.voted,
        mine: isReporter(viewer, report),
        replies: report.replies,
        attachments: seesPrivateParts(viewer, report) ? report.attachments : 0,
        createdAt: report.createdAt.toISOString(),
        updatedAt: report.lastActivityAt.toISOString(),
    };
    if (viewer.triager) {
        item.reporter = person(people, report.reporterUserId, true);
        item.workspaceName = report.workspaceName;
        item.awaitingReply = awaitingReply(report);
    }
    return item;
}

export function presentReply(
    reply: ReplyFacts,
    report: Pick<ReportFacts, "reporterUserId">,
    viewer: FeedbackViewer,
    people: People
): FeedbackReply {
    const known = reply.fromTeam || seesPrivateParts(viewer, report);
    return {
        id: reply.id,
        body: reply.body,
        fromTeam: reply.fromTeam,
        mine: reply.authorUserId === viewer.authUserId,
        author: known ? person(people, reply.authorUserId, viewer.triager) : { name: "" },
        createdAt: reply.createdAt.toISOString(),
    };
}

export function presentDetail(
    report: ReportDetailFacts,
    replies: readonly ReplyFacts[],
    attachments: readonly AttachmentFacts[],
    viewer: FeedbackViewer,
    people: People
): FeedbackDetail {
    const privileged = seesPrivateParts(viewer, report);
    const detail: FeedbackDetail = {
        ...presentListItem(report, viewer, people),
        body: report.body,
        thread: replies.map(reply => presentReply(reply, report, viewer, people)),
        canReply: privileged,
        canTriage: viewer.triager,
    };
    if (privileged) {
        detail.context = report.context;
        detail.attachmentList = attachments.map(
            (attachment): FeedbackAttachment => ({
                id: attachment.id,
                url: feedbackAttachmentUrl(report.id, attachment.id),
                contentType: attachment.contentType,
                width: attachment.width,
                height: attachment.height,
            })
        );
    }
    return detail;
}
