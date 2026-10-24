"use client";

/**
 * The one link an admin shares to bring people in: copy it, pick the role it
 * hands out, decide whether joiners wait for approval, reset it if it leaked.
 *
 * "The" link is the newest active link with no use cap and no expiry — the
 * everyday, open-ended one (see `pickInviteLink`). Capped or expiring links
 * are special-purpose and live under More links, so making or resetting one
 * there never swaps out the link people already have.
 */

import React, { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link2, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import { peopleApi, type JoinLink, type Role } from "./api";
import { untilTime, type TimeWords } from "./format";
import {
    ConfirmDialog,
    CopyButton,
    ErrorNote,
    LoadingNote,
    Panel,
    useErrorText,
    useRoleLabel,
} from "./ui";

export type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

/** `useTranslations("settings.people.links")`. */
export type LinksT = ReturnType<typeof useTranslations<"settings.people.links">>;

/** Whether a not-revoked link still lets people in. */
export function joinLinkState(link: JoinLink, now: number = Date.now()) {
    if (link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now) return "expired";
    if (link.maxUses !== null && link.useCount >= link.maxUses) return "used up";
    return "live";
}

/** "2 of 10 uses · expires in 3 days" — the terms a link was made with. */
export function joinLinkTerms(
    t: LinksT,
    words: TimeWords,
    link: JoinLink,
    now: number = Date.now()
): string {
    const uses =
        link.maxUses !== null
            ? t("terms.usesOf", { used: link.useCount, max: link.maxUses })
            : t("terms.uses", { count: link.useCount });
    // untilTime already says "expired 4 days ago" for a date in the past.
    const past = link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now;
    const expiry =
        link.expiresAt === null
            ? t("terms.neverExpires")
            : past
              ? untilTime(words, link.expiresAt, now)
              : t("terms.expires", { when: untilTime(words, link.expiresAt, now) });
    return t("terms.joined", { uses, expiry });
}

/** The terms in the reader's language, for a component. */
export function useJoinLinkTerms(): (link: JoinLink) => string {
    const t = useTranslations("settings.people.links");
    const tf = useTranslations("settings.people.format");
    const locale = useLocale();
    return useCallback(
        (link: JoinLink) => joinLinkTerms(t, { t: tf, locale }, link),
        [t, tf, locale]
    );
}

/** Open-ended: no use cap and no expiry. */
export function isOpenEnded(link: JoinLink): boolean {
    return link.maxUses === null && link.expiresAt === null;
}

/**
 * Splits the active links (newest first) into the card's link — the newest
 * open-ended one — and everything else.
 */
export function pickInviteLink(links: JoinLink[]): {
    primary: JoinLink | null;
    others: JoinLink[];
} {
    const primary = links.find(isOpenEnded) ?? null;
    return { primary, others: links.filter(l => l !== primary) };
}

/** The role a new invite link hands out: Member when offered, else the first. */
export function defaultRole(roles: RoleOption[]): string | null {
    return (roles.find(r => r.slug === "member") ?? roles[0])?.slug ?? null;
}

export function InviteLinkCard({
    link,
    roles,
    loading,
    onSaved,
    onRemoved,
}: {
    /** The newest active link, or null when there is none. */
    link: JoinLink | null;
    roles: RoleOption[];
    loading: boolean;
    /** A link came back from the server — created, changed, or reset. */
    onSaved: (link: JoinLink, replaces?: number) => void;
    onRemoved: (id: number) => void;
}) {
    const t = useTranslations("settings.people.links");
    const errorText = useErrorText();
    const roleLabel = useRoleLabel();
    const terms = useJoinLinkTerms();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // What the controls show while a change is in flight, so the switch moves
    // when it is clicked rather than when the server answers.
    const [draft, setDraft] = useState<{ role?: string; requiresApproval?: boolean } | null>(null);
    // Kept after the dialog closes so its wording doesn't flip mid-fade.
    const [confirm, setConfirm] = useState<"reset" | "off">("reset");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);

    const create = async () => {
        const role = defaultRole(roles);
        if (!role) {
            setError(t("noRole"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await peopleApi.joinLinks.create({ role });
            onSaved(res.link);
            toast.success(t("createdToast"));
        } catch (err) {
            setError(errorText(err, t("createFailed")));
        } finally {
            setBusy(false);
        }
    };

    const update = async (
        current: JoinLink,
        change: { role?: string; requiresApproval?: boolean }
    ) => {
        setBusy(true);
        setDraft(change);
        try {
            const res = await peopleApi.joinLinks.update(current.id, change);
            onSaved(res.link);
            toast.success(
                change.requiresApproval === undefined
                    ? t("nowHandsOut", { role: roleLabel(res.link.role, res.link.roleName) })
                    : change.requiresApproval
                      ? t("nowApproval")
                      : t("nowStraightIn")
            );
        } catch (err) {
            toast.error(errorText(err, t("changeFailed")));
        } finally {
            setDraft(null);
            setBusy(false);
        }
    };

    const confirmAction = async () => {
        if (!link) return;
        setConfirmBusy(true);
        setConfirmError(null);
        try {
            if (confirm === "reset") {
                const res = await peopleApi.joinLinks.reset(link.id);
                onSaved(res.link, link.id);
                toast.success(t("resetToast"));
            } else {
                await peopleApi.joinLinks.revoke(link.id);
                onRemoved(link.id);
                toast.success(t("offToast"));
            }
            setConfirmOpen(false);
        } catch (err) {
            setConfirmError(
                errorText(err, confirm === "reset" ? t("resetFailed") : t("offFailed"))
            );
        } finally {
            setConfirmBusy(false);
        }
    };

    const header = (
        <div className="flex items-center gap-2">
            <Link2 className="text-ink-3 h-4 w-4" />
            <h3 className="text-ink m-0 text-sm font-semibold">{t("title")}</h3>
        </div>
    );

    if (loading && !link) {
        return (
            <Panel className="p-5">
                {header}
                <LoadingNote label={t("loading")} />
            </Panel>
        );
    }

    if (!link) {
        return (
            <Panel className="flex flex-col gap-3 p-5">
                {header}
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-ink-3 m-0 text-[13px] leading-relaxed">{t("emptyBody")}</p>
                    <Button className="shrink-0" disabled={busy} onClick={() => void create()}>
                        <Link2 />
                        {busy ? t("creating") : t("create")}
                    </Button>
                </div>
                {error && <ErrorNote message={error} />}
            </Panel>
        );
    }

    const role = draft?.role ?? link.role;
    const requiresApproval = draft?.requiresApproval ?? link.requiresApproval;
    // A role that is no longer offered still has to show in the picker.
    const options = roles.some(r => r.slug === link.role)
        ? roles
        : [{ slug: link.role, name: link.roleName, assignable: false }, ...roles];
    const roleName = roleLabel(role, options.find(r => r.slug === role)?.name ?? link.roleName);
    const state = joinLinkState(link);
    const limited = link.maxUses !== null || link.expiresAt !== null;

    return (
        <Panel className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {header}
                {state !== "live" && (
                    <Badge variant="warn">{state === "expired" ? t("expired") : t("usedUp")}</Badge>
                )}
                {state === "live" && link.legacy && <Badge variant="warn">{t("legacy")}</Badge>}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    readOnly
                    value={link.url}
                    aria-label={t("title")}
                    className="min-w-0 flex-1 font-mono text-xs"
                    onFocus={e => e.currentTarget.select()}
                />
                <CopyButton
                    value={link.url}
                    label={t("copyLink")}
                    variant="default"
                    size="default"
                    className="shrink-0"
                />
            </div>

            <p className="text-ink-2 m-0 text-[13px] leading-relaxed">
                {requiresApproval ? t("approvalNote") : t("openNote", { role: roleName })}
                {state !== "live" && (
                    <span className="text-warn"> {t("noLongerWorks", { terms: terms(link) })}</span>
                )}
                {state === "live" && limited && (
                    <span className="text-ink-3">
                        {" "}
                        {t("termsSentence", { terms: terms(link) })}
                    </span>
                )}
                {link.legacy && <span className="text-warn"> {t("legacyNote")}</span>}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex items-center gap-2">
                    <Label htmlFor="invite-link-role" className="text-ink-2 shrink-0 text-[13px]">
                        {t("joinsAs")}
                    </Label>
                    <Select
                        value={role}
                        onValueChange={next => {
                            if (next !== link.role) void update(link, { role: next });
                        }}
                        disabled={busy}
                    >
                        <SelectTrigger
                            id="invite-link-role"
                            size="sm"
                            className="w-[160px]"
                            aria-label={t("roleLabel")}
                        >
                            <SelectValue placeholder={t("chooseRole")} />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map(r => (
                                <SelectItem key={r.slug} value={r.slug} disabled={!r.assignable}>
                                    {roleLabel(r.slug, r.name)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="invite-link-approval"
                        checked={requiresApproval}
                        // A short code can't be trusted to admit anyone unseen.
                        disabled={busy || link.legacy}
                        onCheckedChange={next => void update(link, { requiresApproval: next })}
                    />
                    <Label htmlFor="invite-link-approval" className="text-ink-2 text-[13px]">
                        {t("requireAdminApproval")}
                    </Label>
                </div>
            </div>

            <div className="border-line flex flex-wrap gap-2 border-t pt-4">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                        setConfirmError(null);
                        setConfirm("reset");
                        setConfirmOpen(true);
                    }}
                >
                    <RotateCw />
                    {t("resetLink")}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    disabled={busy}
                    onClick={() => {
                        setConfirmError(null);
                        setConfirm("off");
                        setConfirmOpen(true);
                    }}
                >
                    {t("turnOff")}
                </Button>
            </div>

            <ConfirmDialog
                open={confirmOpen}
                title={confirm === "off" ? t("confirmOffTitle") : t("confirmResetTitle")}
                body={confirm === "off" ? t("confirmOffBody") : t("confirmResetBody")}
                confirmLabel={confirm === "off" ? t("turnOffLink") : t("resetLink")}
                busyLabel={confirm === "off" ? t("turningOff") : t("resetting")}
                danger={confirm === "off"}
                busy={confirmBusy}
                error={confirmError}
                onConfirm={() => void confirmAction()}
                onClose={() => setConfirmOpen(false)}
            />
        </Panel>
    );
}
