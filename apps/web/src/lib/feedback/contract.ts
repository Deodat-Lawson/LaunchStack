/**
 * The feedback wire contract: what the reporter dialog sends and what the
 * Feedback tab reads back. Client-safe — the dialog validates with the same
 * schema the route parses with, so a report that passes here is accepted.
 *
 * Two kinds share one table: a `bug` is private to the person who filed it and
 * the instance's triagers; an `idea` (feature request) is on the shared board,
 * where everyone signed in can read it and vote for it, without its author's
 * name. Triagers are the instance's operators (`FEEDBACK_ADMIN_EMAILS`), not a
 * workspace role: a bug in the product is the operator's to fix, whichever
 * workspace it happened in.
 */

import { z } from "zod";

import { toolTabHref } from "~/lib/tool-app/locations";

export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ["new", "planned", "in_progress", "done", "wont_do"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** How much a bug is in the reporter's way. Ideas have none. */
export const BUG_SEVERITIES = ["blocking", "annoying", "cosmetic"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const FEEDBACK_LIMITS = {
    titleMax: 140,
    bodyMax: 8000,
    replyMax: 4000,
    attachmentsMax: 3,
    /** Per image, before it is re-encoded. */
    attachmentBytesMax: 5 * 1024 * 1024,
    attachmentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] as const,
    recentErrorsMax: 10,
    errorMessageMax: 500,
} as const;

/** One thing that went wrong in the page before the report was opened. */
export const recentErrorSchema = z.object({
    message: z.string().max(FEEDBACK_LIMITS.errorMessageMax),
    /** `error` | `unhandledrejection` | `console` */
    source: z.string().max(32).optional(),
    at: z.string().max(40),
});
export type RecentError = z.infer<typeof recentErrorSchema>;

/**
 * What the browser knew when the report was made. Every field is optional:
 * the reporter can switch technical details off, which sends only `path`.
 * The server adds `appVersion` and the workspace itself — neither is the
 * client's to claim.
 */
export const feedbackContextSchema = z.object({
    url: z.string().max(2000).optional(),
    path: z.string().max(1000).optional(),
    pageTitle: z.string().max(300).optional(),
    userAgent: z.string().max(500).optional(),
    /** "Chrome 141 on macOS" — parsed in the browser so triage reads at a glance. */
    browser: z.string().max(120).optional(),
    viewport: z
        .object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() })
        .optional(),
    screen: z
        .object({
            width: z.number().int().nonnegative(),
            height: z.number().int().nonnegative(),
            pixelRatio: z.number().positive().max(10),
        })
        .optional(),
    theme: z.enum(["light", "dark"]).optional(),
    locale: z.string().max(20).optional(),
    timeZone: z.string().max(64).optional(),
    recentErrors: z.array(recentErrorSchema).max(FEEDBACK_LIMITS.recentErrorsMax).optional(),
    /**
     * Where the report came from when something prefilled it: an error
     * screen's digest, a failed source's job id and document.
     */
    origin: z.record(z.string().max(40), z.string().max(300)).optional(),
});
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

/** The server's additions, stored beside what the browser sent. */
export interface StoredFeedbackContext extends FeedbackContext {
    appVersion?: string;
    workspaceName?: string;
}

/**
 * `POST /api/feedback` is multipart: this object as JSON in the `payload`
 * field, and up to `attachmentsMax` images in `files`.
 */
export const createFeedbackSchema = z.object({
    kind: z.enum(FEEDBACK_KINDS),
    title: z.string().trim().min(1).max(FEEDBACK_LIMITS.titleMax),
    body: z.string().trim().max(FEEDBACK_LIMITS.bodyMax).default(""),
    severity: z.enum(BUG_SEVERITIES).optional(),
    context: feedbackContextSchema.default({}),
});
export type CreateFeedbackInput = z.input<typeof createFeedbackSchema>;

export const updateFeedbackSchema = z
    .object({
        status: z.enum(FEEDBACK_STATUSES).optional(),
        severity: z.enum(BUG_SEVERITIES).nullable().optional(),
    })
    .refine(v => v.status !== undefined || v.severity !== undefined);

export const replyFeedbackSchema = z.object({
    body: z.string().trim().min(1).max(FEEDBACK_LIMITS.replyMax),
});

/** `GET /api/feedback?scope=…` */
export const FEEDBACK_SCOPES = ["mine", "ideas", "triage"] as const;
export type FeedbackScope = (typeof FEEDBACK_SCOPES)[number];

export const listFeedbackQuerySchema = z.object({
    scope: z.enum(FEEDBACK_SCOPES),
    kind: z.enum(FEEDBACK_KINDS).optional(),
    status: z.enum(FEEDBACK_STATUSES).optional(),
    /** Matched against title and body. Also how the dialog finds similar ideas. */
    q: z.string().trim().max(200).optional(),
    sort: z.enum(["votes", "recent"]).default("recent"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Who someone is, as the Feedback tab shows them. */
export interface FeedbackPerson {
    name: string;
    /** Only triagers are sent the email. */
    email?: string;
}

export interface FeedbackListItem {
    id: number;
    kind: FeedbackKind;
    title: string;
    status: FeedbackStatus;
    severity: BugSeverity | null;
    votes: number;
    /** Whether the person asking has voted for it. */
    voted: boolean;
    /** Whether the person asking filed it. */
    mine: boolean;
    replies: number;
    attachments: number;
    createdAt: string;
    /** The newest reply or status change, else `createdAt`. */
    updatedAt: string;
    /** Triage only: who filed it and from which workspace. */
    reporter?: FeedbackPerson;
    workspaceName?: string | null;
    /** Triage only: the last word in the thread is the reporter's. */
    awaitingReply?: boolean;
}

export interface FeedbackReply {
    id: number;
    body: string;
    /** Written by a triager — the tab labels it as the team's. */
    fromTeam: boolean;
    mine: boolean;
    author: FeedbackPerson;
    createdAt: string;
}

export interface FeedbackAttachment {
    id: number;
    /** Same-origin, auth-gated: `/api/feedback/<id>/attachments/<attachmentId>`. */
    url: string;
    contentType: string;
    width: number | null;
    height: number | null;
}

export interface FeedbackDetail extends FeedbackListItem {
    body: string;
    /**
     * The reporter and triagers see these. Someone reading another person's
     * idea on the board does not: a page URL or a screenshot can show their
     * workspace.
     */
    context?: StoredFeedbackContext;
    attachmentList?: FeedbackAttachment[];
    thread: FeedbackReply[];
    /** The person asking may reply (the reporter, or a triager). */
    canReply: boolean;
    /** The person asking may change status and severity. */
    canTriage: boolean;
}

/** `GET /api/feedback/me` — whether to show the reporter at all, and Triage. */
export interface FeedbackAccess {
    /** False while the instance has named no triager: nobody would read it. */
    enabled: boolean;
    triager: boolean;
}

/** Where the Feedback tab shows a report: `/employer/documents?feature=feedback&at=<path>`. */
export const FEEDBACK_TOOL_ID = "feedback";
export type FeedbackScreen = "mine" | "ideas" | "triage";
export function feedbackReportPath(id: number, from: FeedbackScreen = "mine"): string {
    return `/${from}/${id}`;
}
export function feedbackReportHref(id: number, from: FeedbackScreen = "mine"): string {
    return toolTabHref(FEEDBACK_TOOL_ID, feedbackReportPath(id, from));
}

/** `workspace_notifications` rows about feedback use these. */
export const FEEDBACK_NOTIFICATION_KIND = "feedback";
export const FEEDBACK_NOTIFICATION_TARGET = "feedback";
export interface FeedbackNotificationDetail {
    event: "reply" | "status";
    status?: FeedbackStatus;
}
