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

import React, { useState } from "react";
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

import { errorMessage, peopleApi, type JoinLink, type Role } from "./api";
import { plural, untilTime } from "./format";
import { ConfirmDialog, CopyButton, ErrorNote, LoadingNote, Panel } from "./ui";

export type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

/** Whether a not-revoked link still lets people in. */
export function joinLinkState(link: JoinLink, now: number = Date.now()) {
    if (link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now) return "expired";
    if (link.maxUses !== null && link.useCount >= link.maxUses) return "used up";
    return "live";
}

/** "2 of 10 uses · expires in 3 days" — the terms a link was made with. */
export function joinLinkTerms(link: JoinLink): string {
    const uses =
        link.maxUses !== null
            ? `${link.useCount} of ${link.maxUses} uses`
            : plural(link.useCount, "use");
    // untilTime already says "expired 4 days ago" for a date in the past.
    const until = untilTime(link.expiresAt);
    const expiry =
        link.expiresAt === null
            ? "never expires"
            : until.startsWith("expired")
              ? until
              : `expires ${until}`;
    return `${uses} · ${expiry}`;
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
            setError("There is no role a link can hand out yet.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await peopleApi.joinLinks.create({ role });
            onSaved(res.link);
            toast.success("Invite link created — copy it and share it");
        } catch (err) {
            setError(errorMessage(err, "The link wasn't created."));
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
                    ? `The link now hands out ${res.link.roleName}`
                    : change.requiresApproval
                      ? "New joiners now wait for approval"
                      : "New joiners now land straight in"
            );
        } catch (err) {
            toast.error(errorMessage(err, "The link wasn't changed."));
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
                toast.success("Invite link reset — share the new one");
            } else {
                await peopleApi.joinLinks.revoke(link.id);
                onRemoved(link.id);
                toast.success("Invite link turned off");
            }
            setConfirmOpen(false);
        } catch (err) {
            setConfirmError(
                errorMessage(
                    err,
                    confirm === "reset" ? "The link wasn't reset." : "The link wasn't turned off."
                )
            );
        } finally {
            setConfirmBusy(false);
        }
    };

    const header = (
        <div className="flex items-center gap-2">
            <Link2 className="text-ink-3 h-4 w-4" />
            <h3 className="text-ink m-0 text-sm font-semibold">Invite link</h3>
        </div>
    );

    if (loading && !link) {
        return (
            <Panel className="p-5">
                {header}
                <LoadingNote label="Loading the invite link…" />
            </Panel>
        );
    }

    if (!link) {
        return (
            <Panel className="flex flex-col gap-3 p-5">
                {header}
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                        Share one link to bring people in. They create an account and land in the
                        workspace.
                    </p>
                    <Button className="shrink-0" disabled={busy} onClick={() => void create()}>
                        <Link2 />
                        {busy ? "Creating…" : "Create invite link"}
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
    const roleName = options.find(r => r.slug === role)?.name ?? link.roleName;
    const state = joinLinkState(link);
    const limited = link.maxUses !== null || link.expiresAt !== null;

    return (
        <Panel className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {header}
                {state !== "live" && (
                    <Badge variant="warn">{state === "expired" ? "Expired" : "Used up"}</Badge>
                )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    readOnly
                    value={link.url}
                    aria-label="Invite link"
                    className="min-w-0 flex-1 font-mono text-xs"
                    onFocus={e => e.currentTarget.select()}
                />
                <CopyButton
                    value={link.url}
                    label="Copy link"
                    variant="default"
                    size="default"
                    className="shrink-0"
                />
            </div>

            <p className="text-ink-2 m-0 text-[13px] leading-relaxed">
                {requiresApproval
                    ? "People who open it wait on the Pending list until an admin approves them."
                    : `Anyone with this link can create an account and land straight in the workspace as ${roleName}.`}
                {state !== "live" && (
                    <span className="text-warn">
                        {" "}
                        It no longer works ({joinLinkTerms(link)}) — reset it for a fresh one.
                    </span>
                )}
                {state === "live" && limited && (
                    <span className="text-ink-3"> {joinLinkTerms(link)}.</span>
                )}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex items-center gap-2">
                    <Label htmlFor="invite-link-role" className="text-ink-2 shrink-0 text-[13px]">
                        Joins as
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
                            aria-label="Role the invite link hands out"
                        >
                            <SelectValue placeholder="Choose a role" />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map(r => (
                                <SelectItem key={r.slug} value={r.slug} disabled={!r.assignable}>
                                    {r.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="invite-link-approval"
                        checked={requiresApproval}
                        disabled={busy}
                        onCheckedChange={next => void update(link, { requiresApproval: next })}
                    />
                    <Label htmlFor="invite-link-approval" className="text-ink-2 text-[13px]">
                        Require admin approval
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
                    Reset link
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
                    Turn off
                </Button>
            </div>

            <ConfirmDialog
                open={confirmOpen}
                title={confirm === "off" ? "Turn off the invite link?" : "Reset the invite link?"}
                body={
                    confirm === "off"
                        ? "The link stops working right away. People who already joined keep their access."
                        : "The current link stops working right away and you get a new one to share. People who already joined keep their access."
                }
                confirmLabel={confirm === "off" ? "Turn off link" : "Reset link"}
                busyLabel={confirm === "off" ? "Turning off…" : "Resetting…"}
                danger={confirm === "off"}
                busy={confirmBusy}
                error={confirmError}
                onConfirm={() => void confirmAction()}
                onClose={() => setConfirmOpen(false)}
            />
        </Panel>
    );
}
