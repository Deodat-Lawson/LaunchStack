/**
 * Profile reads and writes.
 *
 * The profile lives on the product `users` row (one per person); the
 * per-workspace override lives on the membership row plus a
 * `profile_images` row keyed by (user, company). Resolution rules are in
 * `~/lib/profile/resolve` so the client and server agree on them.
 */

import { randomBytes } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { profileImages, userCompanyMemberships, users } from "~/server/db/schema";
import type { ProfilePatch, ProfileScope, WorkspaceProfilePatch } from "~/lib/profile/fields";
import {
    profileImageUrl,
    resolveProfile,
    type MyProfile,
    type PersonLook,
    type ProfileFields,
    type WorkspaceProfileOverride,
} from "~/lib/profile/resolve";
import { conflict, notFound } from "~/server/workspace/errors";

import type { NormalizedPhoto } from "./photo";

/** Who is asking, and in which workspace (null before they have one). */
export interface ProfileCaller {
    userPk: bigint;
    authUserId: string;
    companyId: bigint | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function photoIds(
    userPk: bigint,
    companyId: bigint | null
): Promise<{ global: string | null; workspace: string | null }> {
    const rows = await db
        .select({ id: profileImages.id, companyId: profileImages.companyId })
        .from(profileImages)
        .where(
            and(
                eq(profileImages.userId, userPk),
                companyId === null
                    ? isNull(profileImages.companyId)
                    : sql`(${profileImages.companyId} is null or ${profileImages.companyId} = ${companyId})`
            )
        );
    return {
        global: rows.find(row => row.companyId === null)?.id ?? null,
        workspace: rows.find(row => row.companyId !== null)?.id ?? null,
    };
}

export async function loadMyProfile(caller: ProfileCaller): Promise<MyProfile> {
    const [person] = await db
        .select({
            name: users.name,
            email: users.email,
            displayName: users.displayName,
            title: users.title,
            pronouns: users.pronouns,
            timeZone: users.timeZone,
            bio: users.bio,
        })
        .from(users)
        .where(eq(users.id, Number(caller.userPk)));
    if (!person) throw notFound("No profile yet.");

    const photos = await photoIds(caller.userPk, caller.companyId);
    const profile: ProfileFields = { ...person, avatarUrl: profileImageUrl(photos.global) };

    let workspace: MyProfile["workspace"] = null;
    if (caller.companyId !== null) {
        const [membership] = await db
            .select({
                displayName: userCompanyMemberships.profileDisplayName,
                title: userCompanyMemberships.profileTitle,
                workspaceName: company.name,
            })
            .from(userCompanyMemberships)
            .innerJoin(company, eq(company.id, userCompanyMemberships.companyId))
            .where(
                and(
                    eq(userCompanyMemberships.userId, caller.userPk),
                    eq(userCompanyMemberships.companyId, caller.companyId)
                )
            );
        if (membership) {
            workspace = {
                id: caller.companyId.toString(),
                name: membership.workspaceName,
                override: {
                    displayName: membership.displayName,
                    title: membership.title,
                    avatarUrl: profileImageUrl(photos.workspace),
                },
            };
        }
    }

    return {
        profile,
        workspace,
        effective: resolveProfile(profile, workspace?.override ?? null),
    };
}

/**
 * Each member's photo ids for one workspace, for list views. The caller
 * resolves them with the membership's text overrides via `resolveProfile`.
 */
export async function memberPhotoIds(
    companyId: bigint,
    userPks: readonly bigint[]
): Promise<Map<string, { global: string | null; workspace: string | null }>> {
    const out = new Map<string, { global: string | null; workspace: string | null }>();
    if (userPks.length === 0) return out;
    const rows = await db
        .select({
            id: profileImages.id,
            userId: profileImages.userId,
            companyId: profileImages.companyId,
        })
        .from(profileImages)
        .where(
            and(
                inArray(profileImages.userId, [...userPks]),
                sql`(${profileImages.companyId} is null or ${profileImages.companyId} = ${companyId})`
            )
        );
    for (const row of rows) {
        const key = row.userId.toString();
        const entry = out.get(key) ?? { global: null, workspace: null };
        if (row.companyId === null) entry.global = row.id;
        else entry.workspace = row.id;
        out.set(key, entry);
    }
    return out;
}

/** Turns a member row's pieces into the override `resolveProfile` takes. */
export function overrideFrom(
    text: { displayName: string | null; title: string | null },
    workspacePhotoId: string | null
): WorkspaceProfileOverride {
    return { ...text, avatarUrl: profileImageUrl(workspacePhotoId) };
}

/** What `lookFromRow` needs: a `users` row plus the membership's override text. */
export interface LookRow {
    authUserId: string;
    name: string;
    email: string;
    displayName: string | null;
    title: string | null;
    pronouns: string | null;
    timeZone: string | null;
    bio: string | null;
    workspaceDisplayName: string | null;
    workspaceTitle: string | null;
    /** Has a membership (any status) in the workspace being rendered. */
    member: boolean;
}

/**
 * One person as one workspace sees them. Someone who has left keeps their
 * name but loses the photo and any override: the image route would refuse
 * the photo, and the override went with the membership.
 */
export function lookFromRow(
    row: LookRow,
    photos: { global: string | null; workspace: string | null } | undefined
): PersonLook {
    const look = resolveProfile(
        {
            name: row.name,
            email: row.email,
            displayName: row.displayName,
            title: row.title,
            pronouns: row.pronouns,
            timeZone: row.timeZone,
            bio: row.bio,
            avatarUrl: row.member ? profileImageUrl(photos?.global) : null,
        },
        row.member
            ? overrideFrom(
                  { displayName: row.workspaceDisplayName, title: row.workspaceTitle },
                  photos?.workspace ?? null
              )
            : null
    );
    return {
        authUserId: row.authUserId,
        name: look.name,
        email: look.email,
        displayName: look.displayName,
        title: look.title,
        pronouns: look.pronouns,
        avatarUrl: look.avatarUrl,
        member: row.member,
    };
}

/** Most ids any one surface asks about at once (a page of audit events, a meeting). */
export const LOOKS_MAX_IDS = 200;

/**
 * How each of these people appears in one workspace, keyed by auth subject
 * id — the id audit events, presence rows, meeting messages and document
 * views already store. Unknown ids are simply absent.
 */
export async function workspaceLooks(
    companyId: bigint,
    authUserIds: Iterable<string | null | undefined>
): Promise<Map<string, PersonLook>> {
    const ids = [...new Set([...authUserIds].filter((id): id is string => Boolean(id)))].slice(
        0,
        LOOKS_MAX_IDS
    );
    const out = new Map<string, PersonLook>();
    if (ids.length === 0) return out;

    const rows = await db
        .select({
            userPk: users.id,
            authUserId: users.userId,
            name: users.name,
            email: users.email,
            displayName: users.displayName,
            title: users.title,
            pronouns: users.pronouns,
            timeZone: users.timeZone,
            bio: users.bio,
            workspaceDisplayName: userCompanyMemberships.profileDisplayName,
            workspaceTitle: userCompanyMemberships.profileTitle,
            membershipId: userCompanyMemberships.id,
        })
        .from(users)
        .leftJoin(
            userCompanyMemberships,
            and(
                eq(userCompanyMemberships.userId, users.id),
                eq(userCompanyMemberships.companyId, companyId)
            )
        )
        .where(inArray(users.userId, ids));

    const photos = await memberPhotoIds(
        companyId,
        rows.filter(row => row.membershipId !== null).map(row => BigInt(row.userPk))
    );
    for (const row of rows) {
        out.set(
            row.authUserId,
            lookFromRow(
                { ...row, member: row.membershipId !== null },
                photos.get(String(row.userPk))
            )
        );
    }
    return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function updateProfile(
    caller: ProfileCaller,
    patch: ProfilePatch
): Promise<MyProfile> {
    const values = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
    ) as Partial<typeof users.$inferInsert>;
    if (Object.keys(values).length > 0) {
        await db
            .update(users)
            .set(values)
            .where(eq(users.id, Number(caller.userPk)));
    }
    return loadMyProfile(caller);
}

function requireWorkspace(caller: ProfileCaller): bigint {
    if (caller.companyId === null) throw notFound("Open a workspace first.");
    return caller.companyId;
}

export async function updateWorkspaceOverride(
    caller: ProfileCaller,
    patch: WorkspaceProfilePatch
): Promise<MyProfile> {
    const companyId = requireWorkspace(caller);
    const values: Partial<typeof userCompanyMemberships.$inferInsert> = {};
    if (patch.displayName !== undefined) values.profileDisplayName = patch.displayName;
    if (patch.title !== undefined) values.profileTitle = patch.title;
    if (Object.keys(values).length > 0) {
        await db
            .update(userCompanyMemberships)
            .set(values)
            .where(
                and(
                    eq(userCompanyMemberships.userId, caller.userPk),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );
    }
    return loadMyProfile(caller);
}

/** Back to "use my profile" in the active workspace: text and photo. */
export async function clearWorkspaceOverride(caller: ProfileCaller): Promise<MyProfile> {
    const companyId = requireWorkspace(caller);
    await db.transaction(async tx => {
        await tx
            .update(userCompanyMemberships)
            .set({ profileDisplayName: null, profileTitle: null })
            .where(
                and(
                    eq(userCompanyMemberships.userId, caller.userPk),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            );
        await tx
            .delete(profileImages)
            .where(
                and(eq(profileImages.userId, caller.userPk), eq(profileImages.companyId, companyId))
            );
    });
    return loadMyProfile(caller);
}

function scopeFilter(caller: ProfileCaller, scope: ProfileScope) {
    const owner = eq(profileImages.userId, caller.userPk);
    return scope === "global"
        ? and(owner, isNull(profileImages.companyId))
        : and(owner, eq(profileImages.companyId, requireWorkspace(caller)));
}

/** Random and URL-safe: the id is the image's whole URL, so it must not be guessable. */
export function newProfileImageId(): string {
    return randomBytes(16).toString("base64url");
}

function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "23505"
    );
}

/** Replaces the photo for a scope. A new id every time keeps image URLs immutable. */
export async function replaceProfilePhoto(
    caller: ProfileCaller,
    scope: ProfileScope,
    photo: NormalizedPhoto
): Promise<MyProfile> {
    const companyId = scope === "workspace" ? requireWorkspace(caller) : null;
    try {
        await db.transaction(async tx => {
            await tx.delete(profileImages).where(scopeFilter(caller, scope));
            await tx.insert(profileImages).values({
                id: newProfileImageId(),
                userId: caller.userPk,
                companyId,
                mimeType: photo.mimeType,
                data: photo.data,
                byteSize: photo.byteSize,
                width: photo.width,
                height: photo.height,
            });
        });
    } catch (error) {
        // Two uploads raced for the same slot; the other one won.
        if (isUniqueViolation(error)) throw conflict("Another upload just finished. Try again.");
        throw error;
    }
    return loadMyProfile(caller);
}

export async function removeProfilePhoto(
    caller: ProfileCaller,
    scope: ProfileScope
): Promise<MyProfile> {
    await db.delete(profileImages).where(scopeFilter(caller, scope));
    return loadMyProfile(caller);
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

export async function readProfileImage(id: string) {
    const [image] = await db
        .select({
            id: profileImages.id,
            userId: profileImages.userId,
            companyId: profileImages.companyId,
            mimeType: profileImages.mimeType,
            data: profileImages.data,
        })
        .from(profileImages)
        .where(eq(profileImages.id, id));
    return image ?? null;
}

const viewerMembership = alias(userCompanyMemberships, "viewer_membership");
const ownerMembership = alias(userCompanyMemberships, "owner_membership");

/**
 * Who may see a photo. Yourself, always. A workspace photo: active members
 * of that workspace. Your own photo: anyone active in a workspace you share
 * *where you have no workspace photo* — an override replaces the photo
 * there, so that workspace never gets the other one's URL.
 */
export async function canViewProfileImage(
    viewerPk: bigint,
    image: { userId: bigint; companyId: bigint | null }
): Promise<boolean> {
    if (viewerPk === image.userId) return true;

    const shared = and(
        eq(viewerMembership.userId, viewerPk),
        eq(viewerMembership.status, "active"),
        eq(ownerMembership.userId, image.userId)
    );
    const where =
        image.companyId !== null
            ? and(shared, eq(viewerMembership.companyId, image.companyId))
            : and(
                  shared,
                  sql`not exists (
                      select 1 from ${profileImages}
                      where ${profileImages.userId} = ${image.userId}
                        and ${profileImages.companyId} = ${viewerMembership.companyId}
                  )`
              );

    const rows = await db
        .select({ one: sql<number>`1` })
        .from(viewerMembership)
        .innerJoin(ownerMembership, eq(ownerMembership.companyId, viewerMembership.companyId))
        .where(where)
        .limit(1);
    return rows.length > 0;
}
