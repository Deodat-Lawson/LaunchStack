"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import { Textarea } from "~/components/ui/textarea";
import {
    PERMISSION_DESCRIPTIONS,
    ROLE_DESCRIPTIONS,
    isBuiltinRole,
    isPermission,
    roleRank,
    type Permission,
} from "~/lib/authz/permissions";
import { invalidatePermissions } from "~/lib/use-permissions";

import { errorMessage, isApiError, peopleApi, type PermissionInfo, type Role } from "./api";
import { plural } from "./format";
import { ConfirmDialog, EmptyState, ErrorNote, LoadingNote, Panel, TabIntro } from "./ui";

interface RolesTabProps {
    can: (permission: Permission | undefined) => boolean;
}

export function RolesTab({ can }: RolesTabProps) {
    const canManage = can("roles.manage");

    const [roles, setRoles] = useState<Role[]>([]);
    const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Role | "new" | null>(null);
    const [deleting, setDeleting] = useState<Role | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [reassign, setReassign] = useState<{
        role: Role;
        memberCount: number;
        to: string;
    } | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await peopleApi.roles.list();
            setRoles(res.roles);
            setPermissions(res.permissions);
        } catch (err) {
            setError(errorMessage(err, "Could not load roles."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const builtins = useMemo(
        () => roles.filter(r => r.builtin).sort((a, b) => roleRank(b.slug) - roleRank(a.slug)),
        [roles]
    );
    const customs = useMemo(
        () => roles.filter(r => !r.builtin).sort((a, b) => a.name.localeCompare(b.name)),
        [roles]
    );

    const remove = async (role: Role, reassignTo?: string) => {
        if (role.id === null) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            const res = await peopleApi.roles.remove(role.id, reassignTo);
            toast.success(
                res.reassigned > 0
                    ? `${role.name} deleted. ${plural(res.reassigned, "member")} moved to another role.`
                    : `${role.name} deleted.`
            );
            setDeleting(null);
            setReassign(null);
            void invalidatePermissions();
            await load();
        } catch (err) {
            if (isApiError(err) && err.status === 409) {
                const memberCount = Number(err.body.memberCount ?? 0);
                setDeleting(null);
                setReassign({ role, memberCount, to: "" });
            } else {
                setDeleteError(errorMessage(err, "The role wasn't deleted."));
            }
        } finally {
            setDeleteBusy(false);
        }
    };

    const reassignTargets = useMemo(
        () => roles.filter(r => r.assignable && r.slug !== reassign?.role.slug),
        [roles, reassign]
    );

    return (
        <div className="flex flex-col gap-6">
            <TabIntro
                title="Roles"
                description="A role is a named set of permissions. The built-in ones cover most workspaces; add a custom role when a job needs a different mix — reviewers who can read and upload but never delete, say."
                actions={
                    canManage ? (
                        <Button size="sm" onClick={() => setEditing("new")}>
                            <Plus /> New role
                        </Button>
                    ) : undefined
                }
            />

            {error && <ErrorNote message={error} onRetry={() => void load()} />}

            {loading ? (
                <Panel>
                    <LoadingNote label="Loading roles…" />
                </Panel>
            ) : (
                <>
                    <section>
                        <h3 className="text-ink-3 mono m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Built-in roles
                        </h3>
                        <div className="grid gap-3 md:grid-cols-2">
                            {builtins.map(role => (
                                <RoleCard key={role.slug} role={role} permissions={permissions} />
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-ink-3 mono m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            Custom roles
                        </h3>
                        {customs.length === 0 ? (
                            <Panel>
                                <EmptyState
                                    title="No custom roles"
                                    body={
                                        canManage
                                            ? "Create one when none of the built-in roles fits a job exactly."
                                            : "An admin can create a role when none of the built-in ones fits."
                                    }
                                    action={
                                        canManage ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setEditing("new")}
                                            >
                                                <Plus /> New role
                                            </Button>
                                        ) : undefined
                                    }
                                />
                            </Panel>
                        ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                                {customs.map(role => (
                                    <RoleCard
                                        key={role.slug}
                                        role={role}
                                        permissions={permissions}
                                        actions={
                                            canManage && role.editable ? (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setEditing(role)}
                                                    >
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-danger hover:text-danger"
                                                        onClick={() => {
                                                            setDeleteError(null);
                                                            setDeleting(role);
                                                        }}
                                                    >
                                                        Delete
                                                    </Button>
                                                </>
                                            ) : undefined
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}

            <RoleDialog
                role={editing}
                permissions={permissions}
                can={can}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    void invalidatePermissions();
                    void load();
                }}
            />

            <ConfirmDialog
                open={deleting !== null}
                title={`Delete the ${deleting?.name ?? ""} role?`}
                body={
                    deleting && deleting.memberCount > 0
                        ? `${plural(deleting.memberCount, "member")} currently ${deleting.memberCount === 1 ? "has" : "have"} this role. You'll be asked which role to move them to.`
                        : "Nobody has this role right now, so removing it changes no one's access."
                }
                confirmLabel="Delete role"
                danger
                busy={deleteBusy}
                error={deleteError}
                onConfirm={() => {
                    if (deleting) void remove(deleting);
                }}
                onClose={() => setDeleting(null)}
            />

            <ConfirmDialog
                open={reassign !== null}
                title={`Move ${plural(reassign?.memberCount ?? 0, "member")} to another role`}
                body={`${reassign?.role.name ?? "This role"} is still assigned. Pick the role those people should have once it is gone.`}
                confirmLabel="Move members and delete"
                danger
                busy={deleteBusy}
                error={deleteError}
                confirmDisabled={!reassign?.to}
                onConfirm={() => {
                    if (reassign?.to) void remove(reassign.role, reassign.to);
                }}
                onClose={() => setReassign(null)}
            >
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reassign-role">New role</Label>
                    <Select
                        value={reassign?.to ?? ""}
                        onValueChange={value =>
                            setReassign(prev => (prev ? { ...prev, to: value } : prev))
                        }
                    >
                        <SelectTrigger id="reassign-role">
                            <SelectValue placeholder="Choose a role" />
                        </SelectTrigger>
                        <SelectContent>
                            {reassignTargets.map(r => (
                                <SelectItem key={r.slug} value={r.slug}>
                                    {r.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </ConfirmDialog>
        </div>
    );
}

function describe(role: Role): string {
    if (isBuiltinRole(role.slug)) return ROLE_DESCRIPTIONS[role.slug];
    return role.description ?? "";
}

function RoleCard({
    role,
    permissions,
    actions,
}: {
    role: Role;
    permissions: PermissionInfo[];
    actions?: React.ReactNode;
}) {
    const [showAll, setShowAll] = useState(false);
    const byKey = useMemo(() => new Map(permissions.map(p => [p.key, p])), [permissions]);
    const lines = role.permissions.map(key => ({
        key,
        text: isPermission(key)
            ? PERMISSION_DESCRIPTIONS[key]
            : (byKey.get(key)?.description ?? key),
    }));
    const visible = showAll ? lines : lines.slice(0, 4);

    return (
        <Panel className="flex flex-col p-4">
            <div className="flex items-start gap-3">
                <span className="bg-brand-soft text-brand flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink text-sm font-semibold">{role.name}</span>
                        {role.builtin && <Badge variant="outline">Built-in</Badge>}
                        <Badge variant="secondary">{plural(role.memberCount, "member")}</Badge>
                    </div>
                    {describe(role) && (
                        <p className="text-ink-3 m-0 mt-0.5 text-[12.5px] leading-normal">
                            {describe(role)}
                        </p>
                    )}
                </div>
                {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
            </div>
            <ul className="text-ink-2 m-0 mt-3 list-none p-0 text-[12.5px] leading-relaxed">
                {lines.length === 0 && <li className="text-ink-3">No permissions.</li>}
                {visible.map(line => (
                    <li key={line.key} className="flex gap-2">
                        <span className="text-ink-4" aria-hidden>
                            •
                        </span>
                        <span>{line.text}</span>
                    </li>
                ))}
            </ul>
            {lines.length > 4 && (
                <button
                    type="button"
                    className="text-brand focus-visible:ring-brand/50 mt-1.5 self-start rounded text-[12px] font-semibold outline-none focus-visible:ring-[3px]"
                    onClick={() => setShowAll(v => !v)}
                    aria-expanded={showAll}
                >
                    {showAll ? "Show fewer" : `Show all ${lines.length} permissions`}
                </button>
            )}
        </Panel>
    );
}

function RoleDialog({
    role,
    permissions,
    can,
    onClose,
    onSaved,
}: {
    role: Role | "new" | null;
    permissions: PermissionInfo[];
    can: (permission: Permission | undefined) => boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const open = role !== null;
    const isNew = role === "new";
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(isNew ? "" : (role?.name ?? ""));
        setDescription(isNew ? "" : (role?.description ?? ""));
        setSelected(new Set(isNew ? ["documents.read"] : (role?.permissions ?? [])));
        setError(null);
    }, [open, isNew, role]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Give the role a name people will recognise.");
            return;
        }
        if (selected.size === 0) {
            setError("Pick at least one permission — a role that allows nothing can't be used.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const body = {
                name: trimmed,
                description: description.trim() || undefined,
                permissions: [...selected],
            };
            if (isNew) await peopleApi.roles.create(body);
            else if (role && role.id !== null) await peopleApi.roles.update(role.id, body);
            toast.success(isNew ? `Role ${trimmed} created` : `Role ${trimmed} saved`);
            onSaved();
        } catch (err) {
            setError(errorMessage(err, "The role wasn't saved."));
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
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <form onSubmit={e => void save(e)} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>
                            {isNew ? "New role" : `Edit ${role?.name ?? "role"}`}
                        </DialogTitle>
                        <DialogDescription>
                            Tick what people with this role may do. You can only hand out
                            permissions you hold yourself; owner-only ones stay with the Owner.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="role-name">Name</Label>
                            <Input
                                id="role-name"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Legal reviewer"
                                autoFocus
                                disabled={busy}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="role-description">
                                Description{" "}
                                <span className="text-ink-3 font-normal">(optional)</span>
                            </Label>
                            <Textarea
                                id="role-description"
                                rows={1}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Reads and comments, never deletes"
                                disabled={busy}
                            />
                        </div>
                    </div>

                    <fieldset className="m-0 border-0 p-0">
                        <legend className="text-ink-2 mb-2 text-xs font-semibold">
                            Permissions
                        </legend>
                        <ul className="border-line m-0 list-none divide-y rounded-lg border p-0">
                            {permissions.map(p => {
                                const key = p.key;
                                const heldByViewer = isPermission(key) ? can(key) : false;
                                const locked = p.ownerOnly || !heldByViewer;
                                const checked = selected.has(key);
                                const id = `perm-${key}`;
                                return (
                                    <li key={key} className="flex items-start gap-3 px-3 py-2">
                                        <Checkbox
                                            id={id}
                                            checked={checked}
                                            disabled={busy || (locked && !checked)}
                                            onCheckedChange={next =>
                                                setSelected(prev => {
                                                    const out = new Set(prev);
                                                    if (next === true) out.add(key);
                                                    else out.delete(key);
                                                    return out;
                                                })
                                            }
                                            className="mt-0.5"
                                        />
                                        <label
                                            htmlFor={id}
                                            className="min-w-0 flex-1 cursor-pointer"
                                        >
                                            <span className="text-ink mono block text-[11.5px] font-semibold">
                                                {key}
                                                {p.ownerOnly && (
                                                    <span className="text-ink-3 ml-2 font-normal">
                                                        Owner only
                                                    </span>
                                                )}
                                                {!p.ownerOnly && !heldByViewer && (
                                                    <span className="text-ink-3 ml-2 font-normal">
                                                        Not yours to give
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-ink-3 block text-[12.5px] leading-normal">
                                                {isPermission(key)
                                                    ? PERMISSION_DESCRIPTIONS[key]
                                                    : p.description}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </fieldset>

                    {error && <ErrorNote message={error} />}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {busy ? "Saving…" : isNew ? "Create role" : "Save role"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
