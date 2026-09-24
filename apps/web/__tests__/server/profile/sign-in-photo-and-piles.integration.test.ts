/** @jest-environment node */

/**
 * Two things that read across tables, against a real migrated Postgres:
 *
 * - The Google/GitHub sign-up photo is copied in exactly once, only from the
 *   provider's own host, and never returns after the person removes it.
 * - The workspace picker shows real teammates only where the viewer could
 *   open the member list, most recently active first, each as that
 *   workspace sees them.
 */

import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";

import {
    authAccount,
    authUser,
    profileImages,
    userCompanyMemberships,
    users,
} from "~/server/db/schema";

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
import { importProviderPhotoOnce } from "~/server/profile/provider-photo";
import { removeProfilePhoto, updateWorkspaceOverride } from "~/server/profile/store";
import { workspacePiles } from "~/server/profile/teammates";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

describeIfDatabase("sign-in photos and picker piles (Postgres)", () => {
    jest.setTimeout(120_000);

    let database: FounderWeeklyReviewTestDatabase;
    let A: bigint;
    let B: bigint;
    const pk: Record<string, bigint> = {};
    const realFetch = global.fetch;
    const fetchMock = jest.fn();
    let jpeg: Buffer;

    async function person(key: string, home: bigint, lastActiveAt: Date | null = null) {
        const [row] = await mockDb
            .insert(users)
            .values({
                userId: `auth-${key}`,
                name: `${key[0]!.toUpperCase()}${key.slice(1)} Person`,
                email: `${key}@example.com`,
                companyId: home,
                lastActiveAt,
            })
            .returning({ id: users.id });
        pk[key] = BigInt(row!.id);
        const now = new Date();
        await mockDb.insert(authUser).values({
            id: `auth-${key}`,
            name: key,
            email: `${key}@example.com`,
            createdAt: now,
            updatedAt: now,
        });
    }

    async function linkSocial(key: string, providerId: string, image: string | null) {
        const now = new Date();
        await mockDb
            .update(authUser)
            .set({ image })
            .where(eq(authUser.id, `auth-${key}`));
        await mockDb.insert(authAccount).values({
            id: `acct-${key}-${providerId}`,
            issuer: providerId,
            accountId: `${providerId}-${key}`,
            providerId,
            userId: `auth-${key}`,
            createdAt: now,
            updatedAt: now,
        });
    }

    const photosOf = (key: string) =>
        mockDb
            .select({ id: profileImages.id })
            .from(profileImages)
            .where(and(eq(profileImages.userId, pk[key]!), isNull(profileImages.companyId)));

    beforeAll(async () => {
        database = await createFounderWeeklyReviewTestDatabase();
        mockDb = database.db;
        jpeg = await sharp({
            create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 90, b: 200 } },
        })
            .jpeg()
            .toBuffer();

        const made = await mockDb
            .insert(company)
            .values(["Acme", "Beta"].map(name => ({ name, numberOfEmployees: "1-10" })))
            .returning({ id: company.id });
        [A, B] = made.map(row => BigInt(row.id)) as [bigint, bigint];

        const hour = 3_600_000;
        await person("gia", A);
        await person("hal", A);
        await person("ivy", A);
        await person("ada", A, new Date(Date.now() - 5 * hour));
        await person("bob", A, new Date(Date.now() - hour));
        await person("cai", A, null);
        await person("dee", A, new Date(Date.now() - 2 * hour));
        await person("eve", A, new Date());

        await mockDb.insert(userCompanyMemberships).values([
            { userId: pk.ada!, companyId: A, role: "owner" },
            { userId: pk.bob!, companyId: A, role: "member" },
            { userId: pk.cai!, companyId: A, role: "member" },
            { userId: pk.dee!, companyId: A, role: "member" },
            { userId: pk.eve!, companyId: A, role: "member", status: "suspended" },
            { userId: pk.ada!, companyId: B, role: "guest" },
            { userId: pk.bob!, companyId: B, role: "owner" },
            { userId: pk.gia!, companyId: A, role: "member", status: "pending" },
        ]);
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(
            async () =>
                new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg" } })
        );
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(async () => {
        global.fetch = realFetch;
        await database?.close();
    });

    it("copies a Google sign-up photo in once, at 512px, and respects its removal", async () => {
        await linkSocial("ada", "google", "https://lh3.googleusercontent.com/a/ada-photo=s96-c");

        expect(await importProviderPhotoOnce(pk.ada!)).toBe(true);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
            "https://lh3.googleusercontent.com/a/ada-photo=s512-c"
        );
        expect(await photosOf("ada")).toHaveLength(1);

        // Second page load: already offered, nothing fetched.
        expect(await importProviderPhotoOnce(pk.ada!)).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // She removes it; it does not come back.
        await removeProfilePhoto(
            { userPk: pk.ada!, authUserId: "auth-ada", companyId: A },
            "global"
        );
        expect(await importProviderPhotoOnce(pk.ada!)).toBe(false);
        expect(await photosOf("ada")).toHaveLength(0);
    });

    it("does nothing for email-and-password accounts, and keeps checking for them", async () => {
        expect(await importProviderPhotoOnce(pk.hal!)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        const [row] = await mockDb
            .select({ checked: users.providerPhotoCheckedAt })
            .from(users)
            .where(eq(users.id, Number(pk.hal!)));
        expect(row?.checked).toBeNull();
    });

    it("never fetches an image URL outside the provider's own host", async () => {
        await linkSocial("ivy", "github", "https://169.254.169.254/latest/meta-data");
        expect(await importProviderPhotoOnce(pk.ivy!)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await photosOf("ivy")).toHaveLength(0);
    });

    it("gives up quietly when the provider is unreachable, without retrying every load", async () => {
        await linkSocial("gia", "github", "https://avatars.githubusercontent.com/u/7?v=4");
        fetchMock.mockRejectedValue(new Error("network down"));
        expect(await importProviderPhotoOnce(pk.gia!)).toBe(false);
        expect(await importProviderPhotoOnce(pk.gia!)).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("shows real, active teammates, most recently active first, as each workspace sees them", async () => {
        await updateWorkspaceOverride(
            { userPk: pk.ada!, authUserId: "auth-ada", companyId: A },
            { displayName: "Ada at Acme" }
        );
        const piles = await workspacePiles({ userPk: pk.ada!, authUserId: "auth-ada" }, [
            { companyId: A, role: "owner", status: "active" },
            { companyId: B, role: "guest", status: "active" },
        ]);

        const acme = piles.get(A.toString());
        expect(acme?.me?.name).toBe("Ada at Acme");
        // Eve is suspended and Gia pending: neither shows. Cai has never been
        // active, so comes last.
        expect(acme?.teammates.map(t => t.name)).toEqual([
            "Bob Person",
            "Dee Person",
            "Cai Person",
        ]);

        // A guest can't open Beta's member list, so sees no one there.
        const beta = piles.get(B.toString());
        expect(beta?.teammates).toEqual([]);
        expect(beta?.me?.name).toBe("Ada Person");
    });

    it("shows no teammates in a workspace the viewer is only pending in", async () => {
        const piles = await workspacePiles({ userPk: pk.gia!, authUserId: "auth-gia" }, [
            { companyId: A, role: "member", status: "pending" },
        ]);
        expect(piles.get(A.toString())?.teammates).toEqual([]);
    });
});
