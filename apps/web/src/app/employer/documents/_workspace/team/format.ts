/**
 * Words for the team layer: short times, one sentence per activity row and
 * per inbox entry, and what a row opens. Pure, so the sentences are pinned by
 * tests rather than by whoever last looked at the rail.
 */

import { displayFolderPath, folderLeafName, folderParentPath } from "~/lib/folders/path";

import type { ActivityRow, InboxEntry, SharedItem } from "./api";
import type { TeamTarget } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", then "Oct 3" (with the year once it is not this one). */
export function shortAgo(iso: string, now: number = Date.now()): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diff = now - then;
    if (diff < MINUTE) return "now";
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
    if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
}

function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** The local calendar day an activity row falls on, as a stable key: "2026-10-13". */
export function dayKey(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A day heading in the feed: "Today", "Yesterday", "Monday, Oct 6" (with the year once it is not this one). */
export function dayLabel(iso: string, now: number = Date.now()): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
}

/** "2:14 PM" — the time on a row under its day heading. */
export function timeOfDay(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Ada", "Ada and Ben", "Ada, Ben and 2 others". */
export function joinNames(names: readonly string[], max = 2): string {
    const list = names.filter(n => n.trim().length > 0);
    if (list.length === 0) return "";
    if (list.length === 1) return list[0]!;
    if (list.length <= max) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    const rest = list.length - max;
    return `${list.slice(0, max).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

export const LEVEL_LABEL: Record<SharedItem["level"], string> = {
    view: "Can view",
    edit: "Can edit",
    manage: "Can manage",
};

function str(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function names(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** How a target reads in a sentence: folders by their own name, the rest as labelled. */
export function targetName(type: string, label: string): string {
    return type === "folder" ? folderLeafName(label) : label;
}

/**
 * One activity row as three pieces, so the target in the middle can be a
 * link: `{actor} {before} {target}{after}` — "Ben shared | Finance | with
 * Sales team".
 */
export function activityParts(
    row: Pick<ActivityRow, "verb" | "targetType" | "targetLabel" | "targetPath" | "detail">
): {
    before: string;
    target: string;
    after: string;
} {
    const detail = row.detail ?? {};
    const target = targetName(row.targetType, row.targetLabel);
    switch (row.verb) {
        case "added":
            return { before: "added", target, after: "" };
        case "created_folder":
            return { before: "created the folder", target, after: "" };
        case "created_group":
            return { before: "created the group", target, after: "" };
        case "renamed": {
            const from = str(detail.from);
            const fromName = from ? targetName(row.targetType, from) : null;
            return fromName && fromName !== target
                ? { before: `renamed ${fromName} to`, target, after: "" }
                : { before: "renamed", target, after: "" };
        }
        case "moved": {
            if (row.targetType === "folder") {
                const parent = folderParentPath(row.targetPath ?? str(detail.to) ?? "");
                return {
                    before: "moved",
                    target,
                    after: parent ? ` to ${displayFolderPath(parent)}` : " to the top level",
                };
            }
            // A file names the folder it landed in; none reads as Unfiled.
            const folder = str(row.targetPath) ?? str(detail.to) ?? "";
            return { before: "moved", target, after: ` to ${displayFolderPath(folder)}` };
        }
        case "deleted":
            return { before: "deleted", target, after: "" };
        case "shared": {
            if (detail.everyone === true)
                return { before: "shared", target, after: " with everyone" };
            const added = joinNames(names(detail.added));
            return { before: "shared", target, after: added ? ` with ${added}` : "" };
        }
        case "unshared": {
            if (detail.restricted === true) {
                return { before: "limited who can see", target, after: "" };
            }
            const removed = joinNames(names(detail.removed));
            return removed
                ? { before: `removed ${removed} from`, target, after: "" }
                : { before: "changed who can see", target, after: "" };
        }
        case "forked":
            return { before: "continued", target, after: " in a new chat" };
        default:
            return { before: String(row.verb).replace(/_/g, " "), target, after: "" };
    }
}

/** The whole sentence, for filtering and for screen readers. */
export function activitySentence(actor: string, row: Parameters<typeof activityParts>[0]): string {
    const { before, target, after } = activityParts(row);
    return `${actor} ${before} ${target}${after}`;
}

/** What an activity row opens, or null for a group (handled in the panel) and for the gone. */
export function activityTarget(row: ActivityRow): TeamTarget | null {
    if (!row.openable) return null;
    if (row.targetType === "document" && row.targetId && /^\d+$/.test(row.targetId)) {
        return { type: "document", id: Number(row.targetId) };
    }
    if (row.targetType === "folder" && row.targetPath)
        return { type: "folder", path: row.targetPath };
    if (row.targetType === "chat" && row.targetId) return { type: "chat", id: row.targetId };
    return null;
}

/** "Ada shared “Q3 plan” with you" — or "…with Sales team" when it came through a group. */
export function inboxSentence(
    actor: string,
    entry: Pick<InboxEntry, "targetType" | "targetLabel" | "detail">
): string {
    const detail = entry.detail ?? {};
    const group = detail.via === "group" ? str(detail.groupName) : null;
    return `${actor} shared “${targetName(entry.targetType, entry.targetLabel)}” with ${group ?? "you"}`;
}

/** What an inbox entry opens. */
export function inboxTarget(entry: InboxEntry): TeamTarget | null {
    if (entry.targetType === "document") {
        return /^\d+$/.test(entry.targetId)
            ? { type: "document", id: Number(entry.targetId) }
            : null;
    }
    if (entry.targetType === "folder") {
        const path = str(entry.detail?.path) ?? str(entry.targetLabel);
        return path ? { type: "folder", path } : null;
    }
    if (entry.targetType === "chat") return { type: "chat", id: entry.targetId };
    return null;
}

/** What a shared item opens, and what the Share dialog needs to be opened on it. */
export function itemTarget(item: Pick<SharedItem, "type" | "id" | "path" | "name">): TeamTarget {
    if (item.type === "folder") return { type: "folder", path: item.path ?? item.name };
    if (item.type === "chat") return { type: "chat", id: String(item.id) };
    return { type: "document", id: Number(item.id) };
}

/** Badge count text: "1"…"9", then "9+". */
export function badgeCount(unread: number): string {
    return unread > 9 ? "9+" : String(unread);
}
