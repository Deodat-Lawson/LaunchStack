/**
 * Words for the People section: times people can read, and one sentence per
 * audit event. Pure, so the sentences are pinned by tests rather than by
 * whoever last looked at the screen.
 */

import { roleLabel } from "~/lib/authz/permissions";
import type { AuditEvent } from "./api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or the date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
    if (!iso) return "Never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "Unknown";
    const diff = now - then;
    if (diff < MINUTE) return "just now";
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
    const days = Math.floor(diff / DAY);
    if (days === 1) return "yesterday";
    if (days < 14) return `${days} days ago`;
    return new Date(then).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/** "in 3 days", "in 2 h", "expired 4 days ago" — for expiry columns. */
export function untilTime(iso: string | null | undefined, now: number = Date.now()): string {
    if (!iso) return "Never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "Unknown";
    const diff = then - now;
    if (diff <= 0) return `expired ${relativeTime(iso, now)}`;
    if (diff < HOUR) return `in ${Math.max(1, Math.floor(diff / MINUTE))} min`;
    if (diff < DAY) return `in ${Math.floor(diff / HOUR)} h`;
    const days = Math.round(diff / DAY);
    return `in ${days} ${days === 1 ? "day" : "days"}`;
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

// ---------------------------------------------------------------------------
// Audit sentences
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The first present string among several candidate detail keys. */
function pick(detail: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = str(detail[key]);
        if (value) return value;
    }
    return null;
}

function roleWords(detail: Record<string, unknown>, ...keys: string[]): string | null {
    const slug = pick(detail, ...keys);
    if (!slug) return null;
    const nameKey = keys.map(k => `${k}Name`);
    const name = pick(detail, ...nameKey);
    return roleLabel(slug, name);
}

function possessive(name: string): string {
    return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

/** Splits `member.role_changed` into `["member", "role changed"]`. */
function splitAction(action: string): [string, string] {
    const [subject = "", ...rest] = action.split(".");
    const verb = rest.join(" ").replace(/[_-]+/g, " ").trim();
    return [subject.replace(/[_-]+/g, " "), verb];
}

/**
 * One sentence for an audit row: who did what to whom.
 *
 * Known actions get a hand-written sentence; anything else falls back to
 * "<actor> <verb> <target>", which stays readable for actions added later.
 */
export function auditSentence(
    event: Pick<AuditEvent, "action" | "actor" | "targetType" | "targetId" | "detail">
): string {
    // A blank name reads as "no name": fall through to the email, then "Someone".
    const actor = str(event.actor?.name)?.trim() ?? event.actor?.email ?? "Someone";
    const detail = event.detail ?? {};
    const target =
        pick(detail, "targetName", "memberName", "name", "email", "title", "folderName") ??
        (event.targetId ? `${event.targetType} ${event.targetId}` : event.targetType);

    switch (event.action) {
        case "member.role_changed":
        case "member.role.changed": {
            const from = roleWords(detail, "fromRole", "from", "previousRole");
            const to = roleWords(detail, "toRole", "to", "role", "newRole");
            if (from && to)
                return `${actor} changed ${possessive(target)} role from ${from} to ${to}`;
            if (to)
                return `${actor} made ${target} ${to === "Owner" ? "the Owner" : `an ${to}`}`
                    .replace("an Member", "a Member")
                    .replace("an Viewer", "a Viewer")
                    .replace("an Guest", "a Guest");
            return `${actor} changed ${possessive(target)} role`;
        }
        case "member.approved":
            return `${actor} approved ${target} to join`;
        case "member.suspended":
            return `${actor} suspended ${possessive(target)} access`;
        case "member.reinstated":
        case "member.unsuspended":
            return `${actor} reinstated ${possessive(target)} access`;
        case "member.removed":
            return `${actor} removed ${target} from the workspace`;
        case "member.left":
            return `${actor} left the workspace`;
        case "member.joined":
            return `${actor} joined the workspace`;
        case "workspace.ownership_transferred":
        case "workspace.transferred":
            return `${actor} transferred ownership to ${target}`;
        case "invitation.created":
        case "invitation.sent": {
            const role = roleWords(detail, "role");
            return `${actor} invited ${target}${role ? ` as ${role}` : ""}`;
        }
        case "invitation.resent":
            return `${actor} resent the invitation to ${target}`;
        case "invitation.revoked":
            return `${actor} revoked the invitation to ${target}`;
        case "invitation.accepted":
            return `${actor} accepted an invitation to join`;
        case "join_link.created":
        case "join-link.created": {
            const role = roleWords(detail, "role");
            return `${actor} created a join link${role ? ` for ${role}s` : ""}`;
        }
        case "join_link.revoked":
        case "join-link.revoked":
            return `${actor} revoked a join link`;
        case "join_link.used":
        case "join-link.used":
            return `${actor} joined with a link`;
        case "group.created":
            return `${actor} created the group ${target}`;
        case "group.updated":
        case "group.renamed":
            return `${actor} renamed a group to ${target}`;
        case "group.deleted": {
            const removed = num(detail.removedGrants);
            return `${actor} deleted the group ${target}${
                removed !== null ? ` (${plural(removed, "access grant")} removed)` : ""
            }`;
        }
        case "group.members_added":
        case "group.member_added": {
            const count =
                num(detail.count) ?? (Array.isArray(detail.userIds) ? detail.userIds.length : null);
            const who = pick(detail, "memberName", "userName");
            return `${actor} added ${who ?? (count !== null ? plural(count, "person", "people") : "people")} to ${target}`;
        }
        case "group.members_removed":
        case "group.member_removed": {
            const count =
                num(detail.count) ?? (Array.isArray(detail.userIds) ? detail.userIds.length : null);
            const who = pick(detail, "memberName", "userName");
            return `${actor} removed ${who ?? (count !== null ? plural(count, "person", "people") : "people")} from ${target}`;
        }
        case "role.created":
            return `${actor} created the role ${target}`;
        case "role.updated":
            return `${actor} changed the role ${target}`;
        case "role.deleted": {
            const reassigned = num(detail.reassigned);
            const to = roleWords(detail, "reassignTo", "reassignedTo");
            return `${actor} deleted the role ${target}${
                reassigned
                    ? ` and moved ${plural(reassigned, "member")} to ${to ?? "another role"}`
                    : ""
            }`;
        }
        case "folder.access_changed":
        case "folder.visibility_changed": {
            const visibility = pick(detail, "visibility", "to");
            if (visibility === "workspace")
                return `${actor} opened the folder ${target} to the workspace`;
            if (visibility === "restricted") return `${actor} restricted the folder ${target}`;
            return `${actor} changed who can see the folder ${target}`;
        }
        case "document.access_changed":
        case "document.restricted": {
            const restricted = detail.restricted;
            if (restricted === true) return `${actor} restricted the document ${target}`;
            if (restricted === false) return `${actor} lifted the restriction on ${target}`;
            return `${actor} changed who can see the document ${target}`;
        }
        case "member.invited": {
            const role = roleWords(detail, "role");
            const email = pick(detail, "email") ?? target;
            return `${actor} invited ${email}${role ? ` as ${role}` : ""}`;
        }
        case "ownership.transferred":
            return `${actor} transferred ownership to ${target}`;
        case "folder.created":
            return `${actor} created the folder ${target}`;
        case "folder.renamed": {
            const from = pick(detail, "from", "previousName");
            return from
                ? `${actor} renamed the folder ${from} to ${target}`
                : `${actor} renamed the folder ${target}`;
        }
        case "folder.deleted":
            return `${actor} deleted the folder ${target}`;
        case "folder.grant_added":
        case "document.grant_added": {
            const who = pick(detail, "principalName", "principalId");
            const level = pick(detail, "level");
            const kind = event.action.startsWith("folder") ? "folder" : "document";
            return `${actor} gave ${who ?? "someone"} ${level ?? "access"} on the ${kind} ${target}`;
        }
        case "folder.grant_changed":
        case "document.grant_changed": {
            const who = pick(detail, "principalName", "principalId");
            const level = pick(detail, "level", "to");
            const kind = event.action.startsWith("folder") ? "folder" : "document";
            return `${actor} changed ${who ?? "someone"} to ${level ?? "a different level"} on the ${kind} ${target}`;
        }
        case "folder.grant_removed":
        case "document.grant_removed": {
            const who = pick(detail, "principalName", "principalId");
            const kind = event.action.startsWith("folder") ? "folder" : "document";
            return `${actor} removed ${who ?? "someone"}'s access to the ${kind} ${target}`;
        }
        case "document.unrestricted":
            return `${actor} lifted the restriction on ${target}`;
        case "document.deleted":
            return `${actor} deleted the document ${target}`;
        case "connector.connected": {
            const provider = pick(detail, "provider") ?? target;
            return `${actor} connected ${provider}`;
        }
        case "connector.disconnected": {
            const provider = pick(detail, "provider") ?? target;
            return `${actor} disconnected ${provider}`;
        }
        case "settings.changed":
        case "workspace.settings_updated":
        case "settings.updated": {
            const policy = pick(detail, "joinPolicy");
            if (policy === "open") return `${actor} let anyone with a link join immediately`;
            if (policy === "approval") return `${actor} required approval for new members`;
            return `${actor} changed workspace settings`;
        }
        default: {
            const [subject, verb] = splitAction(event.action);
            const what = target && target !== event.targetType ? target : subject;
            return `${actor} ${verb || "changed"} ${what}`.trim();
        }
    }
}

/** A short label for the action filter: `member.role_changed` → "Member · role changed". */
export function actionLabel(action: string): string {
    const [subject, verb] = splitAction(action);
    const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    return verb ? `${cap(subject)} · ${verb}` : cap(subject);
}
