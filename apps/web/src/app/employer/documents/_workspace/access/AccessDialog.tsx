"use client";

/**
 * Who can see a folder or a document.
 *
 * One component for both: the only differences are the wording of the
 * visibility choice and which endpoint it talks to. Read-only when the server
 * says the viewer may not change it — they still see who has access.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, User, Users, X } from "lucide-react";
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
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { GRANT_LEVELS, isGrantLevel, type GrantLevel } from "~/lib/authz/permissions";

import { errorMessage, peopleApi, type Grant, type GrantInput } from "../settings/people/api";
import { LEVEL_LABELS, audienceSummary, type AudienceGrant } from "./audience";
import { PrincipalPicker, principalKey, type PickedPrincipal } from "./PrincipalPicker";

export type AccessTarget =
    | { kind: "folder"; id: number; name: string }
    | { kind: "document"; id: number; name: string };

/** Category ids look like `cat-<n>` when the folder is stored; anything else has no row yet. */
export function folderCategoryId(folder: { id: string }): number | null {
    if (!folder.id.startsWith("cat-")) return null;
    const n = Number(folder.id.slice("cat-".length));
    return Number.isInteger(n) && n > 0 ? n : null;
}

interface LocalGrant extends AudienceGrant {
    principalName: string;
}

interface SavedState {
    restricted: boolean;
    grants: LocalGrant[];
    audienceCount: number;
    canManage: boolean;
}

function toLocal(grant: Grant): LocalGrant {
    return {
        principalType: grant.principalType,
        principalId: grant.principalId,
        principalName: grant.principalName,
        level: grant.level,
    };
}

function sameGrants(a: readonly LocalGrant[], b: readonly LocalGrant[]): boolean {
    if (a.length !== b.length) return false;
    const key = (g: LocalGrant) => `${principalKey(g.principalType, g.principalId)}=${g.level}`;
    const set = new Set(a.map(key));
    return b.every(g => set.has(key(g)));
}

const TYPE_ICON = { user: User, group: Users, role: ShieldCheck } as const;
const TYPE_LABEL = { user: "Person", group: "Group", role: "Role" } as const;

export function AccessDialog({
    target,
    onClose,
    onSaved,
}: {
    target: AccessTarget | null;
    onClose: () => void;
    /** Fires after a successful save so the list can refetch its lock glyphs. */
    onSaved?: () => void;
}) {
    const open = target !== null;
    const [saved, setSaved] = useState<SavedState | null>(null);
    const [restricted, setRestricted] = useState(false);
    const [grants, setGrants] = useState<LocalGrant[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!target) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSaved(null);
        setGrants([]);
        void (async () => {
            try {
                const res =
                    target.kind === "folder"
                        ? await peopleApi.access.folder(target.id)
                        : await peopleApi.access.document(target.id);
                if (cancelled) return;
                const isRestricted =
                    "visibility" in res ? res.visibility === "restricted" : res.restricted;
                const local = res.grants.map(toLocal);
                setSaved({
                    restricted: isRestricted,
                    grants: local,
                    audienceCount: res.audienceCount,
                    canManage: res.canManage,
                });
                setRestricted(isRestricted);
                setGrants(local);
            } catch (err) {
                if (!cancelled) setError(errorMessage(err, "Could not load who has access."));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [target]);

    const canManage = saved?.canManage ?? false;
    const dirty = useMemo(
        () =>
            saved !== null &&
            (restricted !== saved.restricted || !sameGrants(grants, saved.grants)),
        [saved, restricted, grants]
    );

    const excluded = useMemo(
        () => new Set(grants.map(g => principalKey(g.principalType, g.principalId))),
        [grants]
    );

    const addGrant = (p: PickedPrincipal) => {
        setGrants(prev => [...prev, { ...p, level: "view" }]);
    };

    const setLevel = (index: number, level: GrantLevel) => {
        setGrants(prev => prev.map((g, i) => (i === index ? { ...g, level } : g)));
    };

    const removeGrant = (index: number) => {
        setGrants(prev => prev.filter((_, i) => i !== index));
    };

    const save = async () => {
        if (!target || !saved) return;
        setSaving(true);
        setError(null);
        const body: GrantInput[] = grants.map(g => ({
            principalType: g.principalType,
            principalId: g.principalId,
            level: g.level,
        }));
        try {
            if (target.kind === "folder") {
                await peopleApi.access.saveFolder(target.id, {
                    visibility: restricted ? "restricted" : "workspace",
                    grants: body,
                });
            } else {
                await peopleApi.access.saveDocument(target.id, { restricted, grants: body });
            }
            toast.success(
                restricted
                    ? `Access to “${target.name}” updated`
                    : `“${target.name}” is visible to the workspace`
            );
            onSaved?.();
            onClose();
        } catch (err) {
            setError(errorMessage(err, "The change wasn't saved."));
        } finally {
            setSaving(false);
        }
    };

    const kind = target?.kind ?? "folder";
    const summary = audienceSummary({
        kind,
        restricted,
        grants,
        audienceCount: saved?.audienceCount ?? null,
        dirty,
    });

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next && !saving) onClose();
            }}
        >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {kind === "folder" ? "Share folder" : "Restrict access"}
                    </DialogTitle>
                    <DialogDescription>
                        {kind === "folder"
                            ? `Who can open “${target?.name ?? ""}” and everything filed in it.`
                            : `Who can open “${target?.name ?? ""}”, beyond the folder it sits in.`}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="text-ink-3 m-0 text-sm" role="status">
                        Loading who has access…
                    </p>
                ) : (
                    <div className="flex flex-col gap-5">
                        {saved && !canManage && (
                            <p className="bg-panel-2 text-ink-2 m-0 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed">
                                You can see who has access but not change it. That takes
                                {kind === "folder"
                                    ? " “manage” on this folder, or the folders permission."
                                    : " “manage” on this document or its folder."}
                            </p>
                        )}

                        <fieldset className="m-0 border-0 p-0" disabled={!canManage || saving}>
                            <legend className="text-ink-2 mb-2 text-xs font-semibold">
                                Visibility
                            </legend>
                            <RadioGroup
                                value={restricted ? "restricted" : "everyone"}
                                onValueChange={value => setRestricted(value === "restricted")}
                            >
                                <label
                                    htmlFor="access-everyone"
                                    className="border-line hover:bg-panel-2 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
                                >
                                    <RadioGroupItem
                                        id="access-everyone"
                                        value="everyone"
                                        className="mt-0.5"
                                    />
                                    <span>
                                        <span className="text-ink block text-[13px] font-semibold">
                                            {kind === "folder"
                                                ? "Everyone in the workspace"
                                                : "Everyone who can see its folder"}
                                        </span>
                                        <span className="text-ink-3 block text-[12.5px] leading-normal">
                                            {kind === "folder"
                                                ? "Any member can open it. The list below only adds edit or manage rights."
                                                : "Inherits the folder's audience. The list below only adds edit or manage rights."}
                                        </span>
                                    </span>
                                </label>
                                <label
                                    htmlFor="access-restricted"
                                    className="border-line hover:bg-panel-2 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
                                >
                                    <RadioGroupItem
                                        id="access-restricted"
                                        value="restricted"
                                        className="mt-0.5"
                                    />
                                    <span>
                                        <span className="text-ink block text-[13px] font-semibold">
                                            Only people added below
                                        </span>
                                        <span className="text-ink-3 block text-[12.5px] leading-normal">
                                            Owners and admins always keep access. Everyone else
                                            needs to be listed, directly or through a group or role.
                                        </span>
                                    </span>
                                </label>
                            </RadioGroup>
                        </fieldset>

                        <div className="flex flex-col gap-2">
                            <Label>Who has access</Label>
                            <PrincipalPicker
                                exclude={excluded}
                                disabled={!canManage || saving}
                                onPick={addGrant}
                            />
                            {grants.length === 0 ? (
                                <p className="text-ink-3 m-0 py-1 text-[12.5px]">
                                    {restricted
                                        ? "No one has been added yet — only owners and admins can see this."
                                        : "No extra grants. Add someone to give them edit or manage rights."}
                                </p>
                            ) : (
                                <ul className="border-line m-0 list-none divide-y rounded-lg border p-0">
                                    {grants.map((g, index) => {
                                        const Icon = TYPE_ICON[g.principalType];
                                        return (
                                            <li
                                                key={principalKey(g.principalType, g.principalId)}
                                                className="flex items-center gap-3 px-3 py-2"
                                            >
                                                <Icon className="text-ink-3 h-4 w-4 shrink-0" />
                                                <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                                    {g.principalName}
                                                </span>
                                                <Badge variant="secondary">
                                                    {TYPE_LABEL[g.principalType]}
                                                </Badge>
                                                <Select
                                                    value={g.level}
                                                    onValueChange={value => {
                                                        if (isGrantLevel(value))
                                                            setLevel(index, value);
                                                    }}
                                                    disabled={!canManage || saving}
                                                >
                                                    <SelectTrigger
                                                        size="sm"
                                                        className="w-[130px]"
                                                        aria-label={`Access level for ${g.principalName}`}
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {GRANT_LEVELS.map(level => (
                                                            <SelectItem key={level} value={level}>
                                                                {LEVEL_LABELS[level]}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    disabled={!canManage || saving}
                                                    aria-label={`Remove ${g.principalName}`}
                                                    onClick={() => removeGrant(index)}
                                                >
                                                    <X />
                                                </Button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <p
                            className="text-ink-2 m-0 text-[12.5px] leading-normal"
                            aria-live="polite"
                        >
                            {summary}
                        </p>

                        {error && (
                            <p role="alert" className="text-danger m-0 text-[12.5px]">
                                {error}
                            </p>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        {canManage ? "Cancel" : "Close"}
                    </Button>
                    {canManage && (
                        <Button onClick={() => void save()} disabled={!dirty || saving || loading}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
