/**
 * The workspace people-and-access API, typed once.
 *
 * Every tab in the People section talks to `/api/workspace/*` through this
 * file, so the contract lives in one place and a shape change is one edit.
 * Errors arrive as `ApiError` carrying the status and the server's `{ error }`
 * sentence, which is what the UI shows.
 */

import type {
    GrantLevel,
    JoinPolicy,
    MembershipStatus,
    PrincipalType,
} from "~/lib/authz/permissions";

export interface Member {
    id: number;
    authUserId: string;
    name: string;
    email: string;
    role: string;
    roleName: string;
    status: MembershipStatus;
    groups: { id: number; name: string }[];
    joinedAt: string;
    lastActiveAt: string | null;
    isSelf: boolean;
}

export interface MemberCounts {
    active: number;
    pending: number;
    suspended: number;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
    id: number;
    email: string;
    role: string;
    roleName: string;
    groupIds: number[];
    invitedBy: { name: string; email: string } | null;
    createdAt: string;
    expiresAt: string;
    status: InvitationStatus;
}

export interface InvitationPreview {
    workspaceName: string;
    workspaceSlug: string;
    role: string;
    roleName: string;
    email: string;
    expiresAt: string;
    status: InvitationStatus;
}

export interface JoinLink {
    id: number;
    code: string;
    role: string;
    roleName: string;
    isActive: boolean;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number | null;
    useCount: number;
    url: string;
}

export interface Group {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    memberCount: number;
    members: { id: number; name: string; email: string }[];
}

export interface Role {
    id: number | null;
    slug: string;
    name: string;
    description: string | null;
    permissions: string[];
    builtin: boolean;
    memberCount: number;
    assignable: boolean;
    editable: boolean;
}

export interface PermissionInfo {
    key: string;
    description: string;
    ownerOnly: boolean;
}

export interface AuditEvent {
    id: number;
    action: string;
    actor: { authUserId: string; name: string; email: string } | null;
    targetType: string;
    targetId: string | null;
    detail: Record<string, unknown> | null;
    createdAt: string;
}

export interface AuditQuery {
    cursor?: string | null;
    limit?: number;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
}

export interface WorkspaceSettings {
    joinPolicy: JoinPolicy;
    auditRetentionDays: number | null;
}

export interface Grant {
    id: number;
    principalType: PrincipalType;
    principalId: string;
    principalName: string;
    level: GrantLevel;
}

export interface GrantInput {
    principalType: PrincipalType;
    principalId: string;
    level: GrantLevel;
}

export interface FolderAccess {
    folder: { id: number; name: string };
    visibility: "workspace" | "restricted";
    grants: Grant[];
    audienceCount: number;
    canManage: boolean;
}

export interface DocumentAccess {
    document: { id: number; title: string };
    restricted: boolean;
    grants: Grant[];
    audienceCount: number;
    canManage: boolean;
}

export interface Principals {
    users: { id: number; name: string; email: string }[];
    groups: { id: number; name: string }[];
    roles: { slug: string; name: string }[];
}

export class ApiError extends Error {
    readonly status: number;
    readonly body: Record<string, unknown>;

    constructor(status: number, message: string, body: Record<string, unknown> = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
    }
}

export function isApiError(err: unknown): err is ApiError {
    return err instanceof ApiError;
}

/** The sentence to show for any failure, API-shaped or not. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.body !== undefined && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = null;
        }
    }
    if (!res.ok) {
        const record = (body ?? {}) as Record<string, unknown>;
        const message =
            typeof record.error === "string"
                ? record.error
                : typeof record.message === "string"
                  ? record.message
                  : res.status === 401
                    ? "You are signed out."
                    : res.status === 403
                      ? "You don't have permission to do that."
                      : `Request failed (${res.status}).`;
        throw new ApiError(res.status, message, record);
    }
    return body as T;
}

const json = (value: unknown): string => JSON.stringify(value);

function query(params: Record<string, string | number | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        search.set(key, String(value));
    }
    const out = search.toString();
    return out ? `?${out}` : "";
}

export const peopleApi = {
    members: {
        list: () => request<{ members: Member[]; counts: MemberCounts }>("/api/workspace/members"),
        update: (id: number, body: { role?: string; status?: "active" | "suspended" }) =>
            request<Member>(`/api/workspace/members/${id}`, { method: "PATCH", body: json(body) }),
        remove: (id: number) =>
            request<{ success: boolean }>(`/api/workspace/members/${id}`, { method: "DELETE" }),
        leave: () =>
            request<{ success: boolean; redirectTo: string }>("/api/workspace/members/leave", {
                method: "POST",
                body: "{}",
            }),
        transferOwnership: (userId: number) =>
            request<{ success: boolean }>("/api/workspace/transfer-ownership", {
                method: "POST",
                body: json({ userId }),
            }),
    },
    invitations: {
        list: () => request<{ invitations: Invitation[] }>("/api/workspace/invitations"),
        create: (body: { email: string; role: string; groupIds?: number[] }) =>
            request<{ invitation: Invitation; acceptUrl: string }>("/api/workspace/invitations", {
                method: "POST",
                body: json(body),
            }),
        resend: (id: number) =>
            request<{ invitation: Invitation; acceptUrl: string }>(
                `/api/workspace/invitations/${id}/resend`,
                { method: "POST", body: "{}" }
            ),
        revoke: (id: number) =>
            request<{ success: boolean }>(`/api/workspace/invitations/${id}`, {
                method: "DELETE",
            }),
        preview: (token: string) =>
            request<InvitationPreview>(`/api/workspace/invitations/preview${query({ token })}`),
        accept: (body: { token?: string; invitationId?: number; name?: string }) =>
            request<{
                success: boolean;
                companyId: number;
                redirectTo: string;
                alreadyMember: boolean;
            }>("/api/workspace/invitations/accept", { method: "POST", body: json(body) }),
    },
    joinLinks: {
        list: () => request<{ links: JoinLink[] }>("/api/workspace/join-links"),
        create: (body: { role: string; expiresInDays?: number | null; maxUses?: number | null }) =>
            request<{ link: JoinLink }>("/api/workspace/join-links", {
                method: "POST",
                body: json(body),
            }),
        revoke: (id: number) =>
            request<{ success: boolean }>(`/api/workspace/join-links/${id}`, {
                method: "DELETE",
            }),
    },
    groups: {
        list: () => request<{ groups: Group[] }>("/api/workspace/groups"),
        create: (body: { name: string; description?: string }) =>
            request<{ group: Group }>("/api/workspace/groups", {
                method: "POST",
                body: json(body),
            }),
        update: (id: number, body: { name?: string; description?: string }) =>
            request<{ group: Group }>(`/api/workspace/groups/${id}`, {
                method: "PATCH",
                body: json(body),
            }),
        remove: (id: number) =>
            request<{ success: boolean; removedGrants: number }>(`/api/workspace/groups/${id}`, {
                method: "DELETE",
            }),
        addMembers: (id: number, userIds: number[]) =>
            request<{ group: Group }>(`/api/workspace/groups/${id}/members`, {
                method: "POST",
                body: json({ userIds }),
            }),
        removeMembers: (id: number, userIds: number[]) =>
            request<{ group: Group }>(`/api/workspace/groups/${id}/members`, {
                method: "DELETE",
                body: json({ userIds }),
            }),
    },
    roles: {
        list: () =>
            request<{ roles: Role[]; permissions: PermissionInfo[] }>("/api/workspace/roles"),
        create: (body: { name: string; description?: string; permissions: string[] }) =>
            request<{ role: Role }>("/api/workspace/roles", { method: "POST", body: json(body) }),
        update: (
            id: number,
            body: { name?: string; description?: string; permissions?: string[] }
        ) =>
            request<{ role: Role }>(`/api/workspace/roles/${id}`, {
                method: "PATCH",
                body: json(body),
            }),
        remove: (id: number, reassignTo?: string) =>
            request<{ success: boolean; reassigned: number }>(`/api/workspace/roles/${id}`, {
                method: "DELETE",
                body: reassignTo ? json({ reassignTo }) : undefined,
            }),
    },
    audit: {
        list: (params: AuditQuery = {}) =>
            request<{ events: AuditEvent[]; nextCursor: string | null }>(
                `/api/workspace/audit${query({
                    cursor: params.cursor,
                    limit: params.limit,
                    action: params.action,
                    actor: params.actor,
                    from: params.from,
                    to: params.to,
                })}`
            ),
        csvUrl: (params: Omit<AuditQuery, "cursor" | "limit"> = {}) =>
            `/api/workspace/audit${query({
                action: params.action,
                actor: params.actor,
                from: params.from,
                to: params.to,
                format: "csv",
            })}`,
    },
    settings: {
        get: () => request<WorkspaceSettings>("/api/workspace/settings"),
        update: (body: Partial<WorkspaceSettings>) =>
            request<WorkspaceSettings>("/api/workspace/settings", {
                method: "PATCH",
                body: json(body),
            }),
    },
    access: {
        folderByPath: (path: string) =>
            request<FolderAccess>(
                `/api/workspace/folders/by-path?path=${encodeURIComponent(path)}`
            ),
        saveFolderByPath: (
            path: string,
            body: { visibility: "workspace" | "restricted"; grants: GrantInput[] }
        ) =>
            request<FolderAccess>(`/api/workspace/folders/by-path`, {
                method: "PUT",
                body: JSON.stringify({ path, ...body }),
            }),
        folder: (categoryId: number) =>
            request<FolderAccess>(`/api/workspace/folders/${categoryId}/access`),
        saveFolder: (
            categoryId: number,
            body: { visibility: "workspace" | "restricted"; grants: GrantInput[] }
        ) =>
            request<FolderAccess>(`/api/workspace/folders/${categoryId}/access`, {
                method: "PUT",
                body: json(body),
            }),
        document: (documentId: number) =>
            request<DocumentAccess>(`/api/workspace/documents/${documentId}/access`),
        saveDocument: (documentId: number, body: { restricted: boolean; grants: GrantInput[] }) =>
            request<DocumentAccess>(`/api/workspace/documents/${documentId}/access`, {
                method: "PUT",
                body: json(body),
            }),
        principals: (q: string) => request<Principals>(`/api/workspace/principals${query({ q })}`),
    },
};
