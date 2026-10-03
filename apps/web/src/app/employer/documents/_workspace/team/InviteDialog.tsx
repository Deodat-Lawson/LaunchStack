"use client";

/**
 * "Invite people" from the Team tab: an email and a role, sent through the
 * same invitations API as Settings › People. The link is shown after sending,
 * since a self-hosted instance may not send mail.
 */

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { INVITABLE_BUILTIN_ROLES, ROLE_LABELS } from "~/lib/authz/permissions";

import { errorMessage, peopleApi, type Role } from "../settings/people/api";
import { CopyButton } from "../settings/people/ui";

type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

const FALLBACK_ROLES: RoleOption[] = INVITABLE_BUILTIN_ROLES.map(slug => ({
    slug,
    name: ROLE_LABELS[slug],
    assignable: true,
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [roles, setRoles] = useState<RoleOption[]>(FALLBACK_ROLES);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("member");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState<{ email: string; acceptUrl: string } | null>(null);

    useEffect(() => {
        if (!open) return;
        setEmail("");
        setError(null);
        setSent(null);
        let cancelled = false;
        void peopleApi.roles
            .list()
            .then(res => {
                if (!cancelled) setRoles(res.roles);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open]);

    // Owner is transferred, never handed out by invitation.
    const assignable = useMemo(
        () => roles.filter(r => r.assignable && r.slug !== "owner"),
        [roles]
    );
    useEffect(() => {
        if (assignable.length > 0 && !assignable.some(r => r.slug === role)) {
            setRole((assignable.find(r => r.slug === "member") ?? assignable[0]!).slug);
        }
    }, [assignable, role]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim().toLowerCase();
        if (!EMAIL_RE.test(trimmed)) {
            setError("Enter a full email address, like ada@example.com.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await peopleApi.invitations.create({ email: trimmed, role });
            setSent({ email: res.invitation.email, acceptUrl: res.acceptUrl });
            toast.success(`Invitation sent to ${res.invitation.email}`);
        } catch (err) {
            setError(errorMessage(err, "The invitation wasn't sent."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent className="sm:max-w-md" data-testid="team-invite-dialog">
                {sent ? (
                    <div className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle>Invitation sent</DialogTitle>
                            <DialogDescription>
                                {sent.email} was emailed a link. If mail isn&apos;t set up here,
                                send them this link yourself.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex items-center gap-2">
                            <Input
                                readOnly
                                value={sent.acceptUrl}
                                aria-label="Invitation link"
                                className="min-w-0 flex-1 font-mono text-xs"
                                onFocus={e => e.currentTarget.select()}
                            />
                            <CopyButton value={sent.acceptUrl} label="Copy link" />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setSent(null)}>
                                Invite someone else
                            </Button>
                            <Button onClick={onClose}>Done</Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form onSubmit={e => void submit(e)} className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle>Invite people</DialogTitle>
                            <DialogDescription>
                                They get an email with a link to join with the role you pick.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="team-invite-email">Email</Label>
                            <Input
                                id="team-invite-email"
                                type="email"
                                autoComplete="off"
                                placeholder="ada@example.com"
                                value={email}
                                autoFocus
                                disabled={busy}
                                onChange={e => {
                                    setEmail(e.target.value);
                                    if (error) setError(null);
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="team-invite-role">Role</Label>
                            <Select value={role} onValueChange={setRole} disabled={busy}>
                                <SelectTrigger id="team-invite-role" aria-label="Role">
                                    <SelectValue placeholder="Choose a role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {assignable.map(r => (
                                        <SelectItem key={r.slug} value={r.slug}>
                                            {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {error && (
                            <p role="alert" className="text-danger m-0 text-[12.5px]">
                                {error}
                            </p>
                        )}
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onClose}
                                disabled={busy}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={busy || !email.trim()}>
                                {busy ? "Sending…" : "Send invitation"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
