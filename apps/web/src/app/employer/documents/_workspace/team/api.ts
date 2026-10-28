/**
 * The team layer's routes, typed once (ADR-014 §7). People, groups and
 * invitations go through Settings › People's client (`peopleApi`); this adds
 * the inbox, the activity feed, and "what we share".
 */

import type { FEEDBACK_NOTIFICATION_TARGET } from "~/lib/feedback/contract";
import type { ActivityKind } from "~/lib/workspace-activity-kinds";

import { request } from "../settings/people/api";

export type ItemType = "folder" | "document" | "chat";

export interface InboxEntry {
    id: number;
    kind: string;
    /** Auth subject id of who shared it. */
    actorUserId: string;
    /** What was shared — or `feedback`: a reply to, or status change on, a report of yours. */
    targetType: ItemType | typeof FEEDBACK_NOTIFICATION_TARGET;
    targetId: string;
    targetLabel: string;
    /** `{ level, via: "direct" | "group", groupName?, path? }`; for feedback, `FeedbackNotificationDetail`. */
    detail: Record<string, unknown> | null;
    at: string;
    read: boolean;
}

export type ActivityVerb =
    | "added"
    | "created_folder"
    | "renamed"
    | "moved"
    | "deleted"
    | "shared"
    | "unshared"
    | "forked"
    | "created_group";

export interface ActivityRow {
    id: number;
    actorUserId: string;
    verb: ActivityVerb | (string & {});
    targetType: ItemType | "group";
    targetId: string | null;
    targetLabel: string;
    targetPath: string | null;
    detail: Record<string, unknown> | null;
    at: string;
    /** The target is still there to open. */
    openable: boolean;
}

export interface SharedItem {
    type: ItemType;
    id: number | string;
    name: string;
    path?: string;
    level: "view" | "edit" | "manage";
    at: string;
    viaGroup?: string;
}

export interface ShareableItem {
    type: ItemType;
    id: number | string;
    name: string;
    path?: string;
}

function query(params: Record<string, string | number | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        search.set(key, String(value));
    }
    const out = search.toString();
    return out ? `?${out}` : "";
}

export const teamApi = {
    inbox: {
        list: () =>
            request<{ entries: InboxEntry[]; unread: number }>("/api/workspace/notifications"),
        markRead: (ids?: number[]) =>
            request<{ success: boolean }>("/api/workspace/notifications/read", {
                method: "POST",
                body: JSON.stringify(ids ? { ids } : {}),
            }),
    },
    activity: (
        params: {
            before?: number | null;
            limit?: number;
            actor?: string;
            kind?: ActivityKind;
        } = {}
    ) =>
        request<{ entries: ActivityRow[]; nextBefore: number | null }>(
            `/api/workspace/activity${query({
                before: params.before,
                limit: params.limit,
                actor: params.actor,
                kind: params.kind,
            })}`
        ),
    sharedWith: (userPk: number) =>
        request<{ sharedWithMe: SharedItem[]; iShared: SharedItem[] }>(
            `/api/workspace/team/people/${userPk}/shared`
        ),
    shareable: () => request<{ items: ShareableItem[] }>("/api/workspace/team/shareable"),
};
