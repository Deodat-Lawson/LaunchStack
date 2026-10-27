/**
 * Words for the People section: times people can read, and one sentence per
 * audit event. Pure, so the sentences are pinned by tests rather than by
 * whoever last looked at the screen. The words come from the
 * `settings.people.format` and `settings.people.audit` messages; a component
 * gets the translators from `useTimeFormat` / `useTranslations`.
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { roleLabel } from "~/lib/authz/permissions";
import type { WorkspaceDetailsPatch } from "~/lib/workspace-details";

import type { AuditEvent } from "./api";

/** `useTranslations("settings.people.format")`. */
export type TimeT = ReturnType<typeof useTranslations<"settings.people.format">>;
/** `useTranslations("settings.people.audit")`. */
export type AuditT = ReturnType<typeof useTranslations<"settings.people.audit">>;

/** What the time words need: the messages, and the locale dates are written in. */
export interface TimeWords {
    t: TimeT;
    locale: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or the date. */
export function relativeTime(
    words: TimeWords,
    iso: string | null | undefined,
    now: number = Date.now()
): string {
    const { t } = words;
    if (!iso) return t("never");
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return t("unknown");
    const diff = now - then;
    if (diff < MINUTE) return t("justNow");
    if (diff < HOUR) return t("minutesAgo", { count: Math.floor(diff / MINUTE) });
    if (diff < DAY) return t("hoursAgo", { count: Math.floor(diff / HOUR) });
    const days = Math.floor(diff / DAY);
    if (days === 1) return t("yesterday");
    if (days < 14) return t("daysAgo", { count: days });
    return new Date(then).toLocaleDateString(words.locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/** "in 3 days", "in 2 h", "expired 4 days ago" — for expiry columns. */
export function untilTime(
    words: TimeWords,
    iso: string | null | undefined,
    now: number = Date.now()
): string {
    const { t } = words;
    if (!iso) return t("never");
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return t("unknown");
    const diff = then - now;
    if (diff <= 0) return t("expired", { when: relativeTime(words, iso, now) });
    if (diff < HOUR) return t("inMinutes", { count: Math.max(1, Math.floor(diff / MINUTE)) });
    if (diff < DAY) return t("inHours", { count: Math.floor(diff / HOUR) });
    return t("inDays", { count: Math.round(diff / DAY) });
}

export function formatDateTime(locale: string, iso: string | null | undefined): string {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** The time words in the reader's language, for a component. */
export function useTimeFormat(): {
    relative: (iso: string | null | undefined) => string;
    until: (iso: string | null | undefined) => string;
    dateTime: (iso: string | null | undefined) => string;
} {
    const t = useTranslations("settings.people.format");
    const locale = useLocale();
    return useMemo(() => {
        const words = { t, locale };
        return {
            relative: iso => relativeTime(words, iso),
            until: iso => untilTime(words, iso),
            dateTime: iso => formatDateTime(locale, iso),
        };
    }, [t, locale]);
}

/** English only — kept for the Team views that still build their own sentences. */
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

/** How an audit sentence names roles and settings, in the reader's language. */
export interface AuditNames {
    /** A role's name: a built-in's label, else the custom name, else the slug. */
    role?: (slug: string, customName: string | null) => string;
    /** A setting's label by its registry key; `stored` is what the event recorded. */
    setting?: (key: string | null, stored: string) => string;
}

function roleWords(
    names: AuditNames,
    detail: Record<string, unknown>,
    ...keys: string[]
): { slug: string; english: string; label: string } | null {
    const slug = pick(detail, ...keys);
    if (!slug) return null;
    const nameKey = keys.map(k => `${k}Name`);
    const name = pick(detail, ...nameKey);
    return { slug, english: roleLabel(slug, name), label: (names.role ?? roleLabel)(slug, name) };
}

/** Splits `member.role_changed` into `["member", "role changed"]`. */
function splitAction(action: string): [string, string] {
    const [subject = "", ...rest] = action.split(".");
    const verb = rest.join(" ").replace(/[_-]+/g, " ").trim();
    return [subject.replace(/[_-]+/g, " "), verb];
}

/** Roles English writes "a …" before; every other one gets "an …". */
const ARTICLE_A = new Set(["Member", "Viewer", "Guest"]);

/**
 * One sentence for an audit row: who did what to whom.
 *
 * Known actions get a hand-written sentence; anything else falls back to
 * "<actor> <verb> <target>", which stays readable for actions added later.
 */
export function auditSentence(
    t: AuditT,
    event: Pick<AuditEvent, "action" | "actor" | "targetType" | "targetId" | "detail">,
    names: AuditNames = {}
): string {
    // A blank name reads as "no name": fall through to the email, then "Someone".
    const actor = str(event.actor?.name)?.trim() ?? event.actor?.email ?? t("someone");
    const detail = event.detail ?? {};
    const target =
        pick(detail, "targetName", "memberName", "name", "email", "title", "folderName") ??
        (event.targetId ? `${event.targetType} ${event.targetId}` : event.targetType);
    const targetPossessive = t("possessive", {
        name: target,
        endsWithS: target.endsWith("s") ? "yes" : "no",
    });
    const kind = event.action.startsWith("folder") ? "folder" : "document";
    const level = (value: string | null, fallback: "access" | "different"): string => {
        if (value === "view" || value === "edit" || value === "manage") return t(`levels.${value}`);
        return value ?? t(`levels.${fallback}`);
    };
    const groupWho = (): { key: "Who" | "Count" | "Some"; who?: string; count?: number } => {
        const count =
            num(detail.count) ?? (Array.isArray(detail.userIds) ? detail.userIds.length : null);
        const who = pick(detail, "memberName", "userName");
        if (who) return { key: "Who", who };
        if (count !== null) return { key: "Count", count };
        return { key: "Some" };
    };

    switch (event.action) {
        case "member.role_changed":
        case "member.role.changed": {
            const from = roleWords(names, detail, "fromRole", "from", "previousRole");
            const to = roleWords(names, detail, "toRole", "to", "role", "newRole");
            if (from && to)
                return t("roleChanged", {
                    actor,
                    targetPossessive,
                    from: from.label,
                    to: to.label,
                });
            if (to) {
                // Decided on the English label, which a custom role may share.
                if (to.english === "Owner") return t("madeOwner", { actor, target });
                return ARTICLE_A.has(to.english)
                    ? t("madeA", { actor, target, to: to.label })
                    : t("madeAn", { actor, target, to: to.label });
            }
            return t("roleChangedBare", { actor, targetPossessive });
        }
        case "member.approved":
            return t("approved", { actor, target });
        case "member.suspended":
            return t("suspended", { actor, targetPossessive });
        case "member.reinstated":
        case "member.unsuspended":
            return t("reinstated", { actor, targetPossessive });
        case "member.removed":
            return t("removed", { actor, target });
        case "member.left":
            return t("left", { actor });
        case "member.joined":
            return t("joined", { actor });
        case "workspace.ownership_transferred":
        case "workspace.transferred":
            return t("transferred", { actor, target });
        case "invitation.created":
        case "invitation.sent": {
            const role = roleWords(names, detail, "role");
            return role
                ? t("invitedAs", { actor, target, role: role.label })
                : t("invited", { actor, target });
        }
        case "invitation.resent":
            return t("resent", { actor, target });
        case "invitation.revoked":
            return t("invitationRevoked", { actor, target });
        case "invitation.accepted":
            return t("invitationAccepted", { actor });
        case "join_link.created":
        case "join-link.created": {
            const role = roleWords(names, detail, "role");
            return role
                ? t("joinLinkCreatedFor", { actor, role: role.label })
                : t("joinLinkCreated", { actor });
        }
        case "join_link.updated": {
            const role = roleWords(names, detail, "role");
            const approval = detail.requiresApproval;
            if (approval === true) return t("joinLinkRequiresApproval", { actor });
            if (approval === false) return t("joinLinkOpen", { actor });
            return role
                ? t("joinLinkChangedTo", { actor, role: role.label })
                : t("joinLinkChanged", { actor });
        }
        case "join_link.revoked":
        case "join-link.revoked":
            return detail.reset === true
                ? t("joinLinkReset", { actor })
                : t("joinLinkRevoked", { actor });
        case "join_link.used":
        case "join-link.used":
            return t("joinLinkUsed", { actor });
        case "group.created":
            return t("groupCreated", { actor, target });
        case "group.updated":
        case "group.renamed":
            return t("groupRenamed", { actor, target });
        case "group.deleted": {
            const removed = num(detail.removedGrants);
            return removed !== null
                ? t("groupDeletedGrants", { actor, target, count: removed })
                : t("groupDeleted", { actor, target });
        }
        case "group.members_added":
        case "group.member_added": {
            const who = groupWho();
            if (who.key === "Who") return t("groupAddedWho", { actor, target, who: who.who! });
            if (who.key === "Count")
                return t("groupAddedCount", { actor, target, count: who.count! });
            return t("groupAddedSome", { actor, target });
        }
        case "group.members_removed":
        case "group.member_removed": {
            const who = groupWho();
            if (who.key === "Who") return t("groupRemovedWho", { actor, target, who: who.who! });
            if (who.key === "Count")
                return t("groupRemovedCount", { actor, target, count: who.count! });
            return t("groupRemovedSome", { actor, target });
        }
        case "role.created":
            return t("roleCreated", { actor, target });
        case "role.updated":
            return t("roleUpdated", { actor, target });
        case "role.deleted": {
            const reassigned = num(detail.reassigned);
            const to = roleWords(names, detail, "reassignTo", "reassignedTo");
            return reassigned
                ? t("roleDeletedMoved", {
                      actor,
                      target,
                      count: reassigned,
                      to: to?.label ?? t("anotherRole"),
                  })
                : t("roleDeleted", { actor, target });
        }
        case "folder.access_changed":
        case "folder.visibility_changed": {
            const visibility = pick(detail, "visibility", "to");
            if (visibility === "workspace") return t("folderOpened", { actor, target });
            if (visibility === "restricted") return t("folderRestricted", { actor, target });
            return t("folderAccessChanged", { actor, target });
        }
        case "document.access_changed":
        case "document.restricted": {
            const restricted = detail.restricted;
            if (restricted === true) return t("documentRestricted", { actor, target });
            if (restricted === false) return t("restrictionLifted", { actor, target });
            return t("documentAccessChanged", { actor, target });
        }
        case "member.invited": {
            const role = roleWords(names, detail, "role");
            const email = pick(detail, "email") ?? target;
            return role
                ? t("invitedAs", { actor, target: email, role: role.label })
                : t("invited", { actor, target: email });
        }
        case "ownership.transferred":
            return t("transferred", { actor, target });
        case "folder.created":
            return t("folderCreated", { actor, target });
        case "folder.renamed": {
            const from = pick(detail, "from", "previousName");
            return from
                ? t("folderRenamedFrom", { actor, from, target })
                : t("folderRenamed", { actor, target });
        }
        case "folder.deleted":
            return t("folderDeleted", { actor, target });
        case "folder.grant_added":
        case "document.grant_added": {
            const who = pick(detail, "principalName", "principalId") ?? t("someoneLower");
            return t("grantAdded", {
                actor,
                who,
                level: level(pick(detail, "level"), "access"),
                kind,
                target,
            });
        }
        case "folder.grant_changed":
        case "document.grant_changed": {
            const who = pick(detail, "principalName", "principalId") ?? t("someoneLower");
            return t("grantChanged", {
                actor,
                who,
                level: level(pick(detail, "level", "to"), "different"),
                kind,
                target,
            });
        }
        case "folder.grant_removed":
        case "document.grant_removed": {
            const who = pick(detail, "principalName", "principalId") ?? t("someoneLower");
            return t("grantRemoved", { actor, who, kind, target });
        }
        case "document.unrestricted":
            return t("restrictionLifted", { actor, target });
        case "document.deleted":
            return t("documentDeleted", { actor, target });
        case "connector.connected": {
            const provider = pick(detail, "provider") ?? target;
            return t("connectorConnected", { actor, provider });
        }
        case "connector.disconnected": {
            const provider = pick(detail, "provider") ?? target;
            return t("connectorDisconnected", { actor, provider });
        }
        case "settings.changed":
        case "workspace.settings_updated":
        case "settings.updated": {
            // Registry-backed writes carry the setting's own words.
            const stored = pick(detail, "label");
            if (typeof stored === "string") {
                const label = names.setting ? names.setting(pick(detail, "key"), stored) : stored;
                const scope = pick(detail, "scope");
                const scopeId = pick(detail, "scopeId");
                const folder = scope === "folder" && typeof scopeId === "string" ? scopeId : null;
                if (detail.reset === true) {
                    return folder
                        ? t("settingResetFolder", { actor, label, folder })
                        : t("settingReset", { actor, label });
                }
                const to = detail.to;
                const value =
                    to === null || to === undefined
                        ? t("valueOff")
                        : typeof to === "string" ||
                            typeof to === "number" ||
                            typeof to === "boolean"
                          ? String(to)
                          : t("valueNew");
                return folder
                    ? t("settingSetFolder", { actor, label, folder, value })
                    : t("settingSet", { actor, label, value });
            }
            // Workspace › General (and the audit retention policy) record
            // `changes: { field: { from, to } }`.
            const changed = workspaceChangeSentence(t, actor, detail.changes);
            if (changed) return changed;
            // A retired setting; its events stay readable in the log.
            const policy = pick(detail, "joinPolicy");
            if (policy === "open") return t("joinPolicyOpen", { actor });
            if (policy === "approval") return t("joinPolicyApproval", { actor });
            return t("workspaceSettingsChanged", { actor });
        }
        default: {
            const [subject, verb] = splitAction(event.action);
            const what = target && target !== event.targetType ? target : subject;
            return (
                verb ? t("fallback", { actor, verb, what }) : t("fallbackChanged", { actor, what })
            ).trim();
        }
    }
}

/** The workspace's own fields an audit `changes` map can name: `settings.people.audit.workspaceFields`. */
const WORKSPACE_FIELD_KEYS = {
    name: "name",
    slug: "slug",
    description: "description",
    industry: "industry",
    teamSize: "teamSize",
    swatch: "swatch",
    auditRetentionDays: "auditRetentionDays",
} as const satisfies Record<keyof WorkspaceDetailsPatch | "auditRetentionDays", string>;

/**
 * "Ada renamed the workspace to “Northwind Labs”", "Ada changed the
 * workspace's URL and colour" — for a `changes` map, or null when there is
 * none.
 */
function workspaceChangeSentence(t: AuditT, actor: string, changes: unknown): string | null {
    if (!changes || typeof changes !== "object") return null;
    const fields = Object.keys(changes);
    if (fields.length === 0) return null;
    const renamed = str((changes as Record<string, { to?: unknown } | undefined>).name?.to);
    const others = fields
        .filter(field => !(field === "name" && renamed))
        .map(field =>
            Object.prototype.hasOwnProperty.call(WORKSPACE_FIELD_KEYS, field)
                ? t(
                      `workspaceFields.${WORKSPACE_FIELD_KEYS[field as keyof typeof WORKSPACE_FIELD_KEYS]}`
                  )
                : field
        );
    const last = others[others.length - 1];
    const list =
        others.length <= 1
            ? (last ?? "")
            : t("workspaceFields.list", {
                  rest: others.slice(0, -1).join(t("workspaceFields.separator")),
                  last: last!,
              });
    if (renamed) {
        return others.length > 0
            ? t("workspaceRenamedAndChanged", { actor, name: renamed, fields: list })
            : t("workspaceRenamed", { actor, name: renamed });
    }
    return t("workspaceChanged", { actor, fields: list });
}

/** `member.role_changed` → `["member", "roleChanged"]`: the message keys of an action. */
function actionKeys(action: string): [string, string] {
    const camel = (s: string) => s.replace(/[_-]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
    const [subject = "", ...rest] = action.split(".");
    return [camel(subject), camel(rest.join("_"))];
}

/** A short label for the action filter: `member.role_changed` → "Member · role changed". */
export function actionLabel(t: AuditT, action: string): string {
    const [subjectKey, verbKey] = actionKeys(action);
    const key = `actions.${subjectKey}.${verbKey || "all"}`;
    const loose = t as unknown as { (key: string): string; has: (key: string) => boolean };
    if (subjectKey && loose.has(key)) return loose(key);
    const [subject, verb] = splitAction(action);
    const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    return verb ? `${cap(subject)} · ${verb}` : cap(subject);
}
