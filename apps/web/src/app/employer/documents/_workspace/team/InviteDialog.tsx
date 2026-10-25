"use client";

/**
 * "Invite people" from the Team tab: an email and a role, sent through the
 * same invitations API as Settings › People. The link is shown after sending,
 * since a self-hosted instance may not send mail.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
import { useRoleLabel } from "~/lib/authz/i18n";
import { INVITABLE_BUILTIN_ROLES } from "~/lib/authz/permissions";

import { peopleApi, type Role } from "../settings/people/api";
import { CopyButton, useErrorText } from "../settings/people/ui";

type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

/** Before the role list arrives: the built-ins, named where they render. */
const FALLBACK_ROLES: RoleOption[] = INVITABLE_BUILTIN_ROLES.map(slug => ({
    slug,
    name: slug,
    assignable: true,
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslations("team.inviteDialog");
    const errorText = useErrorText();
    const tc = useTranslations("common");
    const roleLabel = useRoleLabel();
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
            setError(t("invalidEmail"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await peopleApi.invitations.create({ email: trimmed, role });
            setSent({ email: res.invitation.email, acceptUrl: res.acceptUrl });
            toast.success(t("sentToast", { email: res.invitation.email }));
        } catch (err) {
            setError(errorText(err, t("sendError")));
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
                            <DialogTitle>{t("sentTitle")}</DialogTitle>
                            <DialogDescription>
                                {t("sentBody", { email: sent.email })}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex items-center gap-2">
                            <Input
                                readOnly
                                value={sent.acceptUrl}
                                aria-label={t("linkLabel")}
                                className="min-w-0 flex-1 font-mono text-xs"
                                onFocus={e => e.currentTarget.select()}
                            />
                            <CopyButton value={sent.acceptUrl} label={t("copyLink")} />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setSent(null)}>
                                {t("inviteAnother")}
                            </Button>
                            <Button onClick={onClose}>{tc("actions.done")}</Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form onSubmit={e => void submit(e)} className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle>{t("title")}</DialogTitle>
                            <DialogDescription>{t("description")}</DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="team-invite-email">{tc("fields.email")}</Label>
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
                            <Label htmlFor="team-invite-role">{tc("fields.role")}</Label>
                            <Select value={role} onValueChange={setRole} disabled={busy}>
                                <SelectTrigger id="team-invite-role" aria-label={tc("fields.role")}>
                                    <SelectValue placeholder={t("chooseRole")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {assignable.map(r => (
                                        <SelectItem key={r.slug} value={r.slug}>
                                            {roleLabel(r.slug, r.name)}
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
                                {tc("actions.cancel")}
                            </Button>
                            <Button type="submit" disabled={busy || !email.trim()}>
                                {busy ? t("sending") : t("send")}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
