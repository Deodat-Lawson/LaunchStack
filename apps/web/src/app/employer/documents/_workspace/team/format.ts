/**
 * Words for the team layer: short times, one sentence per activity row and
 * per inbox entry, and what a row opens. Pure, so the sentences are pinned by
 * tests rather than by whoever last looked at the rail: each takes the
 * `team.format` translator and the locale (`useTeamFormat()` in a component).
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { displayFolderPath, folderLeafName, folderParentPath } from "~/lib/folders/path";

import type { ActivityRow, InboxEntry, SharedItem } from "./api";
import type { TeamTarget } from "./types";

export type TeamFormatTranslator = ReturnType<typeof useTranslations<"team.format">>;

/** What every function here needs to word something: the messages and the locale for dates. */
export interface TeamFormat {
    t: TeamFormatTranslator;
    locale: string;
}

/** The `team.format` messages and the reader's locale, for the functions below. */
export function useTeamFormat(): TeamFormat {
    const t = useTranslations("team.format");
    const locale = useLocale();
    return useMemo(() => ({ t, locale }), [t, locale]);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "2h", "3d", then "Oct 3" (with the year once it is not this one). */
export function shortAgo(f: TeamFormat, iso: string, now: number = Date.now()): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diff = now - then;
    if (diff < MINUTE) return f.t("ago.now");
    if (diff < HOUR) return f.t("ago.minutes", { count: Math.floor(diff / MINUTE) });
    if (diff < DAY) return f.t("ago.hours", { count: Math.floor(diff / HOUR) });
    if (diff < 7 * DAY) return f.t("ago.days", { count: Math.floor(diff / DAY) });
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(f.locale, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    }).format(date);
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
export function dayLabel(f: TeamFormat, iso: string, now: number = Date.now()): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
    if (days === 0) return f.t("today");
    if (days === 1) return f.t("yesterday");
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(f.locale, {
        weekday: "long",
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    }).format(date);
}

/** "2:14 PM" — the time on a row under its day heading. */
export function timeOfDay(locale: string, iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d);
}

/** The full date and time, for a row's tooltip. */
export function fullDateTime(locale: string, iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
    }).format(d);
}

/** "Ada", "Ada and Ben", "Ada, Ben and 2 others". */
export function joinNames(f: TeamFormat, names: readonly string[], max = 2): string {
    const list = names.filter(n => n.trim().length > 0);
    if (list.length === 0) return "";
    if (list.length === 1) return list[0]!;
    const separator = f.t("names.separator");
    if (list.length <= max) {
        return f.t("names.pair", {
            first: list.slice(0, -1).join(separator),
            last: list[list.length - 1]!,
        });
    }
    return f.t("names.others", {
        names: list.slice(0, max).join(separator),
        count: list.length - max,
    });
}

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

export type ActivityMessageKey =
    | "added"
    | "createdFolder"
    | "createdGroup"
    | "renamed"
    | "renamedFrom"
    | "movedTo"
    | "movedToTop"
    | "deleted"
    | "shared"
    | "sharedWith"
    | "sharedWithEveryone"
    | "limited"
    | "removedFrom"
    | "changedAudience"
    | "forked"
    | "other";

/**
 * One activity row as a message (`team.format.activity.<key>`) and its
 * values. The message marks the actor and the target with `<person>` and
 * `<target>`, so the target can be a link wherever the language puts it:
 * "Ben shared <target>Finance</target> with Sales team".
 */
export function activityMessage(
    f: TeamFormat,
    row: Pick<ActivityRow, "verb" | "targetType" | "targetLabel" | "targetPath" | "detail">
): { key: ActivityMessageKey; values: Record<string, string> } {
    const detail = row.detail ?? {};
    const name = targetName(row.targetType, row.targetLabel);
    switch (row.verb) {
        case "added":
            return { key: "added", values: { name } };
        case "created_folder":
            return { key: "createdFolder", values: { name } };
        case "created_group":
            return { key: "createdGroup", values: { name } };
        case "renamed": {
            const from = str(detail.from);
            const fromName = from ? targetName(row.targetType, from) : null;
            return fromName && fromName !== name
                ? { key: "renamedFrom", values: { name, from: fromName } }
                : { key: "renamed", values: { name } };
        }
        case "moved": {
            if (row.targetType === "folder") {
                const parent = folderParentPath(row.targetPath ?? str(detail.to) ?? "");
                return parent
                    ? { key: "movedTo", values: { name, folder: displayFolderPath(parent) } }
                    : { key: "movedToTop", values: { name } };
            }
            // A file names the folder it landed in; none reads as Unfiled.
            const folder = str(row.targetPath) ?? str(detail.to) ?? "";
            return { key: "movedTo", values: { name, folder: displayFolderPath(folder) } };
        }
        case "deleted":
            return { key: "deleted", values: { name } };
        case "shared": {
            if (detail.everyone === true) return { key: "sharedWithEveryone", values: { name } };
            const added = joinNames(f, names(detail.added));
            return added
                ? { key: "sharedWith", values: { name, names: added } }
                : { key: "shared", values: { name } };
        }
        case "unshared": {
            if (detail.restricted === true) return { key: "limited", values: { name } };
            const removed = joinNames(f, names(detail.removed));
            return removed
                ? { key: "removedFrom", values: { name, names: removed } }
                : { key: "changedAudience", values: { name } };
        }
        case "forked":
            return { key: "forked", values: { name } };
        default:
            return { key: "other", values: { name, verb: String(row.verb).replace(/_/g, " ") } };
    }
}

/** The whole sentence, for filtering and for screen readers. */
export function activitySentence(
    f: TeamFormat,
    actor: string,
    row: Parameters<typeof activityMessage>[1]
): string {
    const { key, values } = activityMessage(f, row);
    return f.t.markup(`activity.${key}`, {
        ...values,
        actor,
        person: chunks => chunks,
        target: chunks => chunks,
    });
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
    f: TeamFormat,
    actor: string,
    entry: Pick<InboxEntry, "targetType" | "targetLabel" | "detail">
): string {
    const detail = entry.detail ?? {};
    const group = detail.via === "group" ? str(detail.groupName) : null;
    const name = targetName(entry.targetType, entry.targetLabel);
    return group
        ? f.t("inbox.sharedWithGroup", { actor, name, group })
        : f.t("inbox.sharedWithYou", { actor, name });
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
