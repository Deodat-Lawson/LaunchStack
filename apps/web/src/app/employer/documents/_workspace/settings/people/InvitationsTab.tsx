"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { toast } from "sonner";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import { buildInvitationMenuItems } from "./peopleContextMenu";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { INVITABLE_BUILTIN_ROLES, ROLE_LABELS, type Permission } from "~/lib/authz/permissions";
import { cn } from "~/lib/utils";

import {
    errorMessage,
    peopleApi,
    type Group,
    type Invitation,
    type InvitationSent,
    type JoinLink,
} from "./api";
import { relativeTime, untilTime } from "./format";
import {
    defaultRole,
    InviteLinkCard,
    isOpenEnded,
    joinLinkState,
    joinLinkTerms,
    pickInviteLink,
    type RoleOption,
} from "./InviteLinkCard";
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

const FALLBACK_ROLES: RoleOption[] = INVITABLE_BUILTIN_ROLES.map(slug => ({
    slug,
    name: ROLE_LABELS[slug],
    assignable: true,
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An invitation row: resend, copy the address, or revoke by right-click. */
function InvitationRow({
    invitation,
    open,
    busy,
    onResend,
    onRevoke,
    children,
}: {
    invitation: Invitation;
    open: boolean;
    busy: boolean;
    onResend: () => void;
    onRevoke: () => void;
    children: React.ReactNode;
}) {
    const ctxTarget = useContextTarget({
        kind: "invitation",
        id: String(invitation.id),
        label: `Actions for the invitation to ${invitation.email}`,
        data: invitation,
        items: () =>
            buildInvitationMenuItems(
                invitation,
                { open, busy },
                {
                    onResend,
                    onCopyEmail: () => {
                        void copyText(invitation.email).then(ok => {
                            if (ok) toast.success("Email copied");
                        });
                    },
                    onRevoke,
                }
            ),
    });
    return (
        <TableRow {...ctxTarget} className={open ? undefined : "opacity-60"}>
            {children}
        </TableRow>
    );
}

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

    // Link changes land locally from the server's answer at once, then the
    // list is re-read so a link another admin changed shows up too.
    const reloadLinks = useCallback(() => {
        peopleApi.joinLinks
            .list()
            .then(res => setLinks(res.links))
            .catch(() => undefined);
    }, []);

    const saveLink = useCallback(
        (link: JoinLink, replaces?: number) => {
            setLinks(prev =>
                prev.some(l => l.id === link.id)
                    ? prev.map(l => (l.id === link.id ? link : l))
                    : [link, ...prev.filter(l => l.id !== replaces)]
            );
            reloadLinks();
        },
        [reloadLinks]
    );

    const removeLink = useCallback(
        (id: number) => {
            setLinks(prev => prev.filter(l => l.id !== id));
            reloadLinks();
        },
        [reloadLinks]
    );

    const { primary, others } = useMemo(() => pickInviteLink(links), [links]);

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
                description="Share one invite link to bring people in, or invite someone by email. Both hand out a role you choose. Invitations expire; links can be reset or turned off."
            />

            {error && <ErrorNote message={error} onRetry={() => void load()} />}

            <InviteLinkCard
                link={primary}
                roles={assignable}
                loading={loading}
                onSaved={saveLink}
                onRemoved={removeLink}
            />

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

            <MoreLinks
                links={others}
                roles={assignable}
                loading={loading}
                onSaved={saveLink}
                onRemoved={removeLink}
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
    const [result, setResult] = useState<InvitationSent | null>(null);

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
            toast.success(
                res.emailSent
                    ? `Invitation emailed to ${trimmed}`
                    : "Invitation created — copy the link to send it"
            );
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

            {result && <SentNotice sent={result} className="mt-4" onDone={() => setResult(null)} />}
        </Panel>
    );
}

/**
 * What happened to an invitation just created or resent. Says plainly when no
 * email went out — the server has no mail provider — so the admin knows the
 * link is theirs to send.
 */
function SentNotice({
    sent,
    renewed = false,
    className,
    onDone,
}: {
    sent: InvitationSent;
    /** A resend: the token is new and the earlier link no longer works. */
    renewed?: boolean;
    className?: string;
    onDone: () => void;
}) {
    const { invitation, acceptUrl, emailSent } = sent;
    const expires = `It expires ${untilTime(invitation.expiresAt)}.`;
    const earlier = renewed ? " The earlier link no longer works." : "";
    return (
        <div
            role="status"
            className={cn(
                "rounded-[10px] px-4 py-3",
                emailSent ? "bg-success-soft" : "bg-warn-soft",
                className
            )}
        >
            <div
                className={cn(
                    "text-[13px] font-semibold",
                    emailSent ? "text-success" : "text-warn"
                )}
            >
                {emailSent
                    ? `Invitation emailed to ${invitation.email}.`
                    : "Email isn't set up on this server, so nothing was sent."}
            </div>
            <p className="text-ink-2 m-0 mt-1 whitespace-normal text-[12.5px] leading-relaxed">
                {emailSent
                    ? `You can also share the link yourself. ${expires}${earlier}`
                    : `Copy this link and send it to ${invitation.email} yourself. ${expires}${earlier}`}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    readOnly
                    value={acceptUrl}
                    aria-label={`Invitation link for ${invitation.email}`}
                    className="bg-panel min-w-0 flex-1 font-mono text-xs"
                    onFocus={e => e.currentTarget.select()}
                />
                <div className="flex items-center gap-2">
                    <CopyButton
                        value={acceptUrl}
                        label="Copy link"
                        variant={emailSent ? "outline" : "default"}
                    />
                    <Button variant="ghost" size="sm" onClick={onDone}>
                        Done
                    </Button>
                </div>
            </div>
        </div>
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
    const [resent, setResent] = useState<InvitationSent | null>(null);

    const resend = async (invitation: Invitation) => {
        setBusyId(invitation.id);
        try {
            const res = await peopleApi.invitations.resend(invitation.id);
            setResent(res);
            toast.success(
                res.emailSent
                    ? `Invitation resent to ${invitation.email}`
                    : "New invitation link ready — copy it to send it"
            );
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
                                    <InvitationRow
                                        invitation={inv}
                                        open={open}
                                        busy={busy}
                                        onResend={() => void resend(inv)}
                                        onRevoke={() => {
                                            setRevokeError(null);
                                            setRevoking(inv);
                                        }}
                                    >
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
                                    </InvitationRow>
                                    {resent?.invitation.id === inv.id && (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={6} className="whitespace-normal">
                                                <SentNotice
                                                    sent={resent}
                                                    renewed
                                                    onDone={() => setResent(null)}
                                                />
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
// More links — every active link except the invite link above
// ---------------------------------------------------------------------------

function MoreLinks({
    links,
    roles,
    loading,
    onSaved,
    onRemoved,
}: {
    links: JoinLink[];
    roles: RoleOption[];
    loading: boolean;
    onSaved: (link: JoinLink, replaces?: number) => void;
    onRemoved: (id: number) => void;
}) {
    // Folded away until there is something in it; the reader's choice wins.
    const [openChoice, setOpenChoice] = useState<boolean | null>(null);
    const open = openChoice ?? links.length > 0;

    const [role, setRole] = useState("");
    const [expiresInDays, setExpiresInDays] = useState("");
    const [maxUses, setMaxUses] = useState("");
    const [requiresApproval, setRequiresApproval] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<{ link: JoinLink; action: "reset" | "revoke" } | null>(
        null
    );
    const [pendingOpen, setPendingOpen] = useState(false);
    const [pendingBusy, setPendingBusy] = useState(false);
    const [pendingError, setPendingError] = useState<string | null>(null);

    useEffect(() => {
        if (!role) {
            const fallback = defaultRole(roles);
            if (fallback) setRole(fallback);
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
            const res = await peopleApi.joinLinks.create({
                role,
                expiresInDays: days,
                maxUses: uses,
                requiresApproval,
            });
            onSaved(res.link);
            // An open-ended link becomes the one the card at the top shows.
            toast.success(
                isOpenEnded(res.link)
                    ? "Link created — it's the invite link at the top now"
                    : "Link created"
            );
            setExpiresInDays("");
            setMaxUses("");
            setRequiresApproval(false);
        } catch (err) {
            setError(errorMessage(err, "The link wasn't created."));
        } finally {
            setBusy(false);
        }
    };

    const ask = (link: JoinLink, action: "reset" | "revoke") => {
        setPendingError(null);
        setPending({ link, action });
        setPendingOpen(true);
    };

    const confirmPending = async () => {
        if (!pending) return;
        const { link, action } = pending;
        setPendingBusy(true);
        setPendingError(null);
        try {
            if (action === "reset") {
                const res = await peopleApi.joinLinks.reset(link.id);
                onSaved(res.link, link.id);
                toast.success("Link reset — the old one no longer works");
            } else {
                await peopleApi.joinLinks.revoke(link.id);
                onRemoved(link.id);
                toast.success("Join link revoked");
            }
            setPendingOpen(false);
        } catch (err) {
            setPendingError(
                errorMessage(
                    err,
                    action === "reset" ? "The link wasn't reset." : "The link wasn't revoked."
                )
            );
        } finally {
            setPendingBusy(false);
        }
    };

    return (
        <Collapsible open={open} onOpenChange={setOpenChoice}>
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 self-start">
                        <ChevronDown
                            className={cn("transition-transform", !open && "-rotate-90")}
                        />
                        More links
                        {links.length > 0 && <Badge variant="secondary">{links.length}</Badge>}
                    </Button>
                </CollapsibleTrigger>
                <span className="text-ink-3 text-[12.5px] leading-relaxed">
                    Extra links with their own role, expiry or use cap. Each link decides whether
                    people join straight in or wait for approval.
                </span>
            </div>

            <CollapsibleContent>
                <Panel className="p-5">
                    <form onSubmit={e => void create(e)} className="flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="link-role">Role</Label>
                                <Select value={role} onValueChange={setRole} disabled={busy}>
                                    <SelectTrigger
                                        id="link-role"
                                        aria-label="Role the link hands out"
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
                        <div className="flex items-center gap-2">
                            <Switch
                                id="link-approval"
                                checked={requiresApproval}
                                onCheckedChange={setRequiresApproval}
                                disabled={busy}
                            />
                            <Label htmlFor="link-approval" className="text-ink-2 text-[13px]">
                                Require approval
                            </Label>
                        </div>
                        {error && <ErrorNote message={error} />}
                        <div>
                            <Button type="submit" variant="outline" disabled={busy}>
                                {busy ? "Creating…" : "Create link"}
                            </Button>
                        </div>
                    </form>
                </Panel>

                <Panel className="mt-3">
                    {loading ? (
                        <LoadingNote label="Loading links…" />
                    ) : links.length === 0 ? (
                        <EmptyState
                            title="No other links"
                            body="The invite link above is the only one. Create another here when a group needs its own role, an expiry or a cap."
                        />
                    ) : (
                        <ul className="divide-line m-0 list-none divide-y p-0">
                            {links.map(link => {
                                const state = joinLinkState(link);
                                return (
                                    <li
                                        key={link.id}
                                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                                    >
                                        <div
                                            className={cn(
                                                "min-w-0 flex-1",
                                                state !== "live" && "opacity-60"
                                            )}
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-ink text-sm font-medium">
                                                    {link.roleName}
                                                </span>
                                                {link.requiresApproval && (
                                                    <Badge variant="warn">Needs approval</Badge>
                                                )}
                                                {state !== "live" && (
                                                    <Badge variant="secondary">
                                                        {state === "expired"
                                                            ? "Expired"
                                                            : "Used up"}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div
                                                className="text-ink-3 mt-0.5 truncate font-mono text-xs"
                                                title={link.url}
                                            >
                                                {link.url}
                                            </div>
                                            <div className="text-ink-3 mt-0.5 text-[12.5px]">
                                                {joinLinkTerms(link)}
                                            </div>
                                        </div>
                                        <div className="-ml-2 flex flex-wrap gap-1 sm:ml-0 sm:justify-end">
                                            <CopyButton
                                                value={link.url}
                                                label="Copy link"
                                                variant="ghost"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => ask(link, "reset")}
                                            >
                                                Reset
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-danger hover:text-danger"
                                                onClick={() => ask(link, "revoke")}
                                            >
                                                Revoke
                                            </Button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Panel>
            </CollapsibleContent>

            <ConfirmDialog
                open={pendingOpen}
                title={pending?.action === "reset" ? "Reset this link?" : "Revoke this link?"}
                body={
                    pending?.action === "reset"
                        ? "The current link stops working right away and a new one with the same terms replaces it. People who already joined keep their access."
                        : "Anyone who has the link can no longer use it. People who already joined keep their access."
                }
                confirmLabel={pending?.action === "reset" ? "Reset link" : "Revoke link"}
                busyLabel={pending?.action === "reset" ? "Resetting…" : "Revoking…"}
                danger={pending?.action !== "reset"}
                busy={pendingBusy}
                error={pendingError}
                onConfirm={() => void confirmPending()}
                onClose={() => setPendingOpen(false)}
            />
        </Collapsible>
    );
}
