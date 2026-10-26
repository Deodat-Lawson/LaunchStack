/**
 * The Accounts screen's whole picture: which networks this deployment lets a
 * workspace connect (and what the operator still has to do), the sign-ins
 * the workspace made, and the channels they bring. Presence and identity
 * only — no token or app password ever leaves the server.
 *
 * A network's setup steps and note go out as English and as copies
 * (`setupCopy`, `noteCopy`) the Accounts screen words; reasons a sign-in or a
 * channel stopped working are worded here, in the `locale` the route passes
 * (English for every other caller).
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import { platformLimit } from "@launchstack/pipelines/marketing/posts";
import type { MarketingPlatform } from "@launchstack/tools/platform-profiles";
import { describePublishConfig } from "@launchstack/tools/social-publish";

import { env } from "~/env";
import { copy, type Copy } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import { db } from "~/server/db";
import { connectorConnections, type ConnectorConnection } from "~/server/db/schema/connectors";
import { users } from "~/server/db/schema/identity";
import { configuredPublicOrigin } from "~/server/public-origin";
import {
    connectorCallbackPath,
    isConnectorConfigured,
    linkedInRequestedScopes,
} from "~/server/services/connectors/config";

import { linkedInGrantFeatures } from "./capabilities";
import { brandReasonOrNull } from "./words";
import {
    NETWORK_LABELS,
    connectionProblem,
    deploymentChannels,
    listChannelRows,
    toChannelView,
    type BrandChannelView,
} from "./channels";
import { mayUseDeploymentAccounts } from "./deployment-accounts";

export const BRAND_CONNECTION_PROVIDERS = ["linkedin", "bluesky"] as const;
export type BrandConnectionProvider = (typeof BRAND_CONNECTION_PROVIDERS)[number];

export interface BrandNetworkView {
    platform: MarketingPlatform;
    label: string;
    connect: "oauth" | "app-password" | "deployment";
    available: boolean;
    pages: boolean;
    setup: string[];
    note: string;
    limit: number | null;
    /** One per setup step, same order. */
    setupCopy?: Copy[];
    noteCopy?: Copy;
}

export interface BrandConnectionView {
    id: number;
    platform: BrandConnectionProvider;
    accountName: string | null;
    status: "active" | "revoked";
    error: string | null;
    connectedAt: string;
    connectedBy: string | null;
    expiresAt: string | null;
    refreshable: boolean;
    scopes: string[];
}

export interface BrandAccountsView {
    networks: BrandNetworkView[];
    connections: BrandConnectionView[];
    channels: BrandChannelView[];
    canManage: boolean;
    canPublish: boolean;
}

/** The order networks are listed in: the ones a workspace connects itself first. */
const ORDER: MarketingPlatform[] = ["linkedin", "bluesky", "x", "reddit"];

function redirectUrl(): string {
    const base = configuredPublicOrigin() ?? "<BETTER_AUTH_URL>";
    return `${base.replace(/\/+$/, "")}${connectorCallbackPath("linkedin")}`;
}

/** A setup step or note of `growth.server.brand.networks.<network>`. */
const step = (key: string, values?: Copy["values"]) =>
    copy(`growth.server.brand.networks.${key}` as Copy["key"], values);

/**
 * `ownsDeploymentAccounts`: whether this workspace may post through the
 * operator's keys (see deployment-accounts.ts). On a shared server it is
 * false for everyone but the assigned workspace, and X and Reddit read as
 * unavailable rather than as somebody else's account.
 */
export function listBrandNetworks(ownsDeploymentAccounts = true): BrandNetworkView[] {
    const config = describePublishConfig();
    const sharedOnly = !ownsDeploymentAccounts;
    const notYours =
        "This server hosts several workspaces and the operator's account is assigned to another one (BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID).";
    const secretsKey = Boolean(env.server.EMBEDDING_SECRETS_KEY);
    const pages = linkedInGrantFeatures(linkedInRequestedScopes()).pages;
    const redirect = redirectUrl();
    const networks: Record<MarketingPlatform, BrandNetworkView> = {
        linkedin: {
            platform: "linkedin",
            label: "LinkedIn",
            connect: "oauth",
            available: isConnectorConfigured("linkedin"),
            pages,
            setup: [
                "Create an app at developer.linkedin.com, associated with the company's LinkedIn Page",
                "For Pages, analytics and comments: request the Community Management API on an app with no other products (registered company; a Page super admin verifies the app). For profiles only: add Share on LinkedIn and Sign In with LinkedIn using OpenID Connect",
                `Add the redirect URL ${redirect} under the app's Auth tab`,
                "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, and LINKEDIN_OAUTH_SCOPES to the scopes the Auth tab lists",
                ...(secretsKey
                    ? []
                    : ["Set EMBEDDING_SECRETS_KEY so sign-ins are stored encrypted"]),
            ],
            setupCopy: [
                step("linkedin.createApp"),
                step("linkedin.products"),
                step("linkedin.redirect", { url: redirect }),
                step("linkedin.keys"),
                ...(secretsKey ? [] : [step("linkedin.secretsKey")]),
            ],
            note: pages
                ? "Free to post. Pages, numbers and comments come with LinkedIn's Community Management API: 500 calls a day until LinkedIn's standard-tier review."
                : "Free to post. This app covers members' own profiles; Pages need LinkedIn's Community Management API. Sign-ins last 60 days.",
            noteCopy: step(pages ? "linkedin.notePages" : "linkedin.noteProfiles"),
            limit: platformLimit("linkedin"),
        },
        bluesky: {
            platform: "bluesky",
            label: "Bluesky",
            connect: "app-password",
            available: secretsKey,
            pages: false,
            setup: secretsKey
                ? []
                : ["Set EMBEDDING_SECRETS_KEY so app passwords are stored encrypted"],
            setupCopy: secretsKey ? [] : [step("bluesky.secretsKey")],
            note: "Free, no review. Each workspace signs in with its own app password.",
            noteCopy: step("bluesky.note"),
            limit: platformLimit("bluesky"),
        },
        x: {
            platform: "x",
            label: "X",
            connect: "deployment",
            available: config.x.configured && !sharedOnly,
            pages: false,
            setup: config.x.configured
                ? sharedOnly
                    ? [notYours]
                    : []
                : [
                      "An X developer account on pay-per-use",
                      "A token in TWITTER_BEARER_TOKEN, for one workspace (the only one, or BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID)",
                  ],
            setupCopy: config.x.configured
                ? sharedOnly
                    ? [step("shared.notYours")]
                    : []
                : [step("x.account"), step("x.token")],
            note: "Pay per post: about $0.015 each, $0.20 when the post carries a link. Set by the operator, for one workspace.",
            noteCopy: step("x.note"),
            limit: platformLimit("x"),
        },
        reddit: {
            platform: "reddit",
            label: "Reddit",
            connect: "deployment",
            available: config.reddit.configured && !sharedOnly,
            pages: false,
            setup: config.reddit.configured
                ? sharedOnly
                    ? [notYours]
                    : []
                : [
                      "A Reddit script app (client id and secret)",
                      "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT, for one workspace (the only one, or BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID)",
                  ],
            setupCopy: config.reddit.configured
                ? sharedOnly
                    ? [step("shared.notYours")]
                    : []
                : [step("reddit.app"), step("reddit.keys")],
            note: "Free for this volume. Posts go to the account's own profile. Set by the operator, for one workspace.",
            noteCopy: step("reddit.note"),
            limit: platformLimit("reddit"),
        },
    };
    return ORDER.map(platform => {
        const network = networks[platform];
        return network.available ? { ...network, setup: [], setupCopy: [] } : network;
    });
}

export async function listBrandConnections(companyId: bigint): Promise<ConnectorConnection[]> {
    return db
        .select()
        .from(connectorConnections)
        .where(
            and(
                eq(connectorConnections.companyId, companyId),
                inArray(connectorConnections.provider, [...BRAND_CONNECTION_PROVIDERS])
            )
        )
        .orderBy(asc(connectorConnections.createdAt));
}

/**
 * Every channel a workspace can post to, its own first, then the
 * deployment's — and the deployment's only for the workspace that owns them.
 */
export async function listBrandChannels(
    companyId: bigint,
    connections?: ConnectorConnection[],
    /** The reader's language, for why a channel needs a reconnect. */
    locale: Locale = "en"
): Promise<BrandChannelView[]> {
    const conns = connections ?? (await listBrandConnections(companyId));
    const byId = new Map(conns.map(c => [c.id, c]));
    const rows = await listChannelRows(companyId);
    const own = rows.map(row =>
        toChannelView(
            row,
            byId.get(row.connectionId),
            platformLimit(row.platform as MarketingPlatform),
            new Date(),
            locale
        )
    );
    if (!(await mayUseDeploymentAccounts(companyId))) return own;
    const ownPlatforms = new Set(rows.map(r => r.platform));
    return [...own, ...deploymentChannels(ownPlatforms, platformLimit)];
}

const KIND_PREFERENCE = ["organization", "account", "person", "deployment"] as const;

/**
 * Where a post for a network goes when the caller names no channel (the
 * campaign generator's Publish button): the workspace's own enabled, healthy
 * channel — a Page before a person, and of several Pages the one with the
 * most followers (the company's main Page, as a rule), then by name — and
 * the deployment's account only when the workspace has none on that
 * network. The caller tells the member which one it used. Null when
 * nothing can post there.
 */
export function pickDefaultChannel(
    channels: readonly BrandChannelView[],
    platform: MarketingPlatform
): BrandChannelView | null {
    const usable = channels.filter(
        c => c.platform === platform && c.enabled && c.status === "active" && c.capabilities.publish
    );
    usable.sort(
        (a, b) =>
            KIND_PREFERENCE.indexOf(a.kind) - KIND_PREFERENCE.indexOf(b.kind) ||
            (b.followers ?? -1) - (a.followers ?? -1) ||
            a.name.localeCompare(b.name)
    );
    return usable[0] ?? null;
}

export async function defaultChannelFor(
    companyId: bigint,
    platform: MarketingPlatform
): Promise<BrandChannelView | null> {
    return pickDefaultChannel(await listBrandChannels(companyId), platform);
}

export async function listBrandAccounts(
    companyId: bigint,
    canManage: boolean,
    canPublish = true,
    /** The reader's language, for why a sign-in or channel stopped working. */
    locale: Locale = "en"
): Promise<BrandAccountsView> {
    const connections = await listBrandConnections(companyId);
    const grantors = connections
        .map(c => c.grantedByUserId)
        .filter((id): id is bigint => id !== null && id !== undefined);
    const names = new Map<string, string>();
    if (grantors.length > 0) {
        const rows = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, grantors.map(Number)));
        for (const row of rows) names.set(String(row.id), row.name);
    }
    return {
        networks: listBrandNetworks(await mayUseDeploymentAccounts(companyId)),
        connections: connections.map(c => ({
            id: c.id,
            platform: c.provider as BrandConnectionProvider,
            accountName: c.providerAccountEmail ?? null,
            status: connectionProblem(c) ? "revoked" : "active",
            error: brandReasonOrNull(connectionProblem(c), locale),
            connectedAt: c.createdAt.toISOString(),
            connectedBy: c.grantedByUserId ? (names.get(String(c.grantedByUserId)) ?? null) : null,
            expiresAt: c.accessTokenExpiresAt?.toISOString() ?? null,
            refreshable: Boolean(c.refreshTokenCiphertext),
            scopes: c.scopes.split(/\s+/).filter(Boolean),
        })),
        channels: await listBrandChannels(companyId, connections, locale),
        canManage,
        canPublish,
    };
}

export { NETWORK_LABELS };
