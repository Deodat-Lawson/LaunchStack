/**
 * What the two "connect an assistant" screens (/oauth/workspace and
 * /oauth/consent) show: who is asking, for what, and which workspace the
 * grant will be bound to.
 *
 * better-auth sends the person to those screens with the authorization
 * request in a signed query string. The pages read client_id and scope from
 * it for DISPLAY only — the decisions are made server-side by better-auth,
 * which re-verifies the signature when the page posts back.
 *
 * A dynamically registered client names itself, so "Claude" on the screen
 * proves nothing. The page therefore also shows where the browser will be
 * sent back to (the redirect host) and whether the client's identity is a
 * metadata-document URL on its own domain (CIMD), which is the closest thing
 * to verification MCP offers. A client an admin of one of the person's own
 * workspaces created in Settings says so; anyone can found a workspace, so a
 * client from a workspace the person is not in is treated as self-named, and
 * that workspace's name is not shown. A self-named client's logo is not
 * loaded: fetching a URL it chose would tell it who is looking.
 */
import { and, desc, eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { authOauthClient } from "~/server/db/schema/auth";
import { userCompanyMemberships, users } from "~/server/db/schema/identity";
import { MCP_SCOPE_READ, MCP_SCOPE_WRITE, filled } from "./config";

export interface ConnectingClient {
    clientId: string;
    name: string;
    icon: string | null;
    /** Host the browser returns to after the person decides. */
    redirectHost: string | null;
    /** Set when the client id is a metadata URL on its own domain (CIMD). */
    verifiedDomain: string | null;
    /**
     * Set when an admin of one of the person's own workspaces created the
     * client in Settings: that workspace's name.
     */
    addedByWorkspace: string | null;
}

export interface ConnectRequest {
    client: ConnectingClient | null;
    scopes: string[];
}

function host(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        return new URL(url).host;
    } catch {
        return null;
    }
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

export async function loadConnectRequest(
    params: SearchParams,
    authUserId: string
): Promise<ConnectRequest> {
    const clientId = first(params.client_id);
    const scopes = (first(params.scope) ?? "").split(/\s+/).filter(Boolean);
    if (!clientId) return { client: null, scopes };
    const [row] = await db
        .select({
            name: authOauthClient.name,
            icon: authOauthClient.icon,
            redirectUris: authOauthClient.redirectUris,
            referenceId: authOauthClient.referenceId,
        })
        .from(authOauthClient)
        .where(eq(authOauthClient.clientId, clientId))
        .limit(1);
    const cimdHost = clientId.startsWith("https://") ? host(clientId) : null;
    const ownedBy = row?.referenceId && /^\d+$/.test(row.referenceId) ? row.referenceId : null;
    const addedByWorkspace = ownedBy
        ? ((await activeWorkspaceOptions(authUserId)).find(w => w.id === ownedBy)?.name ?? null)
        : null;
    return {
        client: {
            clientId,
            name: filled(row?.name) ?? cimdHost ?? "An assistant",
            icon: cimdHost || addedByWorkspace ? (row?.icon ?? null) : null,
            redirectHost: host(first(params.redirect_uri)) ?? host(row?.redirectUris?.[0]),
            verifiedDomain: cimdHost,
            addedByWorkspace,
        },
        scopes,
    };
}

export interface WorkspaceOption {
    id: string;
    name: string;
    role: string;
}

/** Workspaces the person is an active member of, most recently opened first. */
export async function activeWorkspaceOptions(authUserId: string): Promise<WorkspaceOption[]> {
    const rows = await db
        .select({
            id: company.id,
            name: company.name,
            role: userCompanyMemberships.role,
        })
        .from(userCompanyMemberships)
        .innerJoin(users, eq(users.id, userCompanyMemberships.userId))
        .innerJoin(company, eq(company.id, userCompanyMemberships.companyId))
        .where(and(eq(users.userId, authUserId), eq(userCompanyMemberships.status, "active")))
        .orderBy(desc(userCompanyMemberships.lastOpenedAt));
    return rows.map(r => ({ id: String(r.id), name: r.name, role: r.role }));
}

export async function workspaceName(companyId: string): Promise<string | null> {
    const [row] = await db
        .select({ name: company.name })
        .from(company)
        .where(eq(company.id, Number(companyId)))
        .limit(1);
    return row?.name ?? null;
}

/** Plain-language lines for the consent screen, one per thing granted. */
/** What a connection may do, one line each, in the order the consent screen lists them. */
export type ScopeLine = "read" | "write" | "identity" | "offline";

export function scopeLines(
    scopes: string[],
    access: { canRead: boolean; canSave: boolean }
): ScopeLine[] {
    const lines: ScopeLine[] = [];
    // A scope the person's role cannot use is never offered by the server
    // (tools/list filters by permission), so it is not promised here either.
    if (scopes.includes(MCP_SCOPE_READ) && access.canRead) lines.push("read");
    if (scopes.includes(MCP_SCOPE_WRITE) && access.canSave) lines.push("write");
    if (scopes.some(s => s === "openid" || s === "profile" || s === "email")) {
        lines.push("identity");
    }
    if (scopes.includes("offline_access")) lines.push("offline");
    return lines;
}

/** The lines in English; the consent screen words them with `auth.oauth.scopes`. */
export function describeScopes(
    scopes: string[],
    workspace: string,
    access: { canRead: boolean; canSave: boolean }
): string[] {
    const english: Record<ScopeLine, string> = {
        read: `Search and read the files you can open in ${workspace}`,
        write: `Save conversations to ${workspace}, visible only to you, with a follow-up note LaunchStack writes`,
        identity: "See your name and email address",
        offline: "Stay connected until you disconnect it in Settings",
    };
    return scopeLines(scopes, access).map(line => english[line]);
}
