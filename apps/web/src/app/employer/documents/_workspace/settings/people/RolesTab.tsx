"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
import { isBuiltinRole, isPermission, roleRank, type Permission } from "~/lib/authz/permissions";
import { invalidatePermissions } from "~/lib/use-permissions";

import { isApiError, peopleApi, type PermissionInfo, type Role } from "./api";
import {
    ConfirmDialog,
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    TabIntro,
    useErrorText,
    usePermissionText,
    useRoleDescription,
    useRoleLabel,
} from "./ui";

interface RolesTabProps {
    can: (permission: Permission | undefined) => boolean;
}

export function RolesTab({ can }: RolesTabProps) {
    const t = useTranslations("settings.people.roles");
    const tc = useTranslations("common");
    const errorText = useErrorText();
    const roleLabel = useRoleLabel();
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
            setError(errorText(err, t("loadFailed")));
        } finally {
            setLoading(false);
        }
    }, [errorText, t]);

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
                    ? t("deletedMoved", { name: role.name, count: res.reassigned })
                    : t("deleted", { name: role.name })
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
                setDeleteError(errorText(err, t("deleteFailed")));
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
                title={t("intro.title")}
                description={t("intro.description")}
                actions={
                    canManage ? (
                        <Button size="sm" onClick={() => setEditing("new")}>
                            <Plus /> {t("newRole")}
                        </Button>
                    ) : undefined
                }
            />

            {error && <ErrorNote message={error} onRetry={() => void load()} />}

            {loading ? (
                <Panel>
                    <LoadingNote label={t("loading")} />
                </Panel>
            ) : (
                <>
                    <section>
                        <h3 className="text-ink-3 mono m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            {t("builtinRoles")}
                        </h3>
                        <div className="grid gap-3 md:grid-cols-2">
                            {builtins.map(role => (
                                <RoleCard key={role.slug} role={role} permissions={permissions} />
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-ink-3 mono m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">
                            {t("customRoles")}
                        </h3>
                        {customs.length === 0 ? (
                            <Panel>
                                <EmptyState
                                    title={t("empty.title")}
                                    body={canManage ? t("empty.bodyManage") : t("empty.bodyView")}
                                    action={
                                        canManage ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setEditing("new")}
                                            >
                                                <Plus /> {t("newRole")}
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
                                                        {tc("actions.edit")}
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
                                                        {tc("actions.delete")}
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
                title={t("confirmDelete.title", { name: deleting?.name ?? "" })}
                body={
                    deleting && deleting.memberCount > 0
                        ? t("confirmDelete.bodyHas", { count: deleting.memberCount })
                        : t("confirmDelete.bodyNone")
                }
                confirmLabel={t("confirmDelete.confirm")}
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
                title={t("reassign.title", { count: reassign?.memberCount ?? 0 })}
                body={t("reassign.body", { name: reassign?.role.name ?? t("reassign.thisRole") })}
                confirmLabel={t("reassign.confirm")}
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
                    <Label htmlFor="reassign-role">{t("reassign.newRole")}</Label>
                    <Select
                        value={reassign?.to ?? ""}
                        onValueChange={value =>
                            setReassign(prev => (prev ? { ...prev, to: value } : prev))
                        }
                    >
                        <SelectTrigger id="reassign-role">
                            <SelectValue placeholder={t("reassign.chooseRole")} />
                        </SelectTrigger>
                        <SelectContent>
                            {reassignTargets.map(r => (
                                <SelectItem key={r.slug} value={r.slug}>
                                    {roleLabel(r.slug, r.name)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </ConfirmDialog>
        </div>
    );
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
    const t = useTranslations("settings.people.roles.card");
    const roleLabel = useRoleLabel();
    const permissionText = usePermissionText();
    const roleDescription = useRoleDescription();
    const [showAll, setShowAll] = useState(false);
    const byKey = useMemo(() => new Map(permissions.map(p => [p.key, p])), [permissions]);
    const lines = role.permissions.map(key => ({
        key,
        text: isPermission(key) ? permissionText(key) : (byKey.get(key)?.description ?? key),
    }));
    const description = isBuiltinRole(role.slug)
        ? roleDescription(role.slug)
        : (role.description ?? "");
    const visible = showAll ? lines : lines.slice(0, 4);

    return (
        <Panel className="flex flex-col p-4">
            <div className="flex items-start gap-3">
                <span className="bg-brand-soft text-brand flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink text-sm font-semibold">
                            {roleLabel(role.slug, role.name)}
                        </span>
                        {role.builtin && <Badge variant="outline">{t("builtin")}</Badge>}
                        <Badge variant="secondary">
                            {t("members", { count: role.memberCount })}
                        </Badge>
                    </div>
                    {description && (
                        <p className="text-ink-3 m-0 mt-0.5 text-[12.5px] leading-normal">
                            {description}
                        </p>
                    )}
                </div>
                {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
            </div>
            <ul className="text-ink-2 m-0 mt-3 list-none p-0 text-[12.5px] leading-relaxed">
                {lines.length === 0 && <li className="text-ink-3">{t("noPermissions")}</li>}
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
                    {showAll ? t("showFewer") : t("showAll", { count: lines.length })}
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
    const t = useTranslations("settings.people.roles.dialog");
    const tc = useTranslations("common");
    const errorText = useErrorText();
    const permissionText = usePermissionText();
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
            setError(t("nameRequired"));
            return;
        }
        if (selected.size === 0) {
            setError(t("pickPermission"));
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
            toast.success(
                isNew ? t("createdToast", { name: trimmed }) : t("savedToast", { name: trimmed })
            );
            onSaved();
        } catch (err) {
            setError(errorText(err, t("saveFailed")));
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
                            {isNew
                                ? t("newTitle")
                                : t("editTitle", { name: role?.name ?? t("roleFallback") })}
                        </DialogTitle>
                        <DialogDescription>{t("description")}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="role-name">{tc("fields.name")}</Label>
                            <Input
                                id="role-name"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={t("namePlaceholder")}
                                autoFocus
                                disabled={busy}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="role-description">
                                {t.rich("descriptionLabel", {
                                    optional: chunks => (
                                        <span className="text-ink-3 font-normal">{chunks}</span>
                                    ),
                                })}
                            </Label>
                            <Textarea
                                id="role-description"
                                rows={1}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder={t("descriptionPlaceholder")}
                                disabled={busy}
                            />
                        </div>
                    </div>

                    <fieldset className="m-0 border-0 p-0">
                        <legend className="text-ink-2 mb-2 text-xs font-semibold">
                            {t("permissions")}
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
                                                        {t("ownerOnly")}
                                                    </span>
                                                )}
                                                {!p.ownerOnly && !heldByViewer && (
                                                    <span className="text-ink-3 ml-2 font-normal">
                                                        {t("notYours")}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-ink-3 block text-[12.5px] leading-normal">
                                                {isPermission(key)
                                                    ? permissionText(key)
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
                            {tc("actions.cancel")}
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {busy ? tc("status.saving") : isNew ? t("create") : t("save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
