"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import {
    INVITABLE_BUILTIN_ROLES,
    ROLE_LABELS,
    normalizeRoleSlug,
    roleLabel,
    type Permission,
} from "~/lib/authz/permissions";
import { invalidatePermissions } from "~/lib/use-permissions";

import { errorMessage, peopleApi, type Member, type MemberCounts, type Role } from "./api";
import { relativeTime } from "./format";
import {
    ConfirmDialog,
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    StatusPill,
    TabIntro,
} from "./ui";

interface MembersTabProps {
    can: (permission: Permission | undefined) => boolean;
}

type RoleOption = Pick<Role, "slug" | "name" | "assignable">;

type PendingAction =
    | { kind: "remove"; member: Member }
    | { kind: "suspend"; member: Member }
    | { kind: "transfer"; member: Member }
    | { kind: "leave" };

/** Used only if the roles endpoint is unavailable, so the picker still works. */
const FALLBACK_ROLES: RoleOption[] = INVITABLE_BUILTIN_ROLES.map(slug => ({
    slug,
    name: ROLE_LABELS[slug],
    assignable: true,
}));

function isOwner(member: Member): boolean {
    return normalizeRoleSlug(member.role) === "owner";
}

export function MembersTab({ can }: MembersTabProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [counts, setCounts] = useState<MemberCounts>({ active: 0, pending: 0, suspended: 0 });
    const [roles, setRoles] = useState<RoleOption[]>(FALLBACK_ROLES);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [pendingBusy, setPendingBusy] = useState(false);
    const [pendingError, setPendingError] = useState<string | null>(null);

    const canManage = can("members.manage");
    const canTransfer = can("workspace.transfer");

    const load = useCallback(async () => {
        setError(null);
        try {
            const [membersRes, rolesRes] = await Promise.all([
                peopleApi.members.list(),
                peopleApi.roles.list().catch(() => null),
            ]);
            setMembers(membersRes.members);
            setCounts(membersRes.counts);
            if (rolesRes) setRoles(rolesRes.roles);
        } catch (err) {
            setError(errorMessage(err, "Could not load the member list."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const assignableRoles = useMemo(() => roles.filter(r => r.assignable), [roles]);
    const self = useMemo(() => members.find(m => m.isSelf) ?? null, [members]);

    const roleOptionsFor = (member: Member): RoleOption[] => {
        if (assignableRoles.some(r => r.slug === member.role)) return assignableRoles;
        // Keep the current role visible even if it is no longer assignable.
        return [
            { slug: member.role, name: member.roleName, assignable: false },
            ...assignableRoles,
        ];
    };

    const patch = async (
        member: Member,
        body: { role?: string; status?: "active" | "suspended" },
        success: string
    ) => {
        setBusyId(member.id);
        try {
            const updated = await peopleApi.members.update(member.id, body);
            setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
            toast.success(success);
            await load();
        } catch (err) {
            toast.error(errorMessage(err, "That change didn't go through."));
        } finally {
            setBusyId(null);
        }
    };

    const changeRole = (member: Member, role: string) => {
        if (role === member.role) return;
        const name = roles.find(r => r.slug === role)?.name;
        void patch(member, { role }, `${member.name} is now ${roleLabel(role, name)}`);
    };

    const runPending = async () => {
        if (!pending) return;
        setPendingBusy(true);
        setPendingError(null);
        try {
            if (pending.kind === "remove") {
                await peopleApi.members.remove(pending.member.id);
                toast.success(`${pending.member.name} was removed from the workspace`);
            } else if (pending.kind === "suspend") {
                await peopleApi.members.update(pending.member.id, { status: "suspended" });
                toast.success(`${pending.member.name}'s access is suspended`);
            } else if (pending.kind === "transfer") {
                await peopleApi.members.transferOwnership(pending.member.id);
                toast.success(`${pending.member.name} now owns this workspace`);
                void invalidatePermissions();
            } else {
                const res = await peopleApi.members.leave();
                window.location.href = res.redirectTo || "/workspaces";
                return;
            }
            setPending(null);
            await load();
        } catch (err) {
            setPendingError(errorMessage(err, "That didn't go through."));
        } finally {
            setPendingBusy(false);
        }
    };

    const confirmCopy = (): {
        title: string;
        body: string;
        confirmLabel: string;
        danger: boolean;
    } => {
        if (!pending) return { title: "", body: "", confirmLabel: "", danger: false };
        switch (pending.kind) {
            case "remove":
                return {
                    title: `Remove ${pending.member.name}?`,
                    body: `${pending.member.name} loses access to this workspace immediately. Documents they added stay. You can invite them again later.`,
                    confirmLabel: "Remove from workspace",
                    danger: true,
                };
            case "suspend":
                return {
                    title: `Suspend ${pending.member.name}'s access?`,
                    body: `${pending.member.name} stays listed as a member but can't open anything until you reinstate them.`,
                    confirmLabel: "Suspend access",
                    danger: true,
                };
            case "transfer":
                return {
                    title: `Transfer ownership to ${pending.member.name}?`,
                    body: `${pending.member.name} becomes the Owner — billing, ownership, and everything else. You become an Admin. Only the new owner can transfer it back.`,
                    confirmLabel: "Transfer ownership",
                    danger: true,
                };
            case "leave":
                return {
                    title: "Leave this workspace?",
                    body: "You lose access immediately. Documents you added stay. An admin can invite you back.",
                    confirmLabel: "Leave workspace",
                    danger: true,
                };
        }
    };

    const copy = confirmCopy();

    return (
        <div>
            <TabIntro
                title="Members"
                description="Everyone in the workspace, with the role that decides what they can do. Approve people who joined with a link, change roles, or suspend access without removing anyone."
                actions={
                    <div className="flex flex-wrap items-center gap-1.5" aria-label="Member counts">
                        <Badge variant="success">{counts.active} active</Badge>
                        <Badge variant={counts.pending > 0 ? "warn" : "secondary"}>
                            {counts.pending} pending
                        </Badge>
                        <Badge variant="secondary">{counts.suspended} suspended</Badge>
                    </div>
                }
            />

            {error && (
                <div className="mb-4">
                    <ErrorNote message={error} onRetry={() => void load()} />
                </div>
            )}

            <Panel>
                {loading ? (
                    <LoadingNote label="Loading members…" />
                ) : members.length === 0 ? (
                    <EmptyState
                        title="No members yet"
                        body="Invite someone from the Invitations tab, or share a join link."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-panel-2/50">
                                    <TableHead>Name</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Groups</TableHead>
                                    <TableHead>Last active</TableHead>
                                    <TableHead className="w-12 text-right">
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map(member => {
                                    const busy = busyId === member.id;
                                    const owner = isOwner(member);
                                    const roleEditable = canManage && !member.isSelf && !owner;
                                    return (
                                        <TableRow key={member.id} className="hover:bg-panel-2/30">
                                            <TableCell>
                                                <div className="flex min-w-0 flex-col">
                                                    <span className="text-ink flex items-center gap-2 font-medium">
                                                        <span className="truncate">
                                                            {member.name || member.email}
                                                        </span>
                                                        {member.isSelf && (
                                                            <Badge variant="outline">You</Badge>
                                                        )}
                                                    </span>
                                                    <span className="text-ink-3 truncate text-xs">
                                                        {member.email}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {roleEditable ? (
                                                    <Select
                                                        value={member.role}
                                                        onValueChange={value =>
                                                            changeRole(member, value)
                                                        }
                                                        disabled={busy}
                                                    >
                                                        <SelectTrigger
                                                            size="sm"
                                                            className="w-[160px]"
                                                            aria-label={`Change ${member.name}'s role`}
                                                        >
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {roleOptionsFor(member).map(r => (
                                                                <SelectItem
                                                                    key={r.slug}
                                                                    value={r.slug}
                                                                    disabled={!r.assignable}
                                                                >
                                                                    {r.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <span className="text-ink-2 text-sm">
                                                        {member.roleName}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <StatusPill status={member.status} />
                                            </TableCell>
                                            <TableCell>
                                                {member.groups.length === 0 ? (
                                                    <span className="text-ink-4 text-sm">—</span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {member.groups.map(g => (
                                                            <Badge key={g.id} variant="secondary">
                                                                {g.name}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-ink-3 whitespace-nowrap text-sm">
                                                {relativeTime(member.lastActiveAt)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {!member.isSelf && (canManage || canTransfer) && (
                                                    <RowActions
                                                        member={member}
                                                        busy={busy}
                                                        canManage={canManage}
                                                        canTransfer={canTransfer}
                                                        onApprove={() =>
                                                            void patch(
                                                                member,
                                                                { status: "active" },
                                                                `${member.name} can now open the workspace`
                                                            )
                                                        }
                                                        onReinstate={() =>
                                                            void patch(
                                                                member,
                                                                { status: "active" },
                                                                `${member.name}'s access is back`
                                                            )
                                                        }
                                                        onSuspend={() =>
                                                            setPending({ kind: "suspend", member })
                                                        }
                                                        onRemove={() =>
                                                            setPending({ kind: "remove", member })
                                                        }
                                                        onTransfer={() =>
                                                            setPending({ kind: "transfer", member })
                                                        }
                                                    />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Panel>

            {self && !isOwner(self) && (
                <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-ink-3 m-0 text-[12.5px]">
                        Leaving removes your access to this workspace. Documents you added stay.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPending({ kind: "leave" })}
                    >
                        Leave workspace
                    </Button>
                </div>
            )}
            {self && isOwner(self) && members.length > 1 && (
                <p className="text-ink-3 mt-4 text-[12.5px]">
                    As the owner you can&apos;t leave. Transfer ownership to someone first.
                </p>
            )}

            <ConfirmDialog
                open={pending !== null}
                title={copy.title}
                body={copy.body}
                confirmLabel={copy.confirmLabel}
                danger={copy.danger}
                busy={pendingBusy}
                error={pendingError}
                onConfirm={() => void runPending()}
                onClose={() => {
                    setPending(null);
                    setPendingError(null);
                }}
            />
        </div>
    );
}

function RowActions({
    member,
    busy,
    canManage,
    canTransfer,
    onApprove,
    onReinstate,
    onSuspend,
    onRemove,
    onTransfer,
}: {
    member: Member;
    busy: boolean;
    canManage: boolean;
    canTransfer: boolean;
    onApprove: () => void;
    onReinstate: () => void;
    onSuspend: () => void;
    onRemove: () => void;
    onTransfer: () => void;
}) {
    const owner = isOwner(member);
    const items: React.ReactNode[] = [];
    if (canManage && member.status === "pending") {
        items.push(
            <DropdownMenuItem key="approve" onSelect={onApprove}>
                Approve
            </DropdownMenuItem>
        );
    }
    if (canManage && member.status === "active" && !owner) {
        items.push(
            <DropdownMenuItem key="suspend" onSelect={onSuspend}>
                Suspend access
            </DropdownMenuItem>
        );
    }
    if (canManage && member.status === "suspended") {
        items.push(
            <DropdownMenuItem key="reinstate" onSelect={onReinstate}>
                Reinstate access
            </DropdownMenuItem>
        );
    }
    if (canTransfer && member.status === "active" && !owner) {
        items.push(
            <DropdownMenuItem key="transfer" onSelect={onTransfer}>
                Transfer ownership
            </DropdownMenuItem>
        );
    }
    if (canManage && !owner) {
        if (items.length > 0) items.push(<DropdownMenuSeparator key="sep" />);
        items.push(
            <DropdownMenuItem
                key="remove"
                onSelect={onRemove}
                className="text-danger focus:text-danger"
            >
                Remove from workspace
            </DropdownMenuItem>
        );
    }
    if (items.length === 0) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={busy}
                    aria-label={`Actions for ${member.name}`}
                >
                    <MoreHorizontal />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{items}</DropdownMenuContent>
        </DropdownMenu>
    );
}
