/**
 * The Share dialog's adapter for chats (ADR-014).
 *
 * Contract with `/api/workspace/sessions/[sessionId]/sharing`:
 *
 *   GET  → ChatSharing
 *   PUT  { general: "private" | "workspace", grants: GrantInput[] } → ChatSharing
 *
 * Grants are people, groups or roles at level `view`; "Everyone at
 * <workspace>" is `general: "workspace"` (stored as a `workspace` principal).
 * Only the owner may change it; anyone who can read the chat may look.
 */

import type { GrantLevel, PrincipalType } from "~/lib/authz/permissions";

import type { OwnerRef } from "../settings/people/api";
import type { ShareAdapter, ShareGrant } from "./ShareDialog";

export interface ChatSharing {
    general: "private" | "workspace";
    grants: {
        principalType: PrincipalType;
        principalId: string;
        principalName: string;
        level: GrantLevel;
        authUserId: string | null;
    }[];
    canManage: boolean;
    owner: OwnerRef;
    workspaceName: string;
    /** Active members who can read it, owner included. */
    audienceCount: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        credentials: "same-origin",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
    // No server sentence: an empty message lets the dialog say it in the reader's words.
    if (!res.ok) throw new Error(body.error ?? "");
    return body;
}

const url = (id: string) => `/api/workspace/sessions/${encodeURIComponent(id)}/sharing`;

export const chatShareAdapter: ShareAdapter = {
    async load(target) {
        if (target.kind !== "chat") throw new Error("Not a chat");
        const res = await call<ChatSharing>(url(target.id));
        return {
            general: res.general === "workspace" ? "open" : "restricted",
            grants: res.grants.map(
                (g): ShareGrant => ({
                    ...g,
                    level: "view",
                    authUserId: g.authUserId,
                })
            ),
            canManage: res.canManage,
            open: { kind: "workspace", workspaceName: res.workspaceName, verb: "read" },
            levels: ["view"],
            owner: res.owner,
            audienceCount: res.audienceCount,
        };
    },
    async save(target, next) {
        if (target.kind !== "chat") throw new Error("Not a chat");
        await call<ChatSharing>(url(target.id), {
            method: "PUT",
            body: JSON.stringify({
                general: next.general === "open" ? "workspace" : "private",
                grants: next.grants.map(g => ({
                    principalType: g.principalType,
                    principalId: g.principalId,
                    level: "view",
                })),
            }),
        });
    },
};
