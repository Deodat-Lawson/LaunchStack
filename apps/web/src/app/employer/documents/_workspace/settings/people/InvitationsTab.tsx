"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { INVITABLE_BUILTIN_ROLES, ROLE_LABELS, type Permission } from "~/lib/authz/permissions";

import {
    errorMessage,
    peopleApi,
    type Group,
    type Invitation,
    type JoinLink,
    type Role,
} from "./api";
import { plural, relativeTime, untilTime } from "./format";
import {
    ConfirmDialog,
    CopyButton,
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    TabIntro,
} from "./ui";

interface InvitationsTabProps {
    can: (permission: Permission | undefined) => boolean;
}

type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

const FALLBACK_ROLES: RoleOption[] = INVITABLE_BUILTIN_ROLES.map(slug => ({
    slug,
    name: ROLE_LABELS[slug],
    assignable: true,
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitationsTab({ can }: InvitationsTabProps) {
    const canInvite = can("members.invite");

    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [links, setLinks] = useState<JoinLink[]>([]);
    const [roles, setRoles] = useState<RoleOption[]>(FALLBACK_ROLES);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const [inv, jl, rl, gr] = await Promise.all([
                peopleApi.invitations.list(),
                peopleApi.joinLinks.list().catch(() => ({ links: [] as JoinLink[] })),
                peopleApi.roles.list().catch(() => null),
                peopleApi.groups.list().catch(() => ({ groups: [] as Group[] })),
            ]);
            setInvitations(inv.invitations);
            setLinks(jl.links);
            if (rl) setRoles(rl.roles);
            setGroups(gr.groups);
        } catch (err) {
            setError(errorMessage(err, "Could not load invitations."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!canInvite) {
            setLoading(false);
            return;
        }
        void load();
    }, [canInvite, load]);

    // Owner is never handed out by invitation or link — ownership is transferred.
    const assignable = useMemo(
        () => roles.filter(r => r.assignable && r.slug !== "owner"),
        [roles]
    );

    if (!canInvite) {
        return (
            <div>
                <TabIntro title="Invitations" />
                <Panel>
                    <EmptyState
                        title="Inviting is not part of your role"
                        body="Ask an admin to invite people or to give your role the “Send invitations” permission."
                    />
                </Panel>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <TabIntro
                title="Invitations"
                description="Invite one person by email, or create a join link anyone can use. Both hand out a role you choose. Invitations expire; links can be capped or revoked."
            />

            {error && <ErrorNote message={error} onRetry={() => void load()} />}

            <InviteForm
                roles={assignable}
                groups={groups}
                onCreated={invitation => {
                    setInvitations(prev => [
                        invitation,
                        ...prev.filter(i => i.id !== invitation.id),
                    ]);
                }}
            />

            <Panel>
                {loading ? (
                    <LoadingNote label="Loading invitations…" />
                ) : (
                    <InvitationList invitations={invitations} onChanged={() => void load()} />
                )}
            </Panel>

            <JoinLinks
                links={links}
                roles={assignable}
                loading={loading}
                onChanged={() => void load()}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Invite by email
// ---------------------------------------------------------------------------

function InviteForm({
    roles,
    groups,
    onCreated,
}: {
    roles: RoleOption[];
    groups: Group[];
    onCreated: (invitation: Invitation) => void;
}) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<string>("");
    const [groupIds, setGroupIds] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ invitation: Invitation; acceptUrl: string } | null>(
        null
    );

    // Default to the first assignable role once roles arrive — Member usually.
    useEffect(() => {
        if (!role && roles.length > 0) {
            const member = roles.find(r => r.slug === "member");
            setRole((member ?? roles[0]!).slug);
        }
    }, [roles, role]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim().toLowerCase();
        if (!EMAIL_RE.test(trimmed)) {
            setError("Enter a full email address, like ada@example.com.");
            return;
        }
        if (!role) {
            setError("Choose the role this person should have.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await peopleApi.invitations.create({
                email: trimmed,
                role,
                groupIds: groupIds.length > 0 ? groupIds : undefined,
            });
            setResult(res);
            onCreated(res.invitation);
            setEmail("");
            setGroupIds([]);
            toast.success(`Invitation sent to ${trimmed}`);
        } catch (err) {
            setError(errorMessage(err, "The invitation wasn't sent."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel className="p-5">
            <form onSubmit={e => void submit(e)} className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Mail className="text-ink-3 h-4 w-4" />
                    <h3 className="text-ink m-0 text-sm font-semibold">Invite by email</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="invite-email">Email</Label>
                        <Input
                            id="invite-email"
                            type="email"
                            autoComplete="off"
                            placeholder="ada@example.com"
                            value={email}
                            onChange={e => {
                                setEmail(e.target.value);
                                if (error) setError(null);
                            }}
                            disabled={busy}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="invite-role">Role</Label>
                        <Select value={role} onValueChange={setRole} disabled={busy}>
                            <SelectTrigger
                                id="invite-role"
                                aria-label="Role for the invited person"
                            >
                                <SelectValue placeholder="Choose a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {roles.map(r => (
                                    <SelectItem key={r.slug} value={r.slug}>
                                        {r.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {groups.length > 0 && (
                    <fieldset className="m-0 border-0 p-0">
                        <legend className="text-ink-2 mb-1.5 text-xs font-semibold">
                            Add to groups <span className="text-ink-3 font-normal">(optional)</span>
                        </legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {groups.map(g => {
                                const checked = groupIds.includes(g.id);
                                const id = `invite-group-${g.id}`;
                                return (
                                    <label
                                        key={g.id}
                                        htmlFor={id}
                                        className="text-ink-2 flex cursor-pointer items-center gap-2 text-[13px]"
                                    >
                                        <Checkbox
                                            id={id}
                                            checked={checked}
                                            disabled={busy}
                                            onCheckedChange={next =>
                                                setGroupIds(prev =>
                                                    next === true
                                                        ? [...prev, g.id]
                                                        : prev.filter(x => x !== g.id)
                                                )
                                            }
                                        />
                                        {g.name}
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>
                )}

                {error && <ErrorNote message={error} />}

                <div>
                    <Button type="submit" disabled={busy || !email.trim()}>
                        {busy ? "Sending…" : "Send invitation"}
                    </Button>
                </div>
            </form>

            {result && (
                <div className="bg-success-soft mt-4 rounded-[10px] px-4 py-3">
                    <div className="text-success text-[13px] font-semibold">
                        Invitation sent to {result.invitation.email}
                    </div>
                    <p className="text-ink-2 m-0 mt-1 text-[12.5px] leading-relaxed">
                        The link was also emailed. Self-hosted instances may not send mail, so share
                        it directly to be safe — it expires {untilTime(result.invitation.expiresAt)}
                        .
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                            readOnly
                            value={result.acceptUrl}
                            aria-label="Invitation link"
                            className="bg-panel min-w-0 flex-1 font-mono text-xs"
                            onFocus={e => e.currentTarget.select()}
                        />
                        <CopyButton value={result.acceptUrl} label="Copy link" />
                        <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                            Done
                        </Button>
                    </div>
                </div>
            )}
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Sent invitations
// ---------------------------------------------------------------------------

function InvitationList({
    invitations,
    onChanged,
}: {
    invitations: Invitation[];
    onChanged: () => void;
}) {
    const [busyId, setBusyId] = useState<number | null>(null);
    const [revoking, setRevoking] = useState<Invitation | null>(null);
    const [revokeBusy, setRevokeBusy] = useState(false);
    const [revokeError, setRevokeError] = useState<string | null>(null);
    const [resent, setResent] = useState<{ id: number; acceptUrl: string } | null>(null);

    const resend = async (invitation: Invitation) => {
        setBusyId(invitation.id);
        try {
            const res = await peopleApi.invitations.resend(invitation.id);
            setResent({ id: invitation.id, acceptUrl: res.acceptUrl });
            toast.success(`Invitation resent to ${invitation.email}`);
            onChanged();
        } catch (err) {
            toast.error(errorMessage(err, "The invitation wasn't resent."));
        } finally {
            setBusyId(null);
        }
    };

    const revoke = async () => {
        if (!revoking) return;
        setRevokeBusy(true);
        setRevokeError(null);
        try {
            await peopleApi.invitations.revoke(revoking.id);
            toast.success(`Invitation to ${revoking.email} withdrawn`);
            setRevoking(null);
            onChanged();
        } catch (err) {
            setRevokeError(errorMessage(err, "The invitation wasn't withdrawn."));
        } finally {
            setRevokeBusy(false);
        }
    };

    const sorted = useMemo(() => {
        const rank = (i: Invitation) => (i.status === "pending" ? 0 : 1);
        return [...invitations].sort(
            (a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt)
        );
    }, [invitations]);

    if (sorted.length === 0) {
        return (
            <EmptyState
                title="No invitations yet"
                body="Send one above. It lands here until it is accepted or expires."
            />
        );
    }

    return (
        <>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-panel-2/50">
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Invited by</TableHead>
                            <TableHead>Expires</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sorted.map(inv => {
                            const open = inv.status === "pending";
                            const busy = busyId === inv.id;
                            return (
                                <React.Fragment key={inv.id}>
                                    <TableRow className={open ? undefined : "opacity-60"}>
                                        <TableCell className="text-ink font-medium">
                                            {inv.email}
                                        </TableCell>
                                        <TableCell className="text-ink-2">{inv.roleName}</TableCell>
                                        <TableCell className="text-ink-3 text-sm">
                                            {inv.invitedBy?.name ?? inv.invitedBy?.email ?? "—"}
                                            <span className="text-ink-4">
                                                {" "}
                                                · {relativeTime(inv.createdAt)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-ink-3 whitespace-nowrap text-sm">
                                            {open ? untilTime(inv.expiresAt) : "—"}
                                        </TableCell>
                                        <TableCell>
                                            <InvitationStatus status={inv.status} />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {open && (
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={busy}
                                                        onClick={() => void resend(inv)}
                                                    >
                                                        {busy ? "Resending…" : "Resend"}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-danger hover:text-danger"
                                                        disabled={busy}
                                                        onClick={() => {
                                                            setRevokeError(null);
                                                            setRevoking(inv);
                                                        }}
                                                    >
                                                        Revoke
                                                    </Button>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                    {resent?.id === inv.id && (
                                        <TableRow className="bg-success-soft/60 hover:bg-success-soft/60">
                                            <TableCell colSpan={6}>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-ink-2 text-[12.5px]">
                                                        New link (also emailed):
                                                    </span>
                                                    <Input
                                                        readOnly
                                                        value={resent.acceptUrl}
                                                        aria-label="Invitation link"
                                                        className="bg-panel min-w-0 flex-1 font-mono text-xs"
                                                        onFocus={e => e.currentTarget.select()}
                                                    />
                                                    <CopyButton
                                                        value={resent.acceptUrl}
                                                        label="Copy link"
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setResent(null)}
                                                    >
                                                        Done
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            <ConfirmDialog
                open={revoking !== null}
                title={`Withdraw the invitation to ${revoking?.email ?? ""}?`}
                body="The link stops working right away. You can send a new invitation any time."
                confirmLabel="Revoke invitation"
                danger
                busy={revokeBusy}
                error={revokeError}
                onConfirm={() => void revoke()}
                onClose={() => setRevoking(null)}
            />
        </>
    );
}

function InvitationStatus({ status }: { status: Invitation["status"] }) {
    switch (status) {
        case "pending":
            return <Badge variant="warn">Pending</Badge>;
        case "accepted":
            return <Badge variant="success">Accepted</Badge>;
        case "revoked":
            return <Badge variant="secondary">Revoked</Badge>;
        case "expired":
            return <Badge variant="secondary">Expired</Badge>;
    }
}

// ---------------------------------------------------------------------------
// Join links
// ---------------------------------------------------------------------------

function JoinLinks({
    links,
    roles,
    loading,
    onChanged,
}: {
    links: JoinLink[];
    roles: RoleOption[];
    loading: boolean;
    onChanged: () => void;
}) {
    const [role, setRole] = useState("");
    const [expiresInDays, setExpiresInDays] = useState("");
    const [maxUses, setMaxUses] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<JoinLink | null>(null);
    const [revokeBusy, setRevokeBusy] = useState(false);
    const [revokeError, setRevokeError] = useState<string | null>(null);

    useEffect(() => {
        if (!role && roles.length > 0) {
            const member = roles.find(r => r.slug === "member");
            setRole((member ?? roles[0]!).slug);
        }
    }, [roles, role]);

    const parseOptionalInt = (value: string): number | null | "invalid" => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const n = Number(trimmed);
        return Number.isInteger(n) && n > 0 ? n : "invalid";
    };

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        const days = parseOptionalInt(expiresInDays);
        const uses = parseOptionalInt(maxUses);
        if (days === "invalid") {
            setError("Expiry must be a whole number of days, or blank for no expiry.");
            return;
        }
        if (uses === "invalid") {
            setError("Max uses must be a whole number, or blank for unlimited.");
            return;
        }
        if (!role) {
            setError("Choose the role the link should hand out.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await peopleApi.joinLinks.create({ role, expiresInDays: days, maxUses: uses });
            toast.success("Join link created");
            setExpiresInDays("");
            setMaxUses("");
            onChanged();
        } catch (err) {
            setError(errorMessage(err, "The link wasn't created."));
        } finally {
            setBusy(false);
        }
    };

    const revoke = async () => {
        if (!revoking) return;
        setRevokeBusy(true);
        setRevokeError(null);
        try {
            await peopleApi.joinLinks.revoke(revoking.id);
            toast.success("Join link revoked");
            setRevoking(null);
            onChanged();
        } catch (err) {
            setRevokeError(errorMessage(err, "The link wasn't revoked."));
        } finally {
            setRevokeBusy(false);
        }
    };

    const sorted = useMemo(
        () =>
            [...links].sort(
                (a, b) =>
                    Number(b.isActive) - Number(a.isActive) ||
                    b.createdAt.localeCompare(a.createdAt)
            ),
        [links]
    );

    return (
        <div>
            <div className="mb-3 flex items-center gap-2">
                <Link2 className="text-ink-3 h-4 w-4" />
                <h3 className="text-ink m-0 text-sm font-semibold">Join links</h3>
                <span className="text-ink-3 text-[12.5px]">
                    Anyone with the link can ask to join. Whether they wait for approval is a
                    workspace setting.
                </span>
            </div>

            <Panel className="p-5">
                <form onSubmit={e => void create(e)} className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="link-role">Role</Label>
                            <Select value={role} onValueChange={setRole} disabled={busy}>
                                <SelectTrigger id="link-role" aria-label="Role the link hands out">
                                    <SelectValue placeholder="Choose a role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(r => (
                                        <SelectItem key={r.slug} value={r.slug}>
                                            {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="link-expires">Expires in (days)</Label>
                            <Input
                                id="link-expires"
                                inputMode="numeric"
                                placeholder="Never"
                                value={expiresInDays}
                                onChange={e => setExpiresInDays(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="link-max">Max uses</Label>
                            <Input
                                id="link-max"
                                inputMode="numeric"
                                placeholder="Unlimited"
                                value={maxUses}
                                onChange={e => setMaxUses(e.target.value)}
                                disabled={busy}
                            />
                        </div>
                    </div>
                    {error && <ErrorNote message={error} />}
                    <div>
                        <Button type="submit" variant="outline" disabled={busy}>
                            {busy ? "Creating…" : "Create join link"}
                        </Button>
                    </div>
                </form>
            </Panel>

            <Panel className="mt-3">
                {loading ? (
                    <LoadingNote label="Loading join links…" />
                ) : sorted.length === 0 ? (
                    <EmptyState
                        title="No join links"
                        body="Create one above to let people join without an individual invitation."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-panel-2/50">
                                    <TableHead>Code</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Uses</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sorted.map(link => {
                                    const expired =
                                        link.expiresAt !== null &&
                                        new Date(link.expiresAt).getTime() < Date.now();
                                    const usedUp =
                                        link.maxUses !== null && link.useCount >= link.maxUses;
                                    const live = link.isActive && !expired && !usedUp;
                                    return (
                                        <TableRow
                                            key={link.id}
                                            className={live ? undefined : "opacity-60"}
                                        >
                                            <TableCell className="text-ink font-mono text-[12.5px]">
                                                {link.code}
                                            </TableCell>
                                            <TableCell className="text-ink-2">
                                                {link.roleName}
                                            </TableCell>
                                            <TableCell className="text-ink-2 whitespace-nowrap text-sm">
                                                {link.maxUses !== null
                                                    ? `${link.useCount} of ${link.maxUses}`
                                                    : plural(link.useCount, "use")}
                                            </TableCell>
                                            <TableCell className="text-ink-3 whitespace-nowrap text-sm">
                                                {untilTime(link.expiresAt)}
                                            </TableCell>
                                            <TableCell>
                                                {!link.isActive ? (
                                                    <Badge variant="secondary">Revoked</Badge>
                                                ) : expired ? (
                                                    <Badge variant="secondary">Expired</Badge>
                                                ) : usedUp ? (
                                                    <Badge variant="secondary">Used up</Badge>
                                                ) : (
                                                    <Badge variant="success">Active</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <CopyButton
                                                        value={link.url}
                                                        label="Copy URL"
                                                        variant="ghost"
                                                    />
                                                    <CopyButton
                                                        value={link.code}
                                                        label="Copy code"
                                                        variant="ghost"
                                                    />
                                                    {link.isActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-danger hover:text-danger"
                                                            onClick={() => {
                                                                setRevokeError(null);
                                                                setRevoking(link);
                                                            }}
                                                        >
                                                            Revoke
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Panel>

            <ConfirmDialog
                open={revoking !== null}
                title="Revoke this join link?"
                body="Anyone who has the link can no longer use it. People who already joined keep their membership."
                confirmLabel="Revoke link"
                danger
                busy={revokeBusy}
                error={revokeError}
                onConfirm={() => void revoke()}
                onClose={() => setRevoking(null)}
            />
        </div>
    );
}
