import { createHash } from "node:crypto";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { document, documentVersions, documentSections } from "@launchstack/store/schema";
import { ContextPortErrorV0, type ContextScopeV0 } from "@launchstack/pipelines/vantage/context-v0";
import {
    emptyPersonalContextV0,
    roleDirectoryV0,
    type PersonalContextStateV0,
    type PersonalContextStoreV0,
    type SourceReadV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import { db } from "~/server/db";
import { userCompanyMemberships, users, vantageDocumentStars } from "~/server/db/schema";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { resolveDocumentScope, scopedDocumentWhere } from "~/lib/authz/scope";
import { contextDocumentIdSchema, saveContextRolesSchema } from "~/lib/vantage/personal-context";

type Database = typeof db;
export type PersonalContextTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const MAX_PERSONAL_SOURCES = 100;
export const MAX_PERSONAL_EXCERPT_CHARS = 64_000;
export const contextDigest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Each operation re-resolves membership, permissions and ACL in its database transaction. */
export async function personalContextSession(
    ctx: WorkspaceContext,
    tx: PersonalContextTransaction,
    lock = false
) {
    const membershipQuery = tx
        .select()
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, ctx.userPk),
                eq(userCompanyMemberships.companyId, ctx.companyId)
            )
        );
    const [membership] = await (lock ? membershipQuery.for("update") : membershipQuery);
    if (!membership || membership.status !== "active")
        throw new ContextPortErrorV0("Workspace access is unavailable.", 403);
    const membershipId = membership.id;
    const permissions = await resolvePermissionsForRole(ctx.companyId, membership.role, tx);
    if (!permissions.has("documents.read"))
        throw new ContextPortErrorV0("Document access is unavailable.", 403);
    const scope = await resolveDocumentScope(
        { companyId: ctx.companyId, userPk: ctx.userPk, role: membership.role, permissions },
        tx
    );
    const [person] = await tx
        .select({ title: users.title, authUserId: users.userId })
        .from(users)
        .where(eq(users.id, Number(ctx.userPk)));
    if (!person || person.authUserId !== ctx.authUserId)
        throw new ContextPortErrorV0("Profile access is unavailable.", 403);
    const actor: ContextScopeV0 = {
        companyId: String(ctx.companyId),
        principalRef: person.authUserId,
        audience: { kind: "actor", principalRef: person.authUserId },
        aclDigest: contextDigest({
            role: membership.role,
            permissions: [...permissions].sort(),
            scope,
        }),
    };
    const starRows = await tx
        .select()
        .from(vantageDocumentStars)
        .where(
            and(
                eq(vantageDocumentStars.companyId, ctx.companyId),
                eq(vantageDocumentStars.userId, ctx.userPk)
            )
        )
        .orderBy(asc(vantageDocumentStars.documentId));
    const state: PersonalContextStateV0 = {
        ...emptyPersonalContextV0(actor),
        revision: membership.vantageContextRevision,
        roles: membership.businessContextV0
            ? {
                  roleIds: membership.businessContextV0.roleIds,
                  primaryRoleId: membership.businessContextV0.primaryRoleId,
                  confirmedAt: membership.businessContextV0.confirmedAt,
              }
            : null,
        stars: starRows.map(row => ({
            documentId: String(row.documentId),
            lastKnownRef: {
                kind: "doc",
                id: String(row.documentId),
                version: String(row.lastKnownVersionId),
            },
            starredAt: row.starredAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        })),
    };
    if (!Number.isSafeInteger(state.revision) || state.revision < 0)
        throw new ContextPortErrorV0("Saved context needs repair.", 409);
    async function visibleVersion(documentId: string, asOf = new Date()) {
        if (!contextDocumentIdSchema.safeParse(documentId).success)
            throw new ContextPortErrorV0("Invalid document ID.", 400);
        const [row] = await tx
            .select({
                documentId: document.id,
                title: document.title,
                versionId: documentVersions.id,
                versionNumber: documentVersions.versionNumber,
                createdAt: documentVersions.createdAt,
            })
            .from(document)
            .innerJoin(documentVersions, eq(documentVersions.documentId, document.id))
            .where(
                and(
                    scopedDocumentWhere(ctx.companyId, scope),
                    eq(document.id, Number(documentId)),
                    lte(documentVersions.createdAt, asOf)
                )
            )
            .orderBy(
                desc(documentVersions.createdAt),
                desc(documentVersions.versionNumber),
                desc(documentVersions.id)
            )
            .limit(1);
        return row;
    }
    async function readDocument(documentId: string, asOf: string): Promise<SourceReadV0> {
        const row = await visibleVersion(documentId, new Date(asOf));
        // Same response for missing, deleted and revoked: do not disclose another workspace's records.
        if (!row) return { status: "missing" };
        const where = and(
            eq(documentSections.documentId, BigInt(documentId)),
            eq(documentSections.versionId, BigInt(row.versionId))
        );
        const [size] = await tx
            .select({
                chars: sql<number>`coalesce(sum(length(${documentSections.content})), 0)::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(documentSections)
            .where(where);
        if (!size?.count || size.chars + size.count - 1 > MAX_PERSONAL_EXCERPT_CHARS)
            return { status: "unavailable" };
        const chunks = await tx
            .select({ content: documentSections.content })
            .from(documentSections)
            .where(where)
            .orderBy(
                asc(documentSections.pageNumber),
                asc(documentSections.lineStart),
                asc(documentSections.id)
            );
        const excerpt = chunks.map(chunk => chunk.content).join("\n");
        if (!excerpt.trim() || excerpt.length > MAX_PERSONAL_EXCERPT_CHARS)
            return { status: "unavailable" };
        const version = String(row.versionId);
        return {
            status: "allowed",
            constraints: [],
            entry: {
                source: { kind: "doc", id: documentId, version },
                companyId: actor.companyId,
                audience: actor.audience,
                access: "allowed",
                aclDigest: actor.aclDigest,
                sourceDate: row.createdAt.toISOString(),
                checkedAt: new Date().toISOString(),
                excerpt,
                excerptOffsets: { start: 0, end: excerpt.length, sourceVersion: version },
            },
        };
    }
    async function listDocuments() {
        // No recency cap: old documents remain selectable. Only authorized canonical versions are shown.
        const rows = await tx
            .select({
                id: document.id,
                title: document.title,
                version: documentVersions.id,
                createdAt: documentVersions.createdAt,
            })
            .from(document)
            .innerJoin(
                documentVersions,
                and(
                    eq(document.currentVersionId, documentVersions.id),
                    eq(documentVersions.documentId, document.id)
                )
            )
            .where(scopedDocumentWhere(ctx.companyId, scope))
            .orderBy(asc(document.title), asc(document.id));
        return rows.map(row => ({
            id: String(row.id),
            title: row.title,
            version: String(row.version),
            sourceDate: row.createdAt.toISOString(),
        }));
    }
    async function persist(next: PersonalContextStateV0, expected: number) {
        if (!lock) throw new Error("Context writes require the membership lock.");
        if (state.revision !== expected) return false;
        if (
            !Number.isSafeInteger(expected) ||
            expected < 0 ||
            expected >= Number.MAX_SAFE_INTEGER ||
            next.revision !== expected + 1 ||
            next.companyId !== actor.companyId ||
            next.principalRef !== actor.principalRef ||
            next.module !== "vantage" ||
            next.version !== "joseph-personal-context-v0" ||
            new Set(next.stars.map(star => star.documentId)).size !== next.stars.length ||
            next.stars.length > MAX_PERSONAL_SOURCES
        )
            throw new ContextPortErrorV0("Invalid personal context.", 400);
        if (
            next.roles &&
            (!saveContextRolesSchema.safeParse({
                expectedRevision: expected,
                roleIds: next.roles.roleIds,
                primaryRoleId: next.roles.primaryRoleId,
            }).success ||
                !Number.isFinite(Date.parse(next.roles.confirmedAt)))
        )
            throw new ContextPortErrorV0("Invalid role selection.", 400);
        for (const star of next.stars) {
            if (
                star.lastKnownRef.kind !== "doc" ||
                star.lastKnownRef.id !== star.documentId ||
                !contextDocumentIdSchema.safeParse(star.documentId).success ||
                !contextDocumentIdSchema.safeParse(star.lastKnownRef.version).success ||
                !Number.isFinite(Date.parse(star.starredAt)) ||
                !Number.isFinite(Date.parse(star.updatedAt))
            )
                throw new ContextPortErrorV0("Invalid document selection.", 400);
            const existing = state.stars.find(saved => saved.documentId === star.documentId);
            if (!existing || JSON.stringify(existing) !== JSON.stringify(star)) {
                const visible = await visibleVersion(star.documentId);
                if (!visible || String(visible.versionId) !== star.lastKnownRef.version)
                    throw new ContextPortErrorV0(
                        "Document access or version changed. Reload before saving.",
                        409
                    );
            }
        }
        await tx
            .update(userCompanyMemberships)
            .set({
                businessContextV0: next.roles
                    ? { ...next.roles, mappingVersion: roleDirectoryV0().mapVersion }
                    : null,
                vantageContextRevision: next.revision,
            })
            .where(eq(userCompanyMemberships.id, membershipId));
        await tx
            .delete(vantageDocumentStars)
            .where(
                and(
                    eq(vantageDocumentStars.companyId, ctx.companyId),
                    eq(vantageDocumentStars.userId, ctx.userPk)
                )
            );
        if (next.stars.length)
            await tx.insert(vantageDocumentStars).values(
                next.stars.map(star => ({
                    companyId: ctx.companyId,
                    userId: ctx.userPk,
                    documentId: BigInt(star.documentId),
                    lastKnownVersionId: BigInt(star.lastKnownRef.version),
                    starredAt: new Date(star.starredAt),
                    updatedAt: new Date(star.updatedAt),
                }))
            );
        return true;
    }
    return {
        actor,
        state,
        profileTitle: membership.profileTitle ?? person.title,
        visibleVersion,
        readDocument,
        listDocuments,
        persist,
    };
}

export function createPostgresPersonalContextStoreV0(
    ctx: WorkspaceContext,
    database: Database = db
): PersonalContextStoreV0 {
    function assertActor(actor: ContextScopeV0) {
        if (actor.companyId !== String(ctx.companyId) || actor.principalRef !== ctx.authUserId)
            throw new ContextPortErrorV0("Personal context scope mismatch.", 403);
    }
    return {
        async read(actor) {
            assertActor(actor);
            return database.transaction(async tx => (await personalContextSession(ctx, tx)).state, {
                isolationLevel: "repeatable read",
                accessMode: "read only",
            });
        },
        async compareAndSwap(actor, expectedRevision, next) {
            assertActor(actor);
            return database.transaction(async tx => {
                const session = await personalContextSession(ctx, tx, true);
                return session.persist(next, expectedRevision);
            });
        },
    };
}
