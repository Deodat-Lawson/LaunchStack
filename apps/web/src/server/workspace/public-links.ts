/**
 * Public links (ADR-016): a secret URL that opens one file for anyone who has
 * it, without signing in — to send to someone outside the workspace or to
 * paste into an AI agent.
 *
 * The rules, all here:
 * - Only someone who may manage the file's access (`canManageDocument`, the
 *   Share dialog's own test) makes, changes or turns off its link.
 * - One live link per file. Turning it off keeps the row, so making a new
 *   one mints a new token and the old URL stays dead.
 * - The workspace switch `sharing.publicLinks` (on by default) gates both
 *   making a link and every public read (`resolvePublicLink`). Off, nothing
 *   opens; on again, the links that were live open again.
 * - A link is live while it is not turned off, not past `expires_at`, and
 *   its file still exists (the row cascades with the document).
 *
 * The public read side is `~/server/public-share`; it only ever starts from
 * `resolvePublicLink(token)`.
 */

import { randomBytes } from "node:crypto";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { copy } from "~/i18n/copy";
import { recordAuditEvent } from "~/lib/authz/audit";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { PUBLIC_LINK_TOKEN_PATTERN } from "~/lib/public-link-paths";
import { PUBLIC_LINKS_SETTING } from "~/lib/settings/registry";
import { db } from "~/server/db";
import { documentPublicLinks, type DocumentPublicLink } from "~/server/db/schema";
import { readWorkspaceSetting } from "~/server/settings/store";

import { recordActivity } from "./activity";
import { forbidden, notFound } from "./errors";
import { canManageDocument } from "./item-access";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** How long a new link lasts; null = until it is turned off. */
export const PUBLIC_LINK_EXPIRY_DAYS = [null, 7, 30] as const;
export type PublicLinkExpiryDays = (typeof PUBLIC_LINK_EXPIRY_DAYS)[number];

export function isPublicLinkExpiryDays(value: unknown): value is PublicLinkExpiryDays {
    return (PUBLIC_LINK_EXPIRY_DAYS as readonly unknown[]).includes(value);
}

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export function newPublicLinkToken(): string {
    return randomBytes(32).toString("base64url");
}

/** The shape a token must have before it is looked up at all. */
const TOKEN_RE = new RegExp(`^${PUBLIC_LINK_TOKEN_PATTERN}$`);
export function isPublicLinkToken(value: string): boolean {
    return TOKEN_RE.test(value);
}

/** The page people open, and the same file as Markdown for an agent. */
export function publicLinkUrls(
    origin: string,
    token: string
): { url: string; markdownUrl: string } {
    const base = origin.replace(/\/+$/, "");
    return { url: `${base}/s/${token}`, markdownUrl: `${base}/s/${token}.md` };
}

/** Whether the workspace lets public links open. On by default. */
export async function publicLinksOn(companyId: bigint): Promise<boolean> {
    return (await readWorkspaceSetting<boolean>(companyId, PUBLIC_LINKS_SETTING)) !== false;
}

/** Live means not turned off and not expired; the workspace switch is checked separately. */
function liveWhere(now = new Date()) {
    return and(
        isNull(documentPublicLinks.revokedAt),
        or(isNull(documentPublicLinks.expiresAt), gt(documentPublicLinks.expiresAt, now))
    );
}

function expiresAtFor(days: PublicLinkExpiryDays, from = new Date()): Date | null {
    return days === null ? null : new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// What the Share dialog reads
// ---------------------------------------------------------------------------

export interface PublicLinkView {
    url: string;
    markdownUrl: string;
    allowDownload: boolean;
    /** ISO time, or null for never. */
    expiresAt: string | null;
    createdAt: string;
    /** Auth id of whoever made it. */
    createdBy: string;
}

export interface PublicLinkState {
    /** The live link, or null when there is none (never made, turned off, or expired). */
    link: PublicLinkView | null;
    /** May this person make, change or turn off the link. */
    canManage: boolean;
    /** The workspace switch. Off, no link opens and none can be made. */
    enabled: boolean;
}

interface DocumentRef {
    id: number;
    title: string;
    category: string;
}

async function loadVisibleDocument(
    ctx: WorkspaceContext,
    documentId: number
): Promise<DocumentRef> {
    const scope = await ctx.documentScope();
    const [row] = await db
        .select({ id: document.id, title: document.title, category: document.category })
        .from(document)
        .where(and(scopedDocumentWhere(ctx.companyId, scope), eq(document.id, documentId)))
        .limit(1);
    if (!row) throw notFound(copy("team.server.errors.documentNotFound"));
    return { id: Number(row.id), title: row.title, category: row.category };
}

async function liveLinkRow(documentId: number): Promise<DocumentPublicLink | null> {
    const [row] = await db
        .select()
        .from(documentPublicLinks)
        .where(and(eq(documentPublicLinks.documentId, BigInt(documentId)), liveWhere()))
        .limit(1);
    return row ?? null;
}

function toView(row: DocumentPublicLink, origin: string): PublicLinkView {
    return {
        ...publicLinkUrls(origin, row.token),
        allowDownload: row.allowDownload,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdBy,
    };
}

/** The file's live link for anyone who can open the file; only managers may change it. */
export async function getPublicLinkState(
    ctx: WorkspaceContext,
    documentId: number,
    origin: string
): Promise<PublicLinkState> {
    const doc = await loadVisibleDocument(ctx, documentId);
    const [row, canManage, enabled] = await Promise.all([
        liveLinkRow(doc.id),
        canManageDocument(ctx, doc),
        publicLinksOn(ctx.companyId),
    ]);
    return { link: row ? toView(row, origin) : null, canManage, enabled };
}

async function requireManager(ctx: WorkspaceContext, documentId: number): Promise<DocumentRef> {
    const doc = await loadVisibleDocument(ctx, documentId);
    if (!(await canManageDocument(ctx, doc))) {
        throw forbidden(copy("team.server.errors.cannotChangePublicLink"));
    }
    return doc;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface PublicLinkInput {
    allowDownload?: boolean;
    expiresInDays?: PublicLinkExpiryDays;
}

/**
 * Make the file's public link, or hand back the live one (with any settings
 * given applied), so a double click never mints two URLs.
 */
export async function createPublicLink(
    ctx: WorkspaceContext,
    documentId: number,
    input: PublicLinkInput,
    origin: string
): Promise<PublicLinkState> {
    const doc = await requireManager(ctx, documentId);
    if (!(await publicLinksOn(ctx.companyId))) {
        throw forbidden(copy("team.server.errors.publicLinksOff"), { code: "public_links_off" });
    }

    const existing = await liveLinkRow(doc.id);
    if (existing) {
        if (input.allowDownload !== undefined || input.expiresInDays !== undefined) {
            return updatePublicLink(ctx, documentId, input, origin);
        }
        return { link: toView(existing, origin), canManage: true, enabled: true };
    }

    await db.transaction(async tx => {
        // An expired link still holds the "one live row" slot in the unique
        // index (it only knows `revoked_at`); retire it before minting.
        await tx
            .update(documentPublicLinks)
            .set({ revokedAt: new Date(), revokedBy: ctx.authUserId, updatedAt: new Date() })
            .where(
                and(
                    eq(documentPublicLinks.documentId, BigInt(doc.id)),
                    isNull(documentPublicLinks.revokedAt)
                )
            );
        await tx.insert(documentPublicLinks).values({
            companyId: ctx.companyId,
            documentId: BigInt(doc.id),
            token: newPublicLinkToken(),
            allowDownload: input.allowDownload ?? true,
            expiresAt: expiresAtFor(input.expiresInDays ?? null),
            createdBy: ctx.authUserId,
        });
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "document.public_link_created",
            targetType: "document",
            targetId: doc.id,
            detail: {
                title: doc.title,
                allowDownload: input.allowDownload ?? true,
                expiresInDays: input.expiresInDays ?? null,
            },
        });
        await recordActivity(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            verb: "shared",
            targetType: "document",
            targetId: doc.id,
            targetLabel: doc.title,
            targetPath: doc.category,
            detail: { publicLink: true },
        });
    });

    return getPublicLinkState(ctx, documentId, origin);
}

/** Change the live link's download switch or expiry (counted from now). */
export async function updatePublicLink(
    ctx: WorkspaceContext,
    documentId: number,
    input: PublicLinkInput,
    origin: string
): Promise<PublicLinkState> {
    const doc = await requireManager(ctx, documentId);
    const existing = await liveLinkRow(doc.id);
    if (!existing) throw notFound(copy("team.server.errors.noPublicLink"));

    const set: Partial<DocumentPublicLink> = { updatedAt: new Date() };
    if (input.allowDownload !== undefined) set.allowDownload = input.allowDownload;
    if (input.expiresInDays !== undefined) set.expiresAt = expiresAtFor(input.expiresInDays);

    await db.transaction(async tx => {
        await tx
            .update(documentPublicLinks)
            .set(set)
            .where(eq(documentPublicLinks.id, existing.id));
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "document.public_link_updated",
            targetType: "document",
            targetId: doc.id,
            detail: {
                title: doc.title,
                ...(input.allowDownload !== undefined
                    ? { allowDownload: input.allowDownload }
                    : {}),
                ...(input.expiresInDays !== undefined
                    ? { expiresInDays: input.expiresInDays }
                    : {}),
            },
        });
    });

    return getPublicLinkState(ctx, documentId, origin);
}

/** Turn the link off. The URL stops opening at once and never opens again. */
export async function revokePublicLink(
    ctx: WorkspaceContext,
    documentId: number,
    origin: string
): Promise<PublicLinkState> {
    const doc = await requireManager(ctx, documentId);
    await db.transaction(async tx => {
        const revoked = await tx
            .update(documentPublicLinks)
            .set({ revokedAt: new Date(), revokedBy: ctx.authUserId, updatedAt: new Date() })
            .where(
                and(
                    eq(documentPublicLinks.documentId, BigInt(doc.id)),
                    isNull(documentPublicLinks.revokedAt)
                )
            )
            .returning({ id: documentPublicLinks.id });
        if (revoked.length === 0) return;
        await recordAuditEvent(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            action: "document.public_link_revoked",
            targetType: "document",
            targetId: doc.id,
            detail: { title: doc.title },
        });
        await recordActivity(tx, {
            companyId: ctx.companyId,
            actorUserId: ctx.authUserId,
            verb: "unshared",
            targetType: "document",
            targetId: doc.id,
            targetLabel: doc.title,
            targetPath: doc.category,
            detail: { publicLink: true },
        });
    });
    return getPublicLinkState(ctx, documentId, origin);
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/** Of these documents, the ones with a live public link (for the globe in Sources). */
export async function documentIdsWithPublicLinks(
    companyId: bigint,
    documentIds: readonly number[]
): Promise<Set<number>> {
    if (documentIds.length === 0) return new Set();
    if (!(await publicLinksOn(companyId))) return new Set();
    const rows = await db
        .select({ documentId: documentPublicLinks.documentId })
        .from(documentPublicLinks)
        .where(
            and(
                eq(documentPublicLinks.companyId, companyId),
                inArray(
                    documentPublicLinks.documentId,
                    documentIds.map(id => BigInt(id))
                ),
                liveWhere()
            )
        );
    return new Set(rows.map(r => Number(r.documentId)));
}

// ---------------------------------------------------------------------------
// The public read side's one entry point
// ---------------------------------------------------------------------------

export interface ResolvedPublicLink {
    linkId: number;
    token: string;
    companyId: bigint;
    documentId: number;
    allowDownload: boolean;
    expiresAt: Date | null;
}

/**
 * The live link behind a token, or null: unknown, turned off, expired, its
 * file gone, or the workspace has public links off. Every public route and
 * the public page start here and answer the same 404 for all of them.
 */
export async function resolvePublicLink(token: string): Promise<ResolvedPublicLink | null> {
    if (!isPublicLinkToken(token)) return null;
    const [row] = await db
        .select({
            id: documentPublicLinks.id,
            token: documentPublicLinks.token,
            companyId: documentPublicLinks.companyId,
            documentId: documentPublicLinks.documentId,
            allowDownload: documentPublicLinks.allowDownload,
            expiresAt: documentPublicLinks.expiresAt,
        })
        .from(documentPublicLinks)
        .innerJoin(
            document,
            and(
                eq(document.id, documentPublicLinks.documentId),
                eq(document.companyId, documentPublicLinks.companyId)
            )
        )
        .where(and(eq(documentPublicLinks.token, token), liveWhere()))
        .limit(1);
    if (!row) return null;
    if (!(await publicLinksOn(row.companyId))) return null;
    return {
        linkId: row.id,
        token: row.token,
        companyId: row.companyId,
        documentId: Number(row.documentId),
        allowDownload: row.allowDownload,
        expiresAt: row.expiresAt,
    };
}
