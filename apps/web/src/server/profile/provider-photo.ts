/**
 * The photo someone signed up with on Google or GitHub becomes their starting
 * profile photo — copied in once, never hotlinked.
 *
 * Better Auth stores the provider's picture URL on `auth_user.image` when an
 * account is created through a social provider. Copying the bytes (rather
 * than pointing at Google's CDN) keeps every photo on the same visibility
 * rules as an uploaded one and stops each viewer's browser calling Google.
 *
 * "Once" is `users.provider_photo_checked_at`, claimed atomically before the
 * fetch: it is set on the first attempt whether or not it works, so removing
 * the imported photo sticks, and a slow or unreachable provider costs one
 * page load, not every one.
 *
 * `auth_user.image` is also writable by the person through Better Auth's
 * update-user endpoint, so the URL is treated as untrusted: https only, and
 * only the providers' own photo hosts. Nothing else is ever fetched.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { authAccount, authUser, profileImages, users } from "~/server/db/schema";
import { PROFILE_PHOTO } from "~/lib/profile/fields";

import { normalizeProfilePhoto } from "./photo";
import { newProfileImageId } from "./store";

/** Providers whose sign-up photo we import, and the only hosts we fetch from. */
const PROVIDER_PHOTO_HOSTS: Record<string, RegExp> = {
    google: /^lh\d+\.googleusercontent\.com$/,
    github: /^avatars\.githubusercontent\.com$/,
};

const SOCIAL_PROVIDERS = Object.keys(PROVIDER_PHOTO_HOSTS);

const FETCH_TIMEOUT_MS = 4_000;

/**
 * The URL to fetch for a provider photo, asking for a larger size than the
 * sign-up default (Google hands out 96px), or null if it is not one we trust.
 */
export function providerPhotoSource(raw: string | null | undefined): URL | null {
    if (!raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const provider = Object.entries(PROVIDER_PHOTO_HOSTS).find(([, host]) =>
        host.test(url.hostname)
    )?.[0];
    if (!provider) return null;

    const size = PROFILE_PHOTO.outputSize;
    if (provider === "google") {
        // …/a/<id>=s96-c → =s512-c. Paths without a size suffix are left alone.
        url.pathname = url.pathname.replace(/=s\d+(-c)?$/, `=s${size}-c`);
    } else {
        url.searchParams.set("s", String(size));
    }
    return url;
}

async function download(url: URL): Promise<Buffer | null> {
    const response = await fetch(url, {
        // A redirect could leave the allowlisted host; don't follow one.
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "image/*" },
    });
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > PROFILE_PHOTO.maxBytes) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > PROFILE_PHOTO.maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/**
 * Imports the sign-up photo if this person has a social account, no profile
 * photo, and has never been offered one. Returns whether a photo was stored.
 * Never throws: a failed import just leaves the initials.
 */
export async function importProviderPhotoOnce(userPk: bigint): Promise<boolean> {
    try {
        const [claimed] = await db
            .update(users)
            .set({ providerPhotoCheckedAt: new Date() })
            .where(
                and(
                    eq(users.id, Number(userPk)),
                    isNull(users.providerPhotoCheckedAt),
                    sql`not exists (
                        select 1 from ${profileImages}
                        where ${profileImages.userId} = ${users.id}
                          and ${profileImages.companyId} is null
                    )`,
                    sql`exists (
                        select 1 from ${authAccount}
                        where ${authAccount.userId} = ${users.userId}
                          and ${inArray(authAccount.providerId, SOCIAL_PROVIDERS)}
                    )`
                )
            )
            .returning({ authUserId: users.userId });
        if (!claimed) return false;

        const [account] = await db
            .select({ image: authUser.image })
            .from(authUser)
            .where(eq(authUser.id, claimed.authUserId));
        const source = providerPhotoSource(account?.image);
        if (!source) return false;

        const bytes = await download(source);
        if (!bytes) return false;
        const photo = await normalizeProfilePhoto(bytes);

        await db
            .insert(profileImages)
            .values({
                id: newProfileImageId(),
                userId: userPk,
                companyId: null,
                mimeType: photo.mimeType,
                data: photo.data,
                byteSize: photo.byteSize,
                width: photo.width,
                height: photo.height,
            })
            // They uploaded one in the meantime: theirs wins.
            .onConflictDoNothing();
        return true;
    } catch (error) {
        console.warn("[profile] provider photo import skipped:", error);
        return false;
    }
}
