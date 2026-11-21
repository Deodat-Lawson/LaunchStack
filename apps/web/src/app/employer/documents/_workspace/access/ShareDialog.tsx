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

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    Bot,
    Building2,
    Copy,
    CornerDownRight,
    Globe,
    Lock,
    ShieldCheck,
    Users,
    X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
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
import { Switch } from "~/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useRoleLabel } from "~/lib/authz/i18n";
import { isGrantLevel, type GrantLevel, type PrincipalType } from "~/lib/authz/permissions";
import { folderLeafName } from "~/lib/folders/path";
import { usePeople } from "~/lib/profile/use-people";
import { PUBLIC_LINKS_SETTING } from "~/lib/settings/registry";
import { workspaceHref } from "~/lib/settings/surfaces";

import {
    errorMessage,
    isApiError,
    peopleApi,
    type Grant,
    type OwnerRef,
    type PublicLinkExpiryDays,
    type PublicLinkInput,
    type PublicLinkState,
} from "../settings/people/api";
import type { AccessTranslator } from "./audience";
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
    /** What "open" means here; worded by `shareOpenLabel` / `shareOpenHint`. */
    open: ShareOpen;
    /** Levels a grant may take; chats are view-only. */
    levels: readonly GrantLevel[];
    owner: OwnerRef | null;
    /** People who can open it under the saved state, when the server knows. */
    audienceCount: number | null;
}

/**
 * What General access "open" means for a thing:
 * - `workspace` — everyone in the workspace (`read` for a chat, `open` for the rest);
 * - `inherit` — it follows the folder above. With `workspaceName`, that folder
 *   is itself open to the workspace; without, it is restricted and whoever
 *   can open it can open this ("…, plus 1 person").
 */
export type ShareOpen =
    | { kind: "workspace"; workspaceName: string; verb: "open" | "read" }
    | { kind: "inherit"; folder: string; workspaceName?: string };

/** "Everyone at Acme" / "Same as Q4" — the General access option. */
export function shareOpenLabel(t: AccessTranslator, open: ShareOpen): string {
    return open.kind === "workspace"
        ? t("share.open.everyoneAt", { workspace: open.workspaceName })
        : t("share.open.sameAs", { folder: open.folder });
}

/** "Anyone in Acme can open it." — what the option means. */
export function shareOpenHint(t: AccessTranslator, open: ShareOpen): string {
    if (open.kind === "workspace") {
        return open.verb === "read"
            ? t("share.open.hintRead", { workspace: open.workspaceName })
            : t("share.open.hintOpen", { workspace: open.workspaceName });
    }
    return open.workspaceName
        ? t("share.open.hintFolderOpen", { workspace: open.workspaceName, folder: open.folder })
        : t("share.open.hintInherit", { folder: open.folder });
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
): ShareOpen {
    if (inherits.restricted && inherits.path) {
        return { kind: "inherit", folder: folderLeafName(inherits.path) };
    }
    return { kind: "workspace", workspaceName, verb: "open" };
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
        const open: ShareOpen =
            inherits.folder && !inherits.restricted
                ? {
                      kind: "inherit",
                      folder: folderLeafName(inherits.folder),
                      workspaceName: res.workspaceName,
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
export function shareSummary(
    t: AccessTranslator,
    input: {
        general: GeneralAccess;
        grants: readonly ShareGrant[];
        open: ShareOpen;
        /** The viewer's auth subject id. */
        selfAuthId: string | null;
        audienceCount: number | null;
        dirty: boolean;
    }
): string {
    const isSelf = (g: ShareGrant) =>
        g.principalType === "user" && Boolean(g.authUserId) && g.authUserId === input.selfAuthId;
    const others = input.grants.filter(g => !isSelf(g));
    const people = others.filter(g => g.principalType === "user").length;
    const groups = others.filter(g => g.principalType === "group").length;
    const roles = others.filter(g => g.principalType === "role").length;
    const parts: string[] = [];
    if (people > 0) parts.push(t("counts.people", { count: people }));
    if (groups > 0) parts.push(t("counts.groups", { count: groups }));
    if (roles > 0) parts.push(t("counts.roles", { count: roles }));
    const who = parts.join(t("list.separator"));
    const counted = (text: string) =>
        input.audienceCount !== null && !input.dirty
            ? t("share.summary.withCount", { text, count: input.audienceCount })
            : text;

    if (input.general === "open") {
        // Inheriting, people added here open it too — on top of the folder's audience.
        if (input.open.kind === "inherit" && !input.open.workspaceName && parts.length > 0) {
            return counted(t("share.summary.plus", { folder: input.open.folder, who }));
        }
        return counted(shareOpenHint(t, input.open));
    }
    if (others.length === 0) return t("share.summary.onlyYou");
    const listed = input.grants.some(isSelf);
    return listed ? t("share.summary.youAnd", { who }) : t("share.summary.listed", { who });
}

// ---------------------------------------------------------------------------
// Public link (ADR-016): files only, and outside the dialog's Save
// ---------------------------------------------------------------------------

/** Where the workspace switch is, for the "public links are off" note. */
const PUBLIC_LINKS_SWITCH_HREF = workspaceHref("people", { focus: PUBLIC_LINKS_SETTING });

type PublicLinkAction = "create" | "expiry" | "download" | "revoke";

/** The expiry menu's choices; `current` is the date the link has now. */
const EXPIRY_CHOICES: Record<string, PublicLinkExpiryDays> = { never: null, "7": 7, "30": 30 };

interface PublicLinkLoad {
    state: PublicLinkState | null;
    setState: React.Dispatch<React.SetStateAction<PublicLinkState | null>>;
    loading: boolean;
    failed: boolean;
}

/** A file's public link, read when the dialog opens on it (alongside who has access). */
function usePublicLink(documentId: number | null): PublicLinkLoad {
    const [state, setState] = useState<PublicLinkState | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setState(null);
        setFailed(false);
        if (documentId === null) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void (async () => {
            try {
                const next = await peopleApi.access.publicLink(documentId);
                if (!cancelled) setState(next);
            } catch {
                if (!cancelled) setFailed(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [documentId]);

    return { state, setState, loading, failed };
}

/**
 * The file's public link: make it, copy it (or its Markdown twin, for an AI
 * agent), set when it expires and whether it allows download, or turn it
 * off. Every control acts at once and says so in a toast; none of it waits
 * for the dialog's Save, which is about the people above.
 */
function PublicLinkSection({
    documentId,
    name,
    load,
    onChanged,
    onLeave,
}: {
    documentId: number;
    name: string;
    load: PublicLinkLoad;
    /** A link was made or turned off: lists refetch their badges. */
    onChanged?: () => void;
    /** The dialog is being left for Settings. */
    onLeave: () => void;
}) {
    const t = useTranslations("team.access.share.publicLink");
    const format = useFormatter();
    const { state, setState, loading, failed } = load;
    const [busy, setBusy] = useState<PublicLinkAction | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const headingId = useId();
    const expiryId = useId();
    const downloadId = useId();

    const dateOf = (iso: string) =>
        format.dateTime(new Date(iso), { year: "numeric", month: "short", day: "numeric" });

    /** Run one change; the new state replaces the old, and a toast says what happened. */
    const change = async (
        action: PublicLinkAction,
        call: () => Promise<PublicLinkState>,
        said: (next: PublicLinkState) => string
    ): Promise<boolean> => {
        setBusy(action);
        setError(null);
        try {
            const next = await call();
            setState(next);
            toast.success(said(next));
            return true;
        } catch (err) {
            if (isApiError(err) && err.body.code === "public_links_off") {
                // Switched off since the dialog opened: the note says so.
                setState(prev => (prev ? { ...prev, enabled: false } : prev));
            } else {
                setError(errorMessage(err, t("changeError")));
            }
            return false;
        } finally {
            setBusy(null);
        }
    };

    const update = (body: PublicLinkInput) => peopleApi.access.updatePublicLink(documentId, body);

    const create = async () => {
        const made = await change(
            "create",
            () => peopleApi.access.createPublicLink(documentId),
            () => t("created", { name })
        );
        if (made) onChanged?.();
    };

    const turnOff = async () => {
        const done = await change(
            "revoke",
            () => peopleApi.access.revokePublicLink(documentId),
            () => t("turnedOff", { name })
        );
        if (done) onChanged?.();
    };

    const setExpiry = (choice: string) => {
        if (!(choice in EXPIRY_CHOICES)) return;
        const days = EXPIRY_CHOICES[choice] ?? null;
        void change(
            "expiry",
            () => update({ expiresInDays: days }),
            next =>
                next.link?.expiresAt
                    ? t("expiryUpdated", { date: dateOf(next.link.expiresAt) })
                    : t("expiryRemoved")
        );
    };

    const setDownload = (allow: boolean) =>
        void change(
            "download",
            () => update({ allowDownload: allow }),
            () => (allow ? t("downloadOn", { name }) : t("downloadOff", { name }))
        );

    const copy = async (value: string, done: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(done);
        } catch {
            // No clipboard (an insecure origin, a denied permission): the
            // address is in the field, selectable.
            toast.error(t("copyError"));
        }
    };

    const offNote = (key: "off" | "offWithLink") => (
        <p className="bg-panel-2 text-ink-2 m-0 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed">
            {t.rich(key, {
                link: chunks => (
                    <Link
                        href={PUBLIC_LINKS_SWITCH_HREF}
                        onClick={onLeave}
                        className="text-brand-ink underline"
                    >
                        {chunks}
                    </Link>
                ),
            })}
        </p>
    );

    let body: React.ReactNode;
    if (loading) {
        body = (
            <p className="text-ink-3 m-0 text-[12.5px]" role="status">
                {t("loading")}
            </p>
        );
    } else if (failed || !state) {
        body = <p className="text-danger m-0 text-[12.5px]">{t("loadError")}</p>;
    } else if (!state.link) {
        body = !state.enabled ? (
            offNote("off")
        ) : state.canManage ? (
            <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy !== null}
                onClick={() => void create()}
            >
                <Globe />
                {busy === "create" ? t("creating") : t("create")}
            </Button>
        ) : (
            <p className="text-ink-3 m-0 text-[12.5px] leading-normal">{t("noLinkReadOnly")}</p>
        );
    } else {
        const link = state.link;
        body = (
            <>
                {!state.enabled && offNote("offWithLink")}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                        readOnly
                        value={link.url}
                        aria-label={t("urlLabel")}
                        onFocus={e => e.currentTarget.select()}
                        className="h-8 min-w-0 flex-1 font-mono text-[12px]"
                    />
                    <div className="flex shrink-0 gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void copy(link.url, t("copied"))}
                        >
                            <Copy />
                            {t("copy")}
                        </Button>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void copy(link.markdownUrl, t("copiedForAi"))}
                                >
                                    <Bot />
                                    {t("copyForAi")}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("copyForAiHint")}</TooltipContent>
                        </Tooltip>
                    </div>
                </div>
                {state.canManage ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="flex items-center gap-2">
                            <Label
                                htmlFor={expiryId}
                                className="text-ink-2 text-[12.5px] font-normal"
                            >
                                {t("expires")}
                            </Label>
                            <Select
                                value={link.expiresAt ? "current" : "never"}
                                onValueChange={setExpiry}
                                disabled={busy !== null}
                            >
                                <SelectTrigger
                                    id={expiryId}
                                    size="sm"
                                    className="w-fit min-w-[132px]"
                                    aria-label={t("expires")}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {link.expiresAt && (
                                        <SelectItem value="current">
                                            {t("expiryOn", { date: dateOf(link.expiresAt) })}
                                        </SelectItem>
                                    )}
                                    <SelectItem value="never">{t("expiryNever")}</SelectItem>
                                    <SelectItem value="7">{t("expiry7")}</SelectItem>
                                    <SelectItem value="30">{t("expiry30")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                id={downloadId}
                                checked={link.allowDownload}
                                onCheckedChange={setDownload}
                                disabled={busy !== null}
                            />
                            <Label
                                htmlFor={downloadId}
                                className="text-ink-2 text-[12.5px] font-normal"
                            >
                                {t("allowDownload")}
                            </Label>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:bg-danger-soft hover:text-danger-ink ml-auto"
                            disabled={busy !== null}
                            onClick={() => setConfirming(true)}
                        >
                            {busy === "revoke" ? t("turningOff") : t("turnOff")}
                        </Button>
                    </div>
                ) : (
                    <>
                        {link.expiresAt && (
                            <p className="text-ink-3 m-0 text-[12.5px] leading-normal">
                                {t("expiresOn", { date: dateOf(link.expiresAt) })}
                            </p>
                        )}
                        <p className="text-ink-3 m-0 text-[12.5px] leading-normal">
                            {t("readOnly")}
                        </p>
                    </>
                )}
            </>
        );
    }

    /** Something here acts the moment it is used: say so, since Save does not cover it. */
    const acts = Boolean(state?.canManage) && (state?.link != null || state?.enabled === true);

    return (
        <section
            aria-labelledby={headingId}
            className="border-line flex flex-col gap-2 border-t pt-4"
        >
            <div className="flex items-baseline justify-between gap-3">
                <h3 id={headingId} className="text-ink-2 m-0 text-xs font-semibold">
                    {t("title")}
                </h3>
                {acts && <span className="text-ink-3 text-[11.5px]">{t("appliesNow")}</span>}
            </div>
            <p className="text-ink-3 m-0 text-[12.5px] leading-normal">{t("explainer")}</p>
            {body}
            {error && (
                <p role="alert" className="text-danger m-0 text-[12.5px]">
                    {error}
                </p>
            )}
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t("confirmTitle")}
                description={t("confirmDescription")}
                confirmLabel={t("turnOff")}
                onConfirm={() => void turnOff()}
            />
        </section>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
    const t = useTranslations("team.access");
    const tTeam = useTranslations("team");
    const tc = useTranslations("common");
    const roleLabel = useRoleLabel();
    const open = target !== null;
    const [saved, setSaved] = useState<ShareState | null>(null);
    const [general, setGeneral] = useState<GeneralAccess>("restricted");
    const [grants, setGrants] = useState<ShareGrant[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [groupDraft, setGroupDraft] = useState<string | null>(null);
    const [creatingGroup, setCreatingGroup] = useState(false);
    /** Where focus goes when the inline group form closes — not the dialog itself. */
    const saveRef = useRef<HTMLButtonElement>(null);

    const use = useMemo(
        () => adapter ?? (target ? ADAPTERS[target.kind] : null),
        [adapter, target]
    );
    const publicLink = usePublicLink(target?.kind === "document" ? target.id : null);

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
                if (!cancelled) setError(errorMessage(err, t("share.loadError")));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [target, use, t]);

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
            requestAnimationFrame(() => saveRef.current?.focus());
            toast.success(
                memberIds.length > 0
                    ? t("share.groupCreatedWith", { name: group.name, count: memberIds.length })
                    : t("share.groupCreatedEmpty", { name: group.name })
            );
        } catch (err) {
            setError(errorMessage(err, t("share.groupError")));
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
                    ? t("share.savedOpen", {
                          name: target.name,
                          access: shareOpenLabel(t, saved.open).toLowerCase(),
                      })
                    : t("share.saved", { name: target.name })
            );
            onSaved?.();
            onClose();
        } catch (err) {
            setError(errorMessage(err, t("share.saveError")));
        } finally {
            setSaving(false);
        }
    };

    const summary = saved
        ? shareSummary(t, {
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
            <DialogContent
                className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg"
                {...(target?.kind === "folder" || target?.kind === "chat"
                    ? {}
                    : { "aria-describedby": undefined })}
            >
                <DialogHeader>
                    <DialogTitle className="truncate pr-6">
                        {t("share.title", { name: target?.name ?? "" })}
                    </DialogTitle>
                    {target?.kind === "folder" || target?.kind === "chat" ? (
                        <DialogDescription>
                            {target.kind === "folder"
                                ? t("share.descriptionFolder")
                                : t("share.descriptionChat")}
                        </DialogDescription>
                    ) : null}
                </DialogHeader>

                {loading ? (
                    <p className="text-ink-3 m-0 text-sm" role="status">
                        {t("share.loading")}
                    </p>
                ) : (
                    <div className="flex flex-col gap-4">
                        {saved && !canManage && (
                            <p className="bg-panel-2 text-ink-2 m-0 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed">
                                {t("share.readOnly")}
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
                                            ? t("share.makeGroup", { count: listedPeople.length })
                                            : t("share.newGroup")}
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
                                            placeholder={t("share.groupPlaceholder")}
                                            aria-label={t("share.groupLabel")}
                                            className="h-8"
                                            maxLength={80}
                                        />
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={creatingGroup || !groupDraft.trim()}
                                        >
                                            {creatingGroup
                                                ? t("share.creating")
                                                : tc("actions.create")}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setGroupDraft(null)}
                                        >
                                            {tc("actions.cancel")}
                                        </Button>
                                    </form>
                                )}
                            </div>
                        )}

                        <section
                            aria-label={t("share.peopleWithAccess")}
                            className="flex flex-col gap-1.5"
                        >
                            <h3 className="text-ink-2 m-0 text-xs font-semibold">
                                {t("share.peopleWithAccess")}
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
                                                {saved?.owner?.authUserId === selfAuthId && (
                                                    <span className="text-ink-3">
                                                        {tTeam("you")}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-ink-3 text-[12px]">
                                                {t("share.owner")}
                                            </span>
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
                                    const name =
                                        g.principalType === "role"
                                            ? roleLabel(g.principalId, g.principalName)
                                            : (look?.displayName ?? g.principalName);
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
                                                    <span className="text-ink-3">
                                                        {tTeam("you")}
                                                    </span>
                                                )}
                                            </span>
                                            {g.principalType !== "user" && (
                                                // The icon already says group or role; on a phone the
                                                // name needs the room more than the label does.
                                                <Badge
                                                    variant="secondary"
                                                    className="max-sm:hidden"
                                                >
                                                    {t(`share.types.${g.principalType}`)}
                                                </Badge>
                                            )}
                                            {isOwner && g.level === "manage" ? (
                                                <span className="text-ink-3 w-[104px] shrink-0 text-right text-[12px] sm:w-[118px]">
                                                    {t("share.owner")}
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
                                                        className="w-[104px] shrink-0 sm:w-[118px]"
                                                        aria-label={t("share.levelFor", { name })}
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {levels.map(level => (
                                                            <SelectItem key={level} value={level}>
                                                                {tTeam(`levels.${level}`)}
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
                                                    aria-label={t("share.remove", { name })}
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
                                        {t("share.noOne")}
                                    </li>
                                )}
                            </ul>
                        </section>

                        {saved && (
                            <section
                                aria-label={t("share.general")}
                                className="flex flex-col gap-1.5"
                            >
                                <h3 className="text-ink-2 m-0 text-xs font-semibold">
                                    {t("share.general")}
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
                                                aria-label={t("share.general")}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="restricted">
                                                    {t("share.restrictedOption")}
                                                </SelectItem>
                                                <SelectItem value="open">
                                                    {shareOpenLabel(t, saved.open)}
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

                        {target?.kind === "document" && (
                            <PublicLinkSection
                                documentId={target.id}
                                name={target.name}
                                load={publicLink}
                                onChanged={onSaved}
                                onLeave={onClose}
                            />
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
                        {ownerName ? t("share.addedBy", { name: ownerName }) : ""}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose} disabled={saving}>
                            {canManage ? tc("actions.cancel") : tc("actions.close")}
                        </Button>
                        {canManage && (
                            <Button
                                ref={saveRef}
                                onClick={() => void save()}
                                disabled={!dirty || saving || loading}
                            >
                                {saving ? tc("status.saving") : tc("actions.save")}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
