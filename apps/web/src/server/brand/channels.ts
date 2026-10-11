/**
 * Brand channels: the places a workspace's posts go out as. A LinkedIn
 * connection brings the member's profile and every Page they administer;
 * a Bluesky connection brings its one account. Networks the operator set up
 * with deployment-wide keys (X, Reddit, or LinkedIn/Bluesky before a
 * workspace connects its own) appear as one "deployment" channel each,
 * until the workspace connects an account of its own on that network.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import { decryptSecret } from "@launchstack/store/crypto";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
import { describePublishConfig, type PublishTarget } from "@launchstack/tools/social-publish";
import { verifyBlueskyCredentials } from "@launchstack/tools/social-publish/bluesky";
import {
    getLinkedInMember,
    listAdministeredOrganizations,
} from "@launchstack/tools/social-publish/linkedin";

import { db } from "~/server/db";
import {
    brandChannels,
    type BrandChannelCapabilities,
    type BrandChannelKind,
    type BrandChannelRow,
} from "~/server/db/schema/brand";
import { connectorConnections, type ConnectorConnection } from "~/server/db/schema/connectors";
import { getEngine } from "~/server/engine";
import {
    getConnectionAccessToken,
    getConnectionById,
    upsertConnection,
} from "~/server/services/connectors/connection-store";
import { ConnectorGrantRevokedError } from "~/server/services/connectors/providers/types";

import { channelCapabilities, linkedInGrantFeatures } from "./capabilities";
import { linkedInApiOptions } from "./linkedin-options";

/** The JSON shape `/api/brand/*` returns for a channel (mirrors the client contract). */
export interface BrandChannelView {
    id: string;
    platform: MarketingPlatform;
    kind: BrandChannelKind | "deployment";
    name: string;
    handle: string | null;
    avatarUrl: string | null;
    profileUrl: string | null;
    enabled: boolean;
    status: "active" | "reconnect";
    statusReason: string | null;
    connectionId: number | null;
    capabilities: BrandChannelCapabilities;
    followers: number | null;
    limit: number | null;
}

export const DEPLOYMENT_CHANNEL_PREFIX = "deployment:";

export function deploymentChannelId(platform: MarketingPlatform): string {
    return `${DEPLOYMENT_CHANNEL_PREFIX}${platform}`;
}

export function parseDeploymentChannelId(id: string): MarketingPlatform | null {
    if (!id.startsWith(DEPLOYMENT_CHANNEL_PREFIX)) return null;
    const platform = id.slice(DEPLOYMENT_CHANNEL_PREFIX.length);
    return platform === "x" ||
        platform === "linkedin" ||
        platform === "bluesky" ||
        platform === "reddit"
        ? platform
        : null;
}

export const NETWORK_LABELS: Record<MarketingPlatform, string> = {
    linkedin: "LinkedIn",
    x: "X",
    bluesky: "Bluesky",
    reddit: "Reddit",
};

/** Why a connection can no longer post, in the user's words; null while it can. */
export function connectionProblem(
    connection: Pick<
        ConnectorConnection,
        | "provider"
        | "status"
        | "lastRefreshError"
        | "accessTokenExpiresAt"
        | "refreshTokenCiphertext"
    >,
    now = new Date()
): string | null {
    const label = connection.provider === "linkedin" ? "LinkedIn" : "Bluesky";
    if (connection.status === "revoked") {
        return `${label} no longer accepts this sign-in. Reconnect to keep posting.`;
    }
    if (
        connection.accessTokenExpiresAt &&
        connection.accessTokenExpiresAt.getTime() <= now.getTime() &&
        !connection.refreshTokenCiphertext
    ) {
        return `The ${label} sign-in expired on ${connection.accessTokenExpiresAt.toISOString().slice(0, 10)}. Reconnect to keep posting.`;
    }
    return null;
}

export async function listChannelRows(companyId: bigint): Promise<BrandChannelRow[]> {
    return db
        .select()
        .from(brandChannels)
        .where(eq(brandChannels.companyId, companyId))
        .orderBy(asc(brandChannels.platform), asc(brandChannels.kind), asc(brandChannels.name));
}

export async function getChannelRow(
    companyId: bigint,
    id: string
): Promise<BrandChannelRow | null> {
    const [row] = await db
        .select()
        .from(brandChannels)
        .where(and(eq(brandChannels.companyId, companyId), eq(brandChannels.id, id)))
        .limit(1);
    return row ?? null;
}

export function toChannelView(
    row: BrandChannelRow,
    connection: ConnectorConnection | undefined,
    limit: number | null,
    now = new Date()
): BrandChannelView {
    const problem = connection ? connectionProblem(connection, now) : "This sign-in was removed.";
    const reconnect = row.status === "reconnect" || problem !== null;
    return {
        id: row.id,
        platform: row.platform as MarketingPlatform,
        kind: row.kind,
        name: row.name,
        handle: row.handle ?? null,
        avatarUrl: row.avatarUrl ?? null,
        profileUrl: row.profileUrl ?? null,
        enabled: row.enabled,
        status: reconnect ? "reconnect" : "active",
        statusReason: reconnect ? (row.statusReason ?? problem) : null,
        connectionId: row.connectionId,
        capabilities: row.capabilities,
        followers: row.followers ?? null,
        limit,
    };
}

/**
 * One channel per network the operator configured with deployment keys,
 * left out where the workspace already has an account of its own there.
 */
export function deploymentChannels(
    ownPlatforms: ReadonlySet<string>,
    limitFor: (platform: MarketingPlatform) => number | null
): BrandChannelView[] {
    const config = describePublishConfig();
    const out: BrandChannelView[] = [];
    for (const platform of ["linkedin", "x", "bluesky", "reddit"] as const) {
        if (!config[platform].configured || ownPlatforms.has(platform)) continue;
        const media = platform === "linkedin" || platform === "bluesky";
        out.push({
            id: deploymentChannelId(platform),
            platform,
            kind: "deployment",
            name: config[platform].identity ?? `${NETWORK_LABELS[platform]} (deployment account)`,
            handle: config[platform].identity,
            avatarUrl: null,
            profileUrl: null,
            enabled: true,
            status: "active",
            statusReason: null,
            connectionId: null,
            capabilities: { publish: true, images: media, analytics: false, comments: false },
            followers: null,
            limit: limitFor(platform),
        });
    }
    return out;
}

interface ChannelSeed {
    platform: MarketingPlatform;
    kind: BrandChannelKind;
    externalId: string;
    name: string;
    handle: string | null;
    avatarUrl: string | null;
    profileUrl: string | null;
    role: string | null;
    capabilities: BrandChannelCapabilities;
    followers?: number | null;
    /** Used only when the channel is new. */
    enabledByDefault: boolean;
}

/**
 * Write the channels a connection brings. A channel already on the
 * workspace (the same Page connected by another admin) moves to this
 * connection and keeps its on/off switch. Channels this connection used to
 * bring but no longer does (the member lost the Page) are marked reconnect.
 */
async function upsertChannels(
    companyId: bigint,
    connectionId: number,
    seeds: ChannelSeed[]
): Promise<BrandChannelRow[]> {
    const rows: BrandChannelRow[] = [];
    for (const seed of seeds) {
        const [row] = await db
            .insert(brandChannels)
            .values({
                id: randomUUID(),
                companyId,
                connectionId,
                platform: seed.platform,
                kind: seed.kind,
                externalId: seed.externalId,
                name: seed.name,
                handle: seed.handle,
                avatarUrl: seed.avatarUrl,
                profileUrl: seed.profileUrl,
                role: seed.role,
                enabled: seed.enabledByDefault,
                capabilities: seed.capabilities,
                status: "active",
                statusReason: null,
                followers: seed.followers ?? null,
            })
            .onConflictDoUpdate({
                target: [brandChannels.companyId, brandChannels.platform, brandChannels.externalId],
                set: {
                    connectionId,
                    kind: seed.kind,
                    name: seed.name,
                    handle: seed.handle,
                    avatarUrl: seed.avatarUrl,
                    profileUrl: seed.profileUrl,
                    role: seed.role,
                    capabilities: seed.capabilities,
                    status: "active",
                    statusReason: null,
                    ...(seed.followers !== undefined ? { followers: seed.followers } : {}),
                    updatedAt: new Date(),
                },
            })
            .returning();
        if (row) rows.push(row);
    }
    const kept = rows.map(r => r.id);
    await db
        .update(brandChannels)
        .set({
            status: "reconnect",
            statusReason: "The account that connected this no longer manages it on the network.",
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(brandChannels.connectionId, connectionId),
                kept.length > 0 ? notInArray(brandChannels.id, kept) : undefined
            )
        );
    return rows;
}

/** `https://www.linkedin.com/company/<vanity>/`, or the numeric id when there is no vanity name. */
function linkedInPageUrl(id: string, vanityName: string | null): string {
    return `https://www.linkedin.com/company/${encodeURIComponent(vanityName ?? id)}/`;
}

/**
 * Read who a LinkedIn grant belongs to and which Pages it manages, and turn
 * them into channels. Runs right after OAuth and on "Refresh Pages".
 */
export async function discoverLinkedInChannels(
    connection: ConnectorConnection
): Promise<BrandChannelRow[]> {
    const accessToken = await liveAccessToken(connection);
    const options = linkedInApiOptions(accessToken);
    const features = linkedInGrantFeatures(connection.scopes);
    const member = await getLinkedInMember(options);
    const organizations = features.pages ? await listAdministeredOrganizations(options) : [];

    const seeds: ChannelSeed[] = [];
    for (const org of organizations) {
        const capabilities = channelCapabilities(
            "linkedin",
            "organization",
            connection.scopes,
            org.role
        );
        if (!capabilities.publish) continue;
        seeds.push({
            platform: "linkedin",
            kind: "organization",
            externalId: org.urn,
            name: org.name,
            handle: org.vanityName,
            avatarUrl: org.logoUrl,
            profileUrl: linkedInPageUrl(org.id, org.vanityName),
            role: org.role,
            capabilities,
            enabledByDefault: true,
        });
    }
    if (features.memberPosting) {
        seeds.push({
            platform: "linkedin",
            kind: "person",
            externalId: member.urn,
            name: member.name ?? member.email ?? "LinkedIn member",
            handle: null,
            avatarUrl: member.pictureUrl,
            profileUrl: null,
            role: null,
            capabilities: channelCapabilities("linkedin", "person", connection.scopes),
            // With a Page to speak for the company, posting as a person is opt-in.
            enabledByDefault: seeds.length === 0,
        });
    }
    return upsertChannels(connection.companyId, connection.id, seeds);
}

export class BrandConnectError extends Error {
    /** Read by the shared route error handler, which passes status and code through. */
    readonly code = "connect_failed";
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "BrandConnectError";
    }
}

/** Verify a Bluesky handle and app password, store it sealed, and make its channel. */
export async function connectBluesky(args: {
    companyId: bigint;
    userPk: bigint;
    identifier: string;
    appPassword: string;
}): Promise<{ connection: ConnectorConnection; channels: BrandChannelRow[] }> {
    const identifier = args.identifier.trim().replace(/^@/, "");
    const appPassword = args.appPassword.trim();
    let profile;
    try {
        profile = await verifyBlueskyCredentials({ identifier, appPassword });
    } catch (error) {
        const authFailed =
            error &&
            typeof error === "object" &&
            "authFailed" in error &&
            error.authFailed === true;
        throw new BrandConnectError(
            authFailed
                ? "Bluesky did not accept that handle and app password."
                : `Could not reach Bluesky: ${error instanceof Error ? error.message : String(error)}`,
            authFailed ? 400 : 502
        );
    }
    const connection = await upsertConnection({
        companyId: args.companyId,
        provider: "bluesky",
        grantedByUserId: args.userPk,
        grant: {
            providerAccountId: profile.did,
            displayName: profile.handle,
            scopes: "app-password",
            // Bluesky app passwords are the credential itself; sealed like a token.
            accessToken: appPassword,
            accessTokenExpiresAt: null,
            refreshToken: null,
        },
    });
    const channels = await upsertChannels(args.companyId, connection.id, [
        {
            platform: "bluesky",
            kind: "account",
            externalId: profile.did,
            name: profile.displayName ?? profile.handle,
            handle: profile.handle,
            avatarUrl: profile.avatarUrl,
            profileUrl: `https://bsky.app/profile/${profile.handle}`,
            role: null,
            capabilities: channelCapabilities("bluesky", "account", []),
            followers: profile.followers,
            enabledByDefault: true,
        },
    ]);
    return { connection, channels };
}

export async function setChannelEnabled(
    companyId: bigint,
    id: string,
    enabled: boolean
): Promise<BrandChannelRow | null> {
    const [row] = await db
        .update(brandChannels)
        .set({ enabled, updatedAt: new Date() })
        .where(and(eq(brandChannels.companyId, companyId), eq(brandChannels.id, id)))
        .returning();
    return row ?? null;
}

/** What every channel of a refused sign-in says, whichever channel hit it first. */
export function refusedSignInReason(platform: string): string {
    const label =
        platform === "linkedin" ? "LinkedIn" : platform === "bluesky" ? "Bluesky" : platform;
    return `${label} no longer accepts this sign-in. Reconnect it under Accounts.`;
}

/** The network refused a connection's credential: every channel it brings needs a reconnect. */
export async function markConnectionReconnect(connectionId: number, reason: string): Promise<void> {
    await db
        .update(brandChannels)
        .set({ status: "reconnect", statusReason: reason, updatedAt: new Date() })
        .where(eq(brandChannels.connectionId, connectionId));
    await db
        .update(connectorConnections)
        .set({ status: "revoked", lastRefreshError: reason, updatedAt: new Date() })
        .where(eq(connectorConnections.id, connectionId));
}

/**
 * A usable LinkedIn access token: refreshed when it is near expiry and a
 * refresh token exists. A dead grant marks the channels reconnect.
 */
async function liveAccessToken(connection: ConnectorConnection): Promise<string> {
    try {
        return await getConnectionAccessToken(connection);
    } catch (error) {
        const reason =
            error instanceof ConnectorGrantRevokedError
                ? "LinkedIn no longer accepts this sign-in. Reconnect to keep posting."
                : error instanceof Error && /reconnect required/i.test(error.message)
                  ? "The LinkedIn sign-in expired. Reconnect to keep posting."
                  : null;
        if (reason) await markConnectionReconnect(connection.id, reason);
        throw new ChannelUnavailableError(
            reason ?? (error instanceof Error ? error.message : String(error)),
            reason !== null
        );
    }
}

/** A channel cannot post right now; `reconnect` says whether only a new sign-in fixes it. */
export class ChannelUnavailableError extends Error {
    constructor(
        message: string,
        readonly reconnect: boolean
    ) {
        super(message);
        this.name = "ChannelUnavailableError";
    }
}

/** Who to post as for a stored channel: a fresh token and author, or the sealed app password. */
export async function resolveChannelTarget(channel: BrandChannelRow): Promise<PublishTarget> {
    const connection = await getConnectionById(channel.connectionId);
    if (!connection || connection.companyId !== channel.companyId) {
        throw new ChannelUnavailableError(
            "This channel's sign-in was removed. Reconnect it under Accounts.",
            true
        );
    }
    const problem = connectionProblem(connection);
    if (problem) throw new ChannelUnavailableError(problem, true);
    if (channel.status === "reconnect") {
        throw new ChannelUnavailableError(
            channel.statusReason ?? "This channel needs to be reconnected under Accounts.",
            true
        );
    }
    if (channel.platform === "linkedin") {
        return {
            kind: "linkedin",
            accessToken: await liveAccessToken(connection),
            authorUrn: channel.externalId,
        };
    }
    if (channel.platform === "bluesky") {
        getEngine();
        if (!connection.accessTokenCiphertext) {
            throw new ChannelUnavailableError(
                "The Bluesky app password is missing. Reconnect it under Accounts.",
                true
            );
        }
        let appPassword: string;
        try {
            appPassword = decryptSecret(connection.accessTokenCiphertext);
        } catch {
            throw new ChannelUnavailableError(
                "The stored Bluesky app password can no longer be read. Reconnect it under Accounts.",
                true
            );
        }
        return { kind: "bluesky", identifier: connection.providerAccountId, appPassword };
    }
    throw new ChannelUnavailableError(
        `${channel.platform} channels post with deployment keys.`,
        false
    );
}

/** Channels of these connections, for the connection list. */
export async function channelsForConnections(
    companyId: bigint,
    connectionIds: number[]
): Promise<BrandChannelRow[]> {
    if (connectionIds.length === 0) return [];
    return db
        .select()
        .from(brandChannels)
        .where(
            and(
                eq(brandChannels.companyId, companyId),
                inArray(brandChannels.connectionId, connectionIds)
            )
        );
}
