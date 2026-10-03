/**
 * The workspace's own social accounts. A credential is entered once, verified
 * against the network, and stored sealed (AES-256-GCM through the store's
 * secret box) in `brand_accounts`; the plaintext exists only inside a publish
 * or a verify. The environment's deployment-wide tokens remain the fallback
 * for a workspace that has connected nothing, which is what a single-tenant
 * self-hosted install had before.
 *
 * Presence, identity and status are all this module reports. A credential
 * value never leaves it.
 */
import { and, eq } from "drizzle-orm";

import { platformLimit } from "@launchstack/pipelines/marketing/posts";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
import {
    describePublishConfig,
    verifyCredentials,
    type SocialCredentials,
} from "@launchstack/tools/social-publish";

import type { BrandAccount, BrandAccountField } from "~/app/employer/tools/growth/brand/api";
import { db } from "~/server/db";
import { brandAccounts, type BrandAccountRow } from "~/server/db/schema";
import { getEngine } from "~/server/engine";

export type { BrandAccount };

export class BrandAccountError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string
    ) {
        super(message);
        this.name = "BrandAccountError";
    }
}

interface PlatformMeta {
    label: string;
    requires: string[];
    note: string;
    fields: BrandAccountField[];
}

const META: Record<MarketingPlatform, PlatformMeta> = {
    linkedin: {
        label: "LinkedIn",
        requires: [
            "A LinkedIn developer app owned by the company",
            "Community Management API access (registered entity; the page's super admin verifies the app)",
            "A member access token with the w_member_social scope",
        ],
        note: "Free to post. Access is reviewed by LinkedIn: a development tier first, the standard tier after a screencast review.",
        fields: [
            {
                key: "accessToken",
                label: "Access token",
                secret: true,
                hint: "An OAuth 2.0 member token with w_member_social. It expires after 60 days; reconnect then.",
            },
        ],
    },
    x: {
        label: "X",
        requires: [
            "An X developer account on pay-per-use",
            "An OAuth 2.0 user access token with tweet.write",
        ],
        note: "Pay per post: about $0.015 each, $0.20 when the post carries a link. No free tier for new developers.",
        fields: [
            {
                key: "bearerToken",
                label: "User access token",
                secret: true,
                hint: "A user-context token. An app-only bearer token cannot post.",
            },
        ],
    },
    bluesky: {
        label: "Bluesky",
        requires: ["The account's handle", "An app password from Settings › App passwords"],
        note: "Free, no review. Reading back is free too.",
        fields: [
            { key: "handle", label: "Handle", secret: false, placeholder: "you.bsky.social" },
            {
                key: "appPassword",
                label: "App password",
                secret: true,
                hint: "Never your main password. Revoke it from Bluesky at any time.",
            },
        ],
    },
    reddit: {
        label: "Reddit",
        requires: [
            "A Reddit script app (client id and secret)",
            "A user agent naming the app and the account, as Reddit's API rules ask",
        ],
        note: "Free for this volume. Posts go to the account's own profile; each subreddit has its own rules.",
        fields: [
            { key: "clientId", label: "Client id", secret: false },
            { key: "clientSecret", label: "Client secret", secret: true },
            {
                key: "userAgent",
                label: "User agent",
                secret: false,
                placeholder: "launchstack:brand:v1 (by /u/yourname)",
            },
        ],
    },
};

/** The order Compose and Accounts list networks in: the free ones first. */
const ORDER: MarketingPlatform[] = ["linkedin", "x", "bluesky", "reddit"];

export function isBrandPlatform(value: string): value is MarketingPlatform {
    return (ORDER as string[]).includes(value);
}

function toAccount(
    platform: MarketingPlatform,
    row: BrandAccountRow | null,
    env: { configured: boolean; identity: string | null }
): BrandAccount {
    const meta = META[platform];
    const base = {
        platform,
        label: meta.label,
        limit: platformLimit(platform),
        requires: meta.requires,
        fields: meta.fields,
        note: meta.note,
    };
    if (row) {
        const revoked = row.status !== "active";
        return {
            ...base,
            configured: !revoked,
            scope: "workspace",
            status: revoked ? "revoked" : "connected",
            identity: row.identity,
            connectedAt: row.createdAt.toISOString(),
            lastError: row.lastError,
        };
    }
    if (env.configured) {
        return {
            ...base,
            configured: true,
            scope: "deployment",
            status: "connected",
            identity: env.identity,
            connectedAt: null,
            lastError: null,
        };
    }
    return {
        ...base,
        configured: false,
        scope: null,
        status: "not_connected",
        identity: null,
        connectedAt: null,
        lastError: null,
    };
}

async function getRow(
    companyId: bigint,
    platform: MarketingPlatform
): Promise<BrandAccountRow | null> {
    const [row] = await db
        .select()
        .from(brandAccounts)
        .where(and(eq(brandAccounts.companyId, companyId), eq(brandAccounts.platform, platform)))
        .limit(1);
    return row ?? null;
}

/** Every network, with where its credential comes from for this workspace. */
export async function listBrandAccounts(companyId: bigint): Promise<BrandAccount[]> {
    const [rows, env] = await Promise.all([
        db.select().from(brandAccounts).where(eq(brandAccounts.companyId, companyId)),
        Promise.resolve(describePublishConfig()),
    ]);
    const byPlatform = new Map(rows.map(r => [r.platform, r]));
    return ORDER.map(platform =>
        toAccount(platform, byPlatform.get(platform) ?? null, env[platform])
    );
}

export async function getBrandAccount(
    companyId: bigint,
    platform: MarketingPlatform
): Promise<BrandAccount> {
    const row = await getRow(companyId, platform);
    return toAccount(platform, row, describePublishConfig()[platform]);
}

function credentialsFromValues(
    platform: MarketingPlatform,
    values: Record<string, string>
): SocialCredentials {
    const need = (key: string): string => {
        const value = values[key]?.trim();
        if (!value) {
            const field = META[platform].fields.find(f => f.key === key);
            throw new BrandAccountError(`${field?.label ?? key} is required`, 400, "missing_field");
        }
        return value;
    };
    switch (platform) {
        case "linkedin":
            return { platform, accessToken: need("accessToken") };
        case "x":
            return { platform, bearerToken: need("bearerToken") };
        case "bluesky":
            return { platform, handle: need("handle"), appPassword: need("appPassword") };
        case "reddit":
            return {
                platform,
                clientId: need("clientId"),
                clientSecret: need("clientSecret"),
                userAgent: need("userAgent"),
            };
    }
}

/**
 * Verify the values against the network, then store them sealed. A failed
 * verification stores nothing and says why in the network's own words.
 */
export async function connectBrandAccount(args: {
    companyId: bigint;
    userId: string;
    platform: MarketingPlatform;
    values: Record<string, string>;
}): Promise<BrandAccount> {
    getEngine(); // populates the secret-box slot
    const credentials = credentialsFromValues(args.platform, args.values);
    const verified = await verifyCredentials(credentials);
    if (!verified.ok) {
        throw new BrandAccountError(
            verified.error,
            verified.authFailed ? 401 : verified.retryable ? 503 : 400,
            verified.authFailed ? "credentials_rejected" : "verify_failed"
        );
    }
    const sealed = encryptSecret(JSON.stringify(credentials));
    const values = {
        companyId: args.companyId,
        platform: args.platform,
        identity: verified.identity,
        credentialsCiphertext: sealed.ciphertext,
        encryptionKeyVersion: sealed.keyVersion,
        status: "active",
        lastError: null,
        connectedByUserId: args.userId,
    };
    const [row] = await db
        .insert(brandAccounts)
        .values(values)
        .onConflictDoUpdate({
            target: [brandAccounts.companyId, brandAccounts.platform],
            set: { ...values, updatedAt: new Date() },
        })
        .returning();
    return toAccount(args.platform, row ?? null, describePublishConfig()[args.platform]);
}

export async function disconnectBrandAccount(
    companyId: bigint,
    platform: MarketingPlatform
): Promise<BrandAccount> {
    await db
        .delete(brandAccounts)
        .where(and(eq(brandAccounts.companyId, companyId), eq(brandAccounts.platform, platform)));
    return toAccount(platform, null, describePublishConfig()[platform]);
}

export async function markBrandAccountRevoked(
    companyId: bigint,
    platform: MarketingPlatform,
    reason: string
): Promise<void> {
    await db
        .update(brandAccounts)
        .set({ status: "revoked", lastError: reason.slice(0, 2000), updatedAt: new Date() })
        .where(and(eq(brandAccounts.companyId, companyId), eq(brandAccounts.platform, platform)));
}

export type ResolvedCredentials =
    | { kind: "workspace"; credentials: SocialCredentials }
    | { kind: "deployment" }
    | { kind: "revoked"; reason: string }
    | { kind: "none" };

/**
 * What a publish should use for this workspace and network. A workspace
 * that has connected its own account never falls back to the deployment's
 * token, so one tenant can never post through another's account.
 */
export async function resolveBrandCredentials(
    companyId: bigint,
    platform: MarketingPlatform
): Promise<ResolvedCredentials> {
    const row = await getRow(companyId, platform);
    if (row) {
        if (row.status !== "active")
            return {
                kind: "revoked",
                reason: row.lastError ?? "The network refused the credential",
            };
        getEngine();
        try {
            const parsed: unknown = JSON.parse(decryptSecret(row.credentialsCiphertext));
            if (
                parsed &&
                typeof parsed === "object" &&
                (parsed as { platform?: unknown }).platform === platform
            )
                return { kind: "workspace", credentials: parsed as SocialCredentials };
            throw new Error("stored credential has the wrong shape");
        } catch (error) {
            const reason = `Stored credential could not be read (key version ${row.encryptionKeyVersion}); reconnect`;
            await markBrandAccountRevoked(companyId, platform, reason);
            console.error(
                `[brand] ${platform} credential unreadable for company ${companyId}:`,
                error
            );
            return { kind: "revoked", reason };
        }
    }
    return describePublishConfig()[platform].configured ? { kind: "deployment" } : { kind: "none" };
}
