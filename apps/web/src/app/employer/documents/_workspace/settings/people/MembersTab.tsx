"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import { buildMemberMenuItems, type MemberMenuHandlers } from "./peopleContextMenu";

import { ProfileAvatar } from "~/components/ProfileAvatar";
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
    type Permission,
} from "~/lib/authz/permissions";
import { invalidatePermissions } from "~/lib/use-permissions";

import { peopleApi, type Member, type MemberCounts, type Role } from "./api";
import { useTimeFormat } from "./format";
import {
    ConfirmDialog,
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    StatusPill,
    TabIntro,
    useErrorText,
    useRoleLabel,
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

/** A member row: the role picker and the "⋯" menu, reachable by right-click. */
function MemberRow({
    member,
    roles,
    roleEditable,
    canManage,
    canTransfer,
    busy,
    handlers,
    children,
}: {
    member: Member;
    roles: RoleOption[];
    roleEditable: boolean;
    canManage: boolean;
    canTransfer: boolean;
    busy: boolean;
    handlers: MemberMenuHandlers;
    children: React.ReactNode;
}) {
    const t = useTranslations("settings.people.members");
    const tm = useTranslations("settings.people.menu");
    const ctxTarget = useContextTarget({
        kind: "member",
        id: String(member.id),
        label: t("actionsFor", { name: member.name || member.email }),
        data: member,
        items: () =>
            buildMemberMenuItems(
                member,
                { roles, roleEditable, canManage, canTransfer, owner: isOwner(member), busy },
                handlers,
                tm
            ),
    });
    return (
        <TableRow {...ctxTarget} className="hover:bg-panel-2/30">
            {children}
        </TableRow>
    );
}

function isOwner(member: Member): boolean {
    return normalizeRoleSlug(member.role) === "owner";
}

export function MembersTab({ can }: MembersTabProps) {
    const t = useTranslations("settings.people.members");
    const tc = useTranslations("common");
    const time = useTimeFormat();
    const errorText = useErrorText();
    const roleName = useRoleLabel();
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
            setError(errorText(err, t("loadFailed")));
        } finally {
            setLoading(false);
        }
    }, [errorText, t]);

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
            toast.error(errorText(err, t("changeFailed")));
        } finally {
            setBusyId(null);
        }
    };

    const changeRole = (member: Member, role: string) => {
        if (role === member.role) return;
        const name = roles.find(r => r.slug === role)?.name;
        void patch(
            member,
            { role },
            t("nowRole", { name: member.name, role: roleName(role, name) })
        );
    };

    const runPending = async () => {
        if (!pending) return;
        setPendingBusy(true);
        setPendingError(null);
        try {
            if (pending.kind === "remove") {
                await peopleApi.members.remove(pending.member.id);
                toast.success(t("removedToast", { name: pending.member.name }));
            } else if (pending.kind === "suspend") {
                await peopleApi.members.update(pending.member.id, { status: "suspended" });
                toast.success(t("suspendedToast", { name: pending.member.name }));
            } else if (pending.kind === "transfer") {
                await peopleApi.members.transferOwnership(pending.member.id);
                toast.success(t("transferredToast", { name: pending.member.name }));
                void invalidatePermissions();
            } else {
                const res = await peopleApi.members.leave();
                window.location.href = res.redirectTo || "/workspaces";
                return;
            }
            setPending(null);
            await load();
        } catch (err) {
            setPendingError(errorText(err, t("pendingFailed")));
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
            case "suspend":
            case "transfer": {
                const name = pending.member.name;
                return {
                    title: t(`confirm.${pending.kind}.title`, { name }),
                    body: t(`confirm.${pending.kind}.body`, { name }),
                    confirmLabel: t(`confirm.${pending.kind}.confirm`),
                    danger: true,
                };
            }
            case "leave":
                return {
                    title: t("confirm.leave.title"),
                    body: t("confirm.leave.body"),
                    confirmLabel: t("confirm.leave.confirm"),
                    danger: true,
                };
        }
    };

    const copy = confirmCopy();

    return (
        <div>
            <TabIntro
                title={t("intro.title")}
                description={t("intro.description")}
                actions={
                    <div
                        className="flex flex-wrap items-center gap-1.5"
                        aria-label={t("counts.label")}
                    >
                        <Badge variant="success">
                            {t("counts.active", { count: counts.active })}
                        </Badge>
                        <Badge variant={counts.pending > 0 ? "warn" : "secondary"}>
                            {t("counts.pending", { count: counts.pending })}
                        </Badge>
                        <Badge variant="secondary">
                            {t("counts.suspended", { count: counts.suspended })}
                        </Badge>
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
                    <LoadingNote label={t("loading")} />
                ) : members.length === 0 ? (
                    <EmptyState title={t("empty.title")} body={t("empty.body")} />
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-panel-2/50">
                                    <TableHead>{tc("fields.name")}</TableHead>
                                    <TableHead>{tc("fields.role")}</TableHead>
                                    <TableHead>{tc("fields.status")}</TableHead>
                                    <TableHead>{t("columns.groups")}</TableHead>
                                    <TableHead>{t("columns.lastActive")}</TableHead>
                                    <TableHead className="w-12 text-right">
                                        <span className="sr-only">{t("columns.actions")}</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map(member => {
                                    const busy = busyId === member.id;
                                    const owner = isOwner(member);
                                    const roleEditable = canManage && !member.isSelf && !owner;
                                    return (
                                        <MemberRow
                                            key={member.id}
                                            member={member}
                                            roles={roleOptionsFor(member)}
                                            roleEditable={roleEditable}
                                            canManage={canManage}
                                            canTransfer={canTransfer}
                                            busy={busy}
                                            handlers={{
                                                onChangeRole: role => changeRole(member, role),
                                                onCopyEmail: () => {
                                                    void copyText(member.email).then(ok => {
                                                        if (ok) toast.success(t("emailCopied"));
                                                    });
                                                },
                                                onApprove: () =>
                                                    void patch(
                                                        member,
                                                        { status: "active" },
                                                        t("approvedToast", { name: member.name })
                                                    ),
                                                onReinstate: () =>
                                                    void patch(
                                                        member,
                                                        { status: "active" },
                                                        t("reinstatedToast", { name: member.name })
                                                    ),
                                                onSuspend: () =>
                                                    setPending({ kind: "suspend", member }),
                                                onTransfer: () =>
                                                    setPending({ kind: "transfer", member }),
                                                onRemove: () =>
                                                    setPending({ kind: "remove", member }),
                                            }}
                                        >
                                            <TableCell>
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <ProfileAvatar
                                                        name={member.displayName}
                                                        email={member.email}
                                                        src={member.avatarUrl}
                                                    />
                                                    <div className="flex min-w-0 flex-col">
                                                        <span className="text-ink flex items-center gap-2 font-medium">
                                                            <span
                                                                className="truncate"
                                                                title={
                                                                    member.displayName !==
                                                                    member.name
                                                                        ? member.name
                                                                        : undefined
                                                                }
                                                            >
                                                                {member.displayName}
                                                            </span>
                                                            {member.pronouns && (
                                                                <span className="text-ink-3 shrink-0 text-xs font-normal">
                                                                    {member.pronouns}
                                                                </span>
                                                            )}
                                                            {member.isSelf && (
                                                                <Badge variant="outline">
                                                                    {t("you")}
                                                                </Badge>
                                                            )}
                                                        </span>
                                                        <span className="text-ink-3 truncate text-xs">
                                                            {member.title
                                                                ? `${member.title} · ${member.email}`
                                                                : member.email}
                                                        </span>
                                                    </div>
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
                                                            aria-label={t("changeRoleFor", {
                                                                name: member.name,
                                                            })}
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
                                                                    {roleName(r.slug, r.name)}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <span className="text-ink-2 text-sm">
                                                        {roleName(member.role, member.roleName)}
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
                                                {time.relative(member.lastActiveAt)}
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
                                                                t("approvedToast", {
                                                                    name: member.name,
                                                                })
                                                            )
                                                        }
                                                        onReinstate={() =>
                                                            void patch(
                                                                member,
                                                                { status: "active" },
                                                                t("reinstatedToast", {
                                                                    name: member.name,
                                                                })
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
                                        </MemberRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Panel>

            {self && !isOwner(self) && (
                <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-ink-3 m-0 text-[12.5px]">{t("leaveNote")}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPending({ kind: "leave" })}
                    >
                        {t("confirm.leave.confirm")}
                    </Button>
                </div>
            )}
            {self && isOwner(self) && members.length > 1 && (
                <p className="text-ink-3 mt-4 text-[12.5px]">{t("ownerCantLeave")}</p>
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
    const t = useTranslations("settings.people.members");
    const tm = useTranslations("settings.people.menu");
    const owner = isOwner(member);
    const items: React.ReactNode[] = [];
    if (canManage && member.status === "pending") {
        items.push(
            <DropdownMenuItem key="approve" onSelect={onApprove}>
                {tm("approve")}
            </DropdownMenuItem>
        );
    }
    if (canManage && member.status === "active" && !owner) {
        items.push(
            <DropdownMenuItem key="suspend" onSelect={onSuspend}>
                {t("confirm.suspend.confirm")}
            </DropdownMenuItem>
        );
    }
    if (canManage && member.status === "suspended") {
        items.push(
            <DropdownMenuItem key="reinstate" onSelect={onReinstate}>
                {tm("reinstate")}
            </DropdownMenuItem>
        );
    }
    if (canTransfer && member.status === "active" && !owner) {
        items.push(
            <DropdownMenuItem key="transfer" onSelect={onTransfer}>
                {t("confirm.transfer.confirm")}
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
                {t("confirm.remove.confirm")}
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
                    aria-label={t("actionsFor", { name: member.name })}
                >
                    <MoreHorizontal />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{items}</DropdownMenuContent>
        </DropdownMenu>
    );
}
