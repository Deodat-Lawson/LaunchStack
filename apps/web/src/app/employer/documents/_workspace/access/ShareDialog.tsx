"use client";

/**
 * Share — one dialog for folders, files and chats (ADR-014).
 *
 * Shaped like Drive's: add people or groups at the top, the people who have
 * access with a level each, then one "General access" choice — only the
 * people listed, or everyone (the workspace, or "same as <folder>" for
 * something nested). A folder or file someone just made starts as "only
 * you"; sharing it is adding a name or flipping General access.
 *
 * Each kind of thing has an adapter (load / save) so the dialog never
 * branches on endpoints; chats only offer "Can view".
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CornerDownRight, Lock, ShieldCheck, Users, X } from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "~/components/ProfileAvatar";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { isGrantLevel, type GrantLevel, type PrincipalType } from "~/lib/authz/permissions";
import { folderLeafName } from "~/lib/folders/path";
import { usePeople } from "~/lib/profile/use-people";

import { errorMessage, peopleApi, type Grant, type OwnerRef } from "../settings/people/api";
import { LEVEL_LABELS } from "./audience";
import { chatShareAdapter } from "./chatShareAdapter";
import { PrincipalPicker, principalKey, type PickedPrincipal } from "./PrincipalPicker";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type ShareTarget =
    /** Folders are paths; one that exists only through its contents is stored on save. */
    | { kind: "folder"; path: string; name: string }
    | { kind: "document"; id: number; name: string }
    | { kind: "chat"; id: string; name: string };

export interface ShareGrant {
    principalType: PrincipalType;
    principalId: string;
    principalName: string;
    level: GrantLevel;
    authUserId?: string | null;
}

/** `restricted` — only the people listed; `open` — everyone (or the folder above). */
export type GeneralAccess = "restricted" | "open";

export interface ShareState {
    general: GeneralAccess;
    grants: ShareGrant[];
    canManage: boolean;
    /** What "open" means here. */
    open: { kind: "workspace" | "inherit"; label: string; hint: string };
    /** Levels a grant may take; chats are view-only. */
    levels: readonly GrantLevel[];
    owner: OwnerRef | null;
    /** People who can open it under the saved state, when the server knows. */
    audienceCount: number | null;
}

export interface ShareAdapter {
    load(target: ShareTarget): Promise<ShareState>;
    save(
        target: ShareTarget,
        next: { general: GeneralAccess; grants: ShareGrant[] }
    ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapters for folders and documents
// ---------------------------------------------------------------------------

function toShareGrant(grant: Grant): ShareGrant {
    return {
        principalType: grant.principalType,
        principalId: grant.principalId,
        principalName: grant.principalName,
        level: grant.level,
        authUserId: grant.authUserId ?? null,
    };
}

function openFor(
    inherits: { path: string | null; restricted: boolean },
    workspaceName: string
): ShareState["open"] {
    if (inherits.restricted && inherits.path) {
        const name = folderLeafName(inherits.path);
        return {
            kind: "inherit",
            label: `Same as ${name}`,
            hint: `Whoever can open ${name} can open this.`,
        };
    }
    return {
        kind: "workspace",
        label: `Everyone at ${workspaceName}`,
        hint: `Anyone in ${workspaceName} can open it.`,
    };
}

const FULL_LEVELS = ["view", "edit", "manage"] as const satisfies readonly GrantLevel[];

const toInput = (grants: readonly ShareGrant[]) =>
    grants.map(g => ({
        principalType: g.principalType,
        principalId: g.principalId,
        level: g.level,
    }));

export const folderShareAdapter: ShareAdapter = {
    async load(target) {
        if (target.kind !== "folder") throw new Error("Not a folder");
        const res = await peopleApi.access.folderByPath(target.path);
        return {
            general: res.visibility === "restricted" ? "restricted" : "open",
            grants: res.grants.map(toShareGrant),
            canManage: res.canManage,
            open: openFor(res.inheritsFrom, res.workspaceName),
            levels: FULL_LEVELS,
            owner: res.owner,
            audienceCount: res.audienceCount,
        };
    },
    async save(target, next) {
        if (target.kind !== "folder") throw new Error("Not a folder");
        await peopleApi.access.saveFolderByPath(target.path, {
            visibility: next.general === "restricted" ? "restricted" : "workspace",
            grants: toInput(next.grants),
        });
    },
};

export const documentShareAdapter: ShareAdapter = {
    async load(target) {
        if (target.kind !== "document") throw new Error("Not a document");
        const res = await peopleApi.access.document(target.id);
        const inherits = res.inheritsFrom;
        const open =
            inherits.folder && !inherits.restricted
                ? {
                      kind: "inherit" as const,
                      label: `Same as ${folderLeafName(inherits.folder)}`,
                      hint: `Everyone at ${res.workspaceName} can open ${folderLeafName(inherits.folder)}.`,
                  }
                : openFor(inherits, res.workspaceName);
        return {
            general: res.restricted ? "restricted" : "open",
            grants: res.grants.map(toShareGrant),
            canManage: res.canManage,
            open,
            levels: FULL_LEVELS,
            owner: res.owner,
            audienceCount: res.audienceCount,
        };
    },
    async save(target, next) {
        if (target.kind !== "document") throw new Error("Not a document");
        await peopleApi.access.saveDocument(target.id, {
            restricted: next.general === "restricted",
            grants: toInput(next.grants),
        });
    },
};

const ADAPTERS: Record<ShareTarget["kind"], ShareAdapter> = {
    folder: folderShareAdapter,
    document: documentShareAdapter,
    chat: chatShareAdapter,
};

// ---------------------------------------------------------------------------
// Pure helpers (pinned by tests)
// ---------------------------------------------------------------------------

function sameGrants(a: readonly ShareGrant[], b: readonly ShareGrant[]): boolean {
    if (a.length !== b.length) return false;
    const key = (g: ShareGrant) => `${principalKey(g.principalType, g.principalId)}=${g.level}`;
    const set = new Set(a.map(key));
    return b.every(g => set.has(key(g)));
}

/** The one line under General access that says who will be able to open it. */
export function shareSummary(input: {
    general: GeneralAccess;
    grants: readonly ShareGrant[];
    open: ShareState["open"];
    /** The viewer's auth subject id. */
    selfAuthId: string | null;
    audienceCount: number | null;
    dirty: boolean;
}): string {
    if (input.general === "open") {
        if (input.audienceCount !== null && !input.dirty) {
            const n = input.audienceCount;
            return `${input.open.hint} (${n} ${n === 1 ? "person" : "people"})`;
        }
        return input.open.hint;
    }
    const isSelf = (g: ShareGrant) =>
        g.principalType === "user" && Boolean(g.authUserId) && g.authUserId === input.selfAuthId;
    const others = input.grants.filter(g => !isSelf(g));
    if (others.length === 0) return "Only you can open it.";
    const people = others.filter(g => g.principalType === "user").length;
    const groups = others.filter(g => g.principalType === "group").length;
    const roles = others.filter(g => g.principalType === "role").length;
    const parts: string[] = [];
    if (people > 0) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
    if (groups > 0) parts.push(`${groups} ${groups === 1 ? "group" : "groups"}`);
    if (roles > 0) parts.push(`${roles} ${roles === 1 ? "role" : "roles"}`);
    const listed = input.grants.some(isSelf);
    return `${listed ? "You and " : ""}${parts.join(", ")} can open it.`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TYPE_LABEL = { user: "Person", group: "Group", role: "Role" } as const;

export function ShareDialog({
    target,
    onClose,
    onSaved,
    selfAuthId = null,
    adapter,
}: {
    target: ShareTarget | null;
    onClose: () => void;
    /** Fires after a successful save so lists can refetch their badges. */
    onSaved?: () => void;
    /** The viewer's auth subject id, to label their own row "you". */
    selfAuthId?: string | null;
    /** Override the adapter for `target.kind` (tests, harnesses). */
    adapter?: ShareAdapter;
}) {
    const open = target !== null;
    const [saved, setSaved] = useState<ShareState | null>(null);
    const [general, setGeneral] = useState<GeneralAccess>("restricted");
    const [grants, setGrants] = useState<ShareGrant[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [groupDraft, setGroupDraft] = useState<string | null>(null);
    const [creatingGroup, setCreatingGroup] = useState(false);

    const use = useMemo(
        () => adapter ?? (target ? ADAPTERS[target.kind] : null),
        [adapter, target]
    );

    useEffect(() => {
        if (!target || !use) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSaved(null);
        setGrants([]);
        setGroupDraft(null);
        void (async () => {
            try {
                const state = await use.load(target);
                if (cancelled) return;
                setSaved(state);
                setGeneral(state.general);
                setGrants(state.grants);
            } catch (err) {
                if (!cancelled) setError(errorMessage(err, "Could not load who has access."));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [target, use]);

    const canManage = saved?.canManage ?? false;
    const levels = saved?.levels ?? FULL_LEVELS;
    const dirty =
        saved !== null && (general !== saved.general || !sameGrants(grants, saved.grants));
    const excluded = useMemo(
        () => new Set(grants.map(g => principalKey(g.principalType, g.principalId))),
        [grants]
    );

    const authIds = useMemo(
        () =>
            [...grants.map(g => g.authUserId ?? null), saved?.owner?.authUserId ?? null].filter(
                (id): id is string => Boolean(id)
            ),
        [grants, saved]
    );
    const people = usePeople(authIds);

    const addGrant = useCallback(
        (p: PickedPrincipal) => {
            setGrants(prev => [...prev, { ...p, level: levels[0] ?? "view" }]);
        },
        [levels]
    );

    const setLevel = (key: string, level: GrantLevel) =>
        setGrants(prev =>
            prev.map(g =>
                principalKey(g.principalType, g.principalId) === key ? { ...g, level } : g
            )
        );
    const removeGrant = (key: string) =>
        setGrants(prev => prev.filter(g => principalKey(g.principalType, g.principalId) !== key));

    const listedPeople = grants.filter(
        g => g.principalType === "user" && !(g.authUserId && g.authUserId === selfAuthId)
    );

    /** "Teams as share targets": turn the people listed into a group, and share with the group. */
    const createGroup = async () => {
        const name = (groupDraft ?? "").trim();
        if (!name) return;
        setCreatingGroup(true);
        setError(null);
        try {
            const { group } = await peopleApi.groups.create({ name });
            const memberIds = listedPeople.map(g => Number(g.principalId));
            if (memberIds.length > 0) await peopleApi.groups.addMembers(group.id, memberIds);
            const moved = new Set(listedPeople.map(g => principalKey("user", g.principalId)));
            const level =
                listedPeople
                    .map(g => g.level)
                    .sort((a, b) => levels.indexOf(b) - levels.indexOf(a))[0] ??
                levels[0] ??
                "view";
            setGrants(prev => [
                ...prev.filter(g => !moved.has(principalKey(g.principalType, g.principalId))),
                {
                    principalType: "group",
                    principalId: String(group.id),
                    principalName: group.name,
                    level,
                },
            ]);
            setGroupDraft(null);
            toast.success(
                memberIds.length > 0
                    ? `Created “${group.name}” with ${memberIds.length} ${memberIds.length === 1 ? "person" : "people"}`
                    : `Created “${group.name}” — add people in Team › Groups`
            );
        } catch (err) {
            setError(errorMessage(err, "The group wasn't created."));
        } finally {
            setCreatingGroup(false);
        }
    };

    const save = async () => {
        if (!target || !saved || !use) return;
        setSaving(true);
        setError(null);
        try {
            await use.save(target, { general, grants });
            toast.success(
                general === "open"
                    ? `“${target.name}” — ${saved.open.label.toLowerCase()}`
                    : `Sharing for “${target.name}” updated`
            );
            onSaved?.();
            onClose();
        } catch (err) {
            setError(errorMessage(err, "The change wasn't saved."));
        } finally {
            setSaving(false);
        }
    };

    const summary = saved
        ? shareSummary({
              general,
              grants,
              open: saved.open,
              selfAuthId,
              audienceCount: saved.audienceCount,
              dirty,
          })
        : "";

    const ownerLook = saved?.owner ? people[saved.owner.authUserId] : undefined;
    const ownerName = ownerLook?.displayName ?? saved?.owner?.name ?? null;
    const OpenIcon = saved?.open.kind === "inherit" ? CornerDownRight : Building2;

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next && !saving) onClose();
            }}
        >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="truncate pr-6">
                        Share “{target?.name ?? ""}”
                    </DialogTitle>
                    <DialogDescription>
                        {target?.kind === "folder"
                            ? "Everything inside follows the folder unless it has its own sharing."
                            : target?.kind === "chat"
                              ? "People you add can read this chat and continue it as their own."
                              : "Who can open this file."}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="text-ink-3 m-0 text-sm" role="status">
                        Loading who has access…
                    </p>
                ) : (
                    <div className="flex flex-col gap-4">
                        {saved && !canManage && (
                            <p className="bg-panel-2 text-ink-2 m-0 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed">
                                You can see who has access but not change it. Ask someone who can
                                manage it.
                            </p>
                        )}

                        {canManage && (
                            <div className="flex flex-col gap-2">
                                <PrincipalPicker
                                    exclude={excluded}
                                    disabled={saving}
                                    onPick={addGrant}
                                />
                                {groupDraft === null ? (
                                    <button
                                        type="button"
                                        className="text-ink-3 hover:text-ink self-start text-[12px] underline-offset-2 hover:underline"
                                        onClick={() => setGroupDraft("")}
                                    >
                                        {listedPeople.length > 1
                                            ? `Make a group of these ${listedPeople.length} people…`
                                            : "New group…"}
                                    </button>
                                ) : (
                                    <form
                                        className="flex items-center gap-2"
                                        onSubmit={e => {
                                            e.preventDefault();
                                            void createGroup();
                                        }}
                                    >
                                        <Users className="text-ink-3 h-4 w-4 shrink-0" />
                                        <Input
                                            autoFocus
                                            value={groupDraft}
                                            onChange={e => setGroupDraft(e.target.value)}
                                            placeholder="Group name, e.g. Sales team"
                                            aria-label="New group name"
                                            className="h-8"
                                            maxLength={80}
                                        />
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={creatingGroup || !groupDraft.trim()}
                                        >
                                            {creatingGroup ? "Creating…" : "Create"}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setGroupDraft(null)}
                                        >
                                            Cancel
                                        </Button>
                                    </form>
                                )}
                            </div>
                        )}

                        <section aria-label="People with access" className="flex flex-col gap-1.5">
                            <h3 className="text-ink-2 m-0 text-xs font-semibold">
                                People with access
                            </h3>
                            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                                {saved?.owner &&
                                    !grants.some(
                                        g =>
                                            g.principalType === "user" &&
                                            g.authUserId === saved.owner?.authUserId
                                    ) && (
                                        <li className="flex items-center gap-3 py-1.5">
                                            <ProfileAvatar
                                                name={ownerName}
                                                src={ownerLook?.avatarUrl ?? null}
                                                className="size-7"
                                                fallbackClassName="text-[10px]"
                                            />
                                            <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                                {ownerName}
                                            </span>
                                            <span className="text-ink-3 text-[12px]">Owner</span>
                                        </li>
                                    )}
                                {grants.map(g => {
                                    const key = principalKey(g.principalType, g.principalId);
                                    const look = g.authUserId ? people[g.authUserId] : undefined;
                                    const isSelf =
                                        g.principalType === "user" &&
                                        Boolean(g.authUserId) &&
                                        g.authUserId === selfAuthId;
                                    const isOwner =
                                        g.principalType === "user" &&
                                        Boolean(g.authUserId) &&
                                        g.authUserId === saved?.owner?.authUserId;
                                    const name = look?.displayName ?? g.principalName;
                                    return (
                                        <li key={key} className="flex items-center gap-3 py-1.5">
                                            {g.principalType === "user" ? (
                                                <ProfileAvatar
                                                    name={name}
                                                    src={look?.avatarUrl ?? null}
                                                    className="size-7"
                                                    fallbackClassName="text-[10px]"
                                                />
                                            ) : (
                                                <span className="bg-panel-2 text-ink-2 grid size-7 shrink-0 place-items-center rounded-full">
                                                    {g.principalType === "group" ? (
                                                        <Users className="h-3.5 w-3.5" />
                                                    ) : (
                                                        <ShieldCheck className="h-3.5 w-3.5" />
                                                    )}
                                                </span>
                                            )}
                                            <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                                {name}
                                                {isSelf && (
                                                    <span className="text-ink-3"> (you)</span>
                                                )}
                                            </span>
                                            {g.principalType !== "user" && (
                                                <Badge variant="secondary">
                                                    {TYPE_LABEL[g.principalType]}
                                                </Badge>
                                            )}
                                            {isOwner && g.level === "manage" ? (
                                                <span className="text-ink-3 w-[118px] text-right text-[12px]">
                                                    Owner
                                                </span>
                                            ) : (
                                                <Select
                                                    value={g.level}
                                                    onValueChange={value => {
                                                        if (isGrantLevel(value))
                                                            setLevel(key, value);
                                                    }}
                                                    disabled={
                                                        !canManage || saving || levels.length < 2
                                                    }
                                                >
                                                    <SelectTrigger
                                                        size="sm"
                                                        className="w-[118px]"
                                                        aria-label={`Access level for ${name}`}
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {levels.map(level => (
                                                            <SelectItem key={level} value={level}>
                                                                {LEVEL_LABELS[level]}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            {canManage && !(isOwner && g.level === "manage") ? (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={saving}
                                                    aria-label={`Remove ${name}`}
                                                    onClick={() => removeGrant(key)}
                                                >
                                                    <X />
                                                </Button>
                                            ) : (
                                                <span className="w-7" aria-hidden />
                                            )}
                                        </li>
                                    );
                                })}
                                {grants.length === 0 && !saved?.owner && (
                                    <li className="text-ink-3 py-1 text-[12.5px]">
                                        No one added yet.
                                    </li>
                                )}
                            </ul>
                        </section>

                        {saved && (
                            <section aria-label="General access" className="flex flex-col gap-1.5">
                                <h3 className="text-ink-2 m-0 text-xs font-semibold">
                                    General access
                                </h3>
                                <div className="flex items-start gap-3">
                                    <span
                                        className={
                                            general === "restricted"
                                                ? "bg-panel-2 text-ink-2 grid size-7 shrink-0 place-items-center rounded-full"
                                                : "bg-brand-soft text-brand-ink grid size-7 shrink-0 place-items-center rounded-full"
                                        }
                                    >
                                        {general === "restricted" ? (
                                            <Lock className="h-3.5 w-3.5" />
                                        ) : (
                                            <OpenIcon className="h-3.5 w-3.5" />
                                        )}
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <Select
                                            value={general}
                                            onValueChange={value =>
                                                setGeneral(value === "open" ? "open" : "restricted")
                                            }
                                            disabled={!canManage || saving}
                                        >
                                            <SelectTrigger
                                                size="sm"
                                                className="w-fit min-w-[200px]"
                                                aria-label="General access"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="restricted">
                                                    Only people with access
                                                </SelectItem>
                                                <SelectItem value="open">
                                                    {saved.open.label}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p
                                            className="text-ink-3 m-0 text-[12.5px] leading-normal"
                                            aria-live="polite"
                                        >
                                            {summary}
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {error && (
                            <p role="alert" className="text-danger m-0 text-[12.5px]">
                                {error}
                            </p>
                        )}
                    </div>
                )}

                <DialogFooter className="items-center sm:justify-between">
                    <span className="text-ink-3 truncate text-[12px]">
                        {ownerName ? `Added by ${ownerName}` : ""}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} disabled={saving}>
                            {canManage ? "Cancel" : "Close"}
                        </Button>
                        {canManage && (
                            <Button
                                onClick={() => void save()}
                                disabled={!dirty || saving || loading}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
