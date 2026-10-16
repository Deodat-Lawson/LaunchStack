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
 * to verification MCP offers.
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

export async function loadConnectRequest(params: SearchParams): Promise<ConnectRequest> {
    const clientId = first(params.client_id);
    const scopes = (first(params.scope) ?? "").split(/\s+/).filter(Boolean);
    if (!clientId) return { client: null, scopes };
    const [row] = await db
        .select({
            name: authOauthClient.name,
            icon: authOauthClient.icon,
            redirectUris: authOauthClient.redirectUris,
        })
        .from(authOauthClient)
        .where(eq(authOauthClient.clientId, clientId))
        .limit(1);
    const cimdHost = clientId.startsWith("https://") ? host(clientId) : null;
    return {
        client: {
            clientId,
            name: filled(row?.name) ?? cimdHost ?? "An assistant",
            icon: row?.icon ?? null,
            redirectHost: host(first(params.redirect_uri)) ?? host(row?.redirectUris?.[0]),
            verifiedDomain: cimdHost,
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
export function describeScopes(scopes: string[], workspace: string): string[] {
    const lines: string[] = [];
    if (scopes.includes(MCP_SCOPE_READ)) {
        lines.push(`Search and read the files you can open in ${workspace}`);
    }
    if (scopes.includes(MCP_SCOPE_WRITE)) {
        lines.push(
            `Save conversations to ${workspace}, visible only to you, with a follow-up note LaunchStack writes`
        );
    }
    if (scopes.some(s => s === "openid" || s === "profile" || s === "email")) {
        lines.push("See your name and email address");
    }
    if (scopes.includes("offline_access")) {
        lines.push("Stay connected until you disconnect it in Settings");
    }
    return lines;
}
