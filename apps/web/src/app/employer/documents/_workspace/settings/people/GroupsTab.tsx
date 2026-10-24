"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
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
import { Textarea } from "~/components/ui/textarea";
import type { Permission } from "~/lib/authz/permissions";
import { usePermissions } from "~/lib/use-permissions";

import { mayCreateGroups } from "../../team/rules";
import { peopleApi, type Group, type Member } from "./api";
import {
    ConfirmDialog,
    EmptyState,
    ErrorNote,
    LoadingNote,
    Panel,
    TabIntro,
    useErrorText,
} from "./ui";

interface GroupsTabProps {
    can: (permission: Permission | undefined) => boolean;
}

export function GroupsTab({ can }: GroupsTabProps) {
    const t = useTranslations("settings.people.groups");
    const errorText = useErrorText();
    // Members create groups and manage the ones they made; `groups.manage`
    // manages all of them (ADR-014). The server says per group (`canManage`).
    const canManageAll = can("groups.manage");
    const { role } = usePermissions();
    const canCreate = mayCreateGroups(can, role);

    const [groups, setGroups] = useState<Group[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
    const [editing, setEditing] = useState<Group | "new" | null>(null);
    const [deleting, setDeleting] = useState<Group | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const [gr, mem] = await Promise.all([
                peopleApi.groups.list(),
                peopleApi.members.list().catch(() => ({ members: [] as Member[] })),
            ]);
            setGroups(gr.groups);
            setMembers(mem.members.filter(m => m.status === "active"));
        } catch (err) {
            setError(errorText(err, t("loadFailed")));
        } finally {
            setLoading(false);
        }
    }, [errorText, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const replaceGroup = (group: Group) =>
        setGroups(prev => prev.map(g => (g.id === group.id ? group : g)));

    const remove = async () => {
        if (!deleting) return;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            const res = await peopleApi.groups.remove(deleting.id);
            toast.success(
                res.removedGrants > 0
                    ? t("deletedWithGrants", { name: deleting.name, count: res.removedGrants })
                    : t("deleted", { name: deleting.name })
            );
            setDeleting(null);
            await load();
        } catch (err) {
            setDeleteError(errorText(err, t("deleteFailed")));
        } finally {
            setDeleteBusy(false);
        }
    };

    const toggle = (id: number) =>
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <div>
            <TabIntro
                title={t("intro.title")}
                description={t("intro.description")}
                actions={
                    canCreate ? (
                        <Button size="sm" onClick={() => setEditing("new")}>
                            <Plus /> {t("newGroup")}
                        </Button>
                    ) : undefined
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
                ) : groups.length === 0 ? (
                    <EmptyState
                        title={t("empty.title")}
                        body={canCreate ? t("empty.bodyCreate") : t("empty.bodyView")}
                        action={
                            canCreate ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditing("new")}
                                >
                                    <Plus /> {t("newGroup")}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <ul className="m-0 list-none p-0">
                        {groups.map(group => (
                            <GroupRow
                                key={group.id}
                                group={group}
                                members={members}
                                canManage={group.canManage ?? canManageAll}
                                expanded={expanded.has(group.id)}
                                onToggle={() => toggle(group.id)}
                                onRename={() => setEditing(group)}
                                onDelete={() => {
                                    setDeleteError(null);
                                    setDeleting(group);
                                }}
                                onChanged={replaceGroup}
                            />
                        ))}
                    </ul>
                )}
            </Panel>

            <GroupDialog
                group={editing}
                onClose={() => setEditing(null)}
                onSaved={group => {
                    if (editing === "new") setGroups(prev => [...prev, group]);
                    else replaceGroup(group);
                    setEditing(null);
                }}
            />

            <ConfirmDialog
                open={deleting !== null}
                title={t("confirm.title", { name: deleting?.name ?? t("confirm.thisGroup") })}
                body={t("confirm.body", { count: deleting?.memberCount ?? 0 })}
                confirmLabel={t("confirm.confirm")}
                danger
                busy={deleteBusy}
                error={deleteError}
                onConfirm={() => void remove()}
                onClose={() => setDeleting(null)}
            />
        </div>
    );
}

function GroupRow({
    group,
    members,
    canManage,
    expanded,
    onToggle,
    onRename,
    onDelete,
    onChanged,
}: {
    group: Group;
    members: Member[];
    canManage: boolean;
    expanded: boolean;
    onToggle: () => void;
    onRename: () => void;
    onDelete: () => void;
    onChanged: (group: Group) => void;
}) {
    const t = useTranslations("settings.people.groups");
    const tc = useTranslations("common");
    const errorText = useErrorText();
    const [adding, setAdding] = useState<string>("");
    const [busy, setBusy] = useState(false);

    const candidates = useMemo(() => {
        const inGroup = new Set(group.members.map(m => m.id));
        return members.filter(m => !inGroup.has(m.id));
    }, [group.members, members]);

    const add = async () => {
        const id = Number(adding);
        if (!Number.isFinite(id) || id <= 0) return;
        setBusy(true);
        try {
            const res = await peopleApi.groups.addMembers(group.id, [id]);
            onChanged(res.group);
            setAdding("");
            const person = members.find(m => m.id === id);
            toast.success(
                t("row.added", { name: person?.name ?? t("row.memberFallback"), group: group.name })
            );
        } catch (err) {
            toast.error(errorText(err, t("row.addFailed")));
        } finally {
            setBusy(false);
        }
    };

    const removeMember = async (memberId: number, name: string) => {
        setBusy(true);
        try {
            const res = await peopleApi.groups.removeMembers(group.id, [memberId]);
            onChanged(res.group);
            toast.success(t("row.removed", { name, group: group.name }));
        } catch (err) {
            toast.error(errorText(err, t("row.removeFailed")));
        } finally {
            setBusy(false);
        }
    };

    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <li className="border-line border-b last:border-b-0">
            <div className="flex items-center gap-3 px-4 py-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    aria-controls={`group-${group.id}-members`}
                    className="text-ink hover:bg-panel-2 focus-visible:ring-brand/50 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-[3px]"
                >
                    <Chevron className="text-ink-3 h-4 w-4 shrink-0" />
                    <span className="truncate text-sm font-semibold">{group.name}</span>
                    <Badge variant="secondary">
                        {t("row.members", { count: group.memberCount })}
                    </Badge>
                    {group.description && (
                        <span className="text-ink-3 hidden truncate text-[12.5px] sm:inline">
                            {group.description}
                        </span>
                    )}
                </button>
                {canManage && (
                    <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={onRename}>
                            {tc("actions.rename")}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                            onClick={onDelete}
                        >
                            {tc("actions.delete")}
                        </Button>
                    </div>
                )}
            </div>

            {expanded && (
                <div id={`group-${group.id}-members`} className="bg-panel-2/40 px-4 pb-4 pt-1">
                    {group.members.length === 0 ? (
                        <p className="text-ink-3 m-0 py-2 text-[13px]">{t("row.empty")}</p>
                    ) : (
                        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 py-2">
                            {group.members.map(m => (
                                <li
                                    key={m.id}
                                    className="border-line bg-panel text-ink-2 flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1 text-[12.5px]"
                                >
                                    <span title={m.email}>{m.name || m.email}</span>
                                    {canManage && (
                                        <button
                                            type="button"
                                            aria-label={t("row.removeFrom", {
                                                name: m.name || m.email,
                                                group: group.name,
                                            })}
                                            disabled={busy}
                                            onClick={() =>
                                                void removeMember(m.id, m.name || m.email)
                                            }
                                            className="text-ink-3 hover:text-danger focus-visible:ring-brand/50 rounded-full p-0.5 outline-none focus-visible:ring-[3px] disabled:opacity-50"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {canManage && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Select value={adding} onValueChange={setAdding} disabled={busy}>
                                <SelectTrigger
                                    size="sm"
                                    className="w-[260px]"
                                    aria-label={t("row.addTo", { group: group.name })}
                                >
                                    <SelectValue
                                        placeholder={
                                            candidates.length === 0
                                                ? t("row.everyoneIn")
                                                : t("row.addPlaceholder")
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {candidates.map(m => (
                                        <SelectItem key={m.id} value={String(m.id)}>
                                            {m.name || m.email}
                                            <span className="text-ink-3"> · {m.email}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!adding || busy}
                                onClick={() => void add()}
                            >
                                {t("row.addButton")}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

/** New group, or rename one. Shared with the Team tab's Groups view. */
export function GroupDialog({
    group,
    onClose,
    onSaved,
}: {
    group: Group | "new" | null;
    onClose: () => void;
    onSaved: (group: Group) => void;
}) {
    const t = useTranslations("settings.people.groups.dialog");
    const tc = useTranslations("common");
    const errorText = useErrorText();
    const open = group !== null;
    const isNew = group === "new";
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(isNew ? "" : (group?.name ?? ""));
        setDescription(isNew ? "" : (group?.description ?? ""));
        setError(null);
    }, [open, isNew, group]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError(t("nameRequired"));
            return;
        }
        if (group === null) return;
        setBusy(true);
        setError(null);
        try {
            const body = { name: trimmed, description: description.trim() || undefined };
            const res =
                group === "new"
                    ? await peopleApi.groups.create(body)
                    : await peopleApi.groups.update(group.id, body);
            toast.success(
                isNew ? t("createdToast", { name: trimmed }) : t("renamedToast", { name: trimmed })
            );
            onSaved(res.group);
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
            <DialogContent>
                <form onSubmit={e => void save(e)} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>{isNew ? t("newTitle") : t("renameTitle")}</DialogTitle>
                        <DialogDescription>
                            {isNew ? t("newDescription") : t("renameDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="group-name">{tc("fields.name")}</Label>
                        <Input
                            id="group-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={t("namePlaceholder")}
                            autoFocus
                            disabled={busy}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="group-description">
                            {t.rich("description", {
                                optional: chunks => (
                                    <span className="text-ink-3 font-normal">{chunks}</span>
                                ),
                            })}
                        </Label>
                        <Textarea
                            id="group-description"
                            rows={2}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder={t("descriptionPlaceholder")}
                            disabled={busy}
                        />
                    </div>
                    {error && <ErrorNote message={error} />}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                            {tc("actions.cancel")}
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {busy ? tc("status.saving") : isNew ? t("create") : t("saveName")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
