/** @jest-environment node */

/**
 * Profile store against a real, migrated Postgres: the migration itself, the
 * one-photo-per-scope rule, per-workspace resolution in the member list, and
 * — the part that is a privacy boundary — who may fetch which photo.
 *
 * Cast: Ada is in workspaces A and B and has a profile photo plus a photo for
 * B. Bob shares A with her; Cai shares B; Dee shares nothing.
 */

import type { DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { and, eq } from "drizzle-orm";

import { buildWorkspaceContext } from "~/lib/require-workspace-context";
import { profileImages, userCompanyMemberships, users } from "~/server/db/schema";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

let mockDb: DbClient;
jest.mock("~/server/db", () => ({
    get db() {
        return mockDb;
    },
}));

// Imported after the mock so they bind to the test database.
import {
    canViewProfileImage,
    clearWorkspaceOverride,
    loadMyProfile,
    readProfileImage,
    removeProfilePhoto,
    replaceProfilePhoto,
    updateProfile,
    updateWorkspaceOverride,
    type ProfileCaller,
} from "~/server/profile/store";
import { leaveWorkspace, listMembers } from "~/server/workspace/members";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const photo = (tag: string) => ({
    data: Buffer.from(`webp-bytes-${tag}`),
    mimeType: "image/webp" as const,
    width: 512,
    height: 512,
    byteSize: 16,
});

describeIfDatabase("profile store (Postgres)", () => {
    jest.setTimeout(120_000);

    let database: FounderWeeklyReviewTestDatabase;
    let A: bigint;
    let B: bigint;
    let C: bigint;
    const pk: Record<"ada" | "bob" | "cai" | "dee", bigint> = {
        ada: 0n,
        bob: 0n,
        cai: 0n,
        dee: 0n,
    };

    const caller = (who: keyof typeof pk, companyId: bigint | null): ProfileCaller => ({
        userPk: pk[who],
        authUserId: `auth-${who}`,
        companyId,
    });

    beforeAll(async () => {
        database = await createFounderWeeklyReviewTestDatabase();
        mockDb = database.db;

        const made = await mockDb
            .insert(company)
            .values(["Acme", "Beta Co", "Cold"].map(name => ({ name, numberOfEmployees: "1-10" })))
            .returning({ id: company.id });
        [A, B, C] = made.map(row => BigInt(row.id)) as [bigint, bigint, bigint];

        for (const [who, home] of [
            ["ada", A],
            ["bob", A],
            ["cai", B],
            ["dee", C],
        ] as const) {
            const [row] = await mockDb
                .insert(users)
                .values({
                    userId: `auth-${who}`,
                    name: `${who[0]!.toUpperCase()}${who.slice(1)} Person`,
                    email: `${who}@example.com`,
                    companyId: home,
                })
                .returning({ id: users.id });
            pk[who] = BigInt(row!.id);
        }

        await mockDb.insert(userCompanyMemberships).values([
            { userId: pk.ada, companyId: A, role: "owner" },
            { userId: pk.ada, companyId: B, role: "member" },
            { userId: pk.bob, companyId: A, role: "member" },
            { userId: pk.cai, companyId: B, role: "owner" },
            { userId: pk.dee, companyId: C, role: "owner" },
        ]);
    });

    afterAll(async () => {
        await database?.close();
    });

    it("stores one photo per scope and mints a new id on every replace", async () => {
        const first = await replaceProfilePhoto(caller("ada", A), "global", photo("one"));
        const second = await replaceProfilePhoto(caller("ada", A), "global", photo("two"));
        expect(first.profile.avatarUrl).not.toBe(second.profile.avatarUrl);

        const rows = await mockDb
            .select({ id: profileImages.id })
            .from(profileImages)
            .where(eq(profileImages.userId, pk.ada));
        expect(rows).toHaveLength(1);
        const stored = await readProfileImage(rows[0]!.id);
        expect(stored?.data.toString()).toBe("webp-bytes-two");
    });

    it("resolves the workspace override only inside that workspace", async () => {
        await updateProfile(caller("ada", A), { displayName: "Ada", title: "Founder" });
        const inB = await replaceProfilePhoto(caller("ada", B), "workspace", photo("beta"));
        await updateWorkspaceOverride(caller("ada", B), { title: "Advisor" });

        const seenInB = await loadMyProfile(caller("ada", B));
        expect(seenInB.effective).toMatchObject({ displayName: "Ada", title: "Advisor" });
        expect(seenInB.effective.avatarUrl).toBe(inB.workspace?.override.avatarUrl);

        const seenInA = await loadMyProfile(caller("ada", A));
        expect(seenInA.effective.title).toBe("Founder");
        expect(seenInA.effective.avatarUrl).toBe(seenInA.profile.avatarUrl);
        expect(seenInA.effective.avatarUrl).not.toBe(seenInB.effective.avatarUrl);

        const noWorkspace = await loadMyProfile(caller("ada", null));
        expect(noWorkspace.workspace).toBeNull();
        expect(noWorkspace.effective.title).toBe("Founder");
    });

    it("shows each member list its own workspace's look", async () => {
        const ctx = (companyId: bigint) =>
            buildWorkspaceContext({
                authUserId: "auth-cai",
                userPk: pk.cai,
                companyId,
                role: "owner",
                status: "active",
                permissions: new Set(),
                resolveScope: async () => ({ kind: "everything" }),
            });
        const inB = (await listMembers(ctx(B))).members.find(m => m.id === Number(pk.ada));
        const inA = (await listMembers(ctx(A))).members.find(m => m.id === Number(pk.ada));
        expect(inB).toMatchObject({ displayName: "Ada", title: "Advisor", name: "Ada Person" });
        expect(inA).toMatchObject({ displayName: "Ada", title: "Founder" });
        expect(inB?.avatarUrl).not.toBe(inA?.avatarUrl);
    });

    it("lets only people who share the right workspace fetch a photo", async () => {
        const me = await loadMyProfile(caller("ada", B));
        const idOf = (url: string | null) => url!.split("/").pop()!;
        const globalImage = await readProfileImage(idOf(me.profile.avatarUrl));
        const betaImage = await readProfileImage(idOf(me.workspace!.override.avatarUrl));
        expect(globalImage && betaImage).toBeTruthy();

        // Ada sees both of her own.
        expect(await canViewProfileImage(pk.ada, globalImage!)).toBe(true);
        expect(await canViewProfileImage(pk.ada, betaImage!)).toBe(true);
        // Bob shares A (no override there): the profile photo, not B's.
        expect(await canViewProfileImage(pk.bob, globalImage!)).toBe(true);
        expect(await canViewProfileImage(pk.bob, betaImage!)).toBe(false);
        // Cai shares only B, where the override replaces the profile photo.
        expect(await canViewProfileImage(pk.cai, betaImage!)).toBe(true);
        expect(await canViewProfileImage(pk.cai, globalImage!)).toBe(false);
        // Dee shares nothing.
        expect(await canViewProfileImage(pk.dee, globalImage!)).toBe(false);
        expect(await canViewProfileImage(pk.dee, betaImage!)).toBe(false);
    });

    it("stops showing a photo to a suspended viewer", async () => {
        const me = await loadMyProfile(caller("ada", A));
        const globalImage = await readProfileImage(me.profile.avatarUrl!.split("/").pop()!);
        const bobInA = and(
            eq(userCompanyMemberships.userId, pk.bob),
            eq(userCompanyMemberships.companyId, A)
        );
        await mockDb.update(userCompanyMemberships).set({ status: "suspended" }).where(bobInA);
        expect(await canViewProfileImage(pk.bob, globalImage!)).toBe(false);
        await mockDb.update(userCompanyMemberships).set({ status: "active" }).where(bobInA);
    });

    it("drops the override with Reset, and the workspace photo when the member leaves", async () => {
        const reset = await clearWorkspaceOverride(caller("ada", B));
        expect(reset.workspace?.override).toEqual({
            displayName: null,
            title: null,
            avatarUrl: null,
        });

        await replaceProfilePhoto(caller("ada", B), "workspace", photo("again"));
        await leaveWorkspace(
            buildWorkspaceContext({
                authUserId: "auth-ada",
                userPk: pk.ada,
                companyId: B,
                role: "member",
                status: "active",
                permissions: new Set(),
            })
        );
        const left = await mockDb
            .select({ id: profileImages.id })
            .from(profileImages)
            .where(and(eq(profileImages.userId, pk.ada), eq(profileImages.companyId, B)));
        expect(left).toEqual([]);

        // The profile photo is the person's and survives both.
        const removed = await removeProfilePhoto(caller("ada", A), "global");
        expect(removed.profile.avatarUrl).toBeNull();
    });
});
