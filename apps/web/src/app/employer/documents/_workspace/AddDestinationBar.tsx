"use client";

/**
 * The top of every "Add a source" tab: where the addition lands and who will
 * be able to open it, before anything is uploaded (ADR-014).
 *
 *   Add to         [Q4 planning / Pricing ▾]
 *   Who can see it  Specific people · 4 people              Change access
 *                   (You) (Ada Lovelace) (Design)
 *                   Pricing follows Q4 planning's sharing.
 *
 * Picking where is picking who: the picker lists each folder's audience, so
 * there is no separate permission control. The audience comes from the folder
 * list the workspace already holds (instant), then names and a head count from
 * the same endpoint the Share dialog reads.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Building2,
    Check,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderPlus,
    Lock,
    ShieldCheck,
    Users,
} from "lucide-react";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
    folderDepth,
    folderLeafName,
    isUnfiledFolder,
    joinFolderPath,
    normalizeFolderPath,
    UNFILED_FOLDER,
    validateFolderPath,
} from "~/lib/folders/path";
import { usePeople } from "~/lib/profile/use-people";
import { cn } from "~/lib/utils";

import {
    audiencePrincipals,
    connectorDestination,
    destinationLabel,
    folderAudienceTag,
    peopleCount,
    resolveDestination,
    summarizeAudience,
    type AudiencePrincipal,
    type AudienceSummary,
    type FolderAudienceFacts,
} from "./addDestination";
import { peopleApi } from "./settings/people/api";
import type { ItemAccessView, SourceAudience } from "./types";

export interface AddDestinationBarProps {
    /** `pick` — the person chooses the folder; `fixed` — this tab always files in `value`. */
    mode: "pick" | "fixed";
    /** The chosen folder (Unfiled for none). */
    value: string;
    onChange?: (path: string) => void;
    /** A folder this addition creates inside `value` (the Folder tab's), shown after it. */
    pendingChild?: string | null;
    /** Folders the person can add to — the picker's list. */
    folders: readonly string[];
    /** Every folder the person can see, to tell an existing folder from a new one. */
    knownFolders: readonly string[];
    /** The person's access to each folder, as the workspace's folder list reports it. */
    folderAccess: Readonly<Record<string, ItemAccessView>>;
    /** Create a folder from the picker; may resolve to the path it really got ("Name (2)"). */
    onCreate?: (path: string) => void | Promise<string | null | void>;
    workspaceName?: string | null;
    /** The viewer's auth subject id, to show their own row as "You". */
    selfAuthId: string | null;
    /** Open the Share dialog for a folder. Shown to people who manage it. */
    onShareFolder?: (path: string) => void;
    /** Changes whenever sharing may have changed, to read the audience again. */
    accessVersion?: number;
    /** A line under the audience — the Mindmap tab's applies to the published copy. */
    audienceNote?: string;
    /** A destination whose audience is known by rule, not by folder (Gmail: always its owner's). */
    fixedAudience?: AudienceSummary;
}

const TONE_ICON: Record<SourceAudience, typeof Lock> = {
    private: Lock,
    shared: Users,
    workspace: Building2,
};

export function AddDestinationBar({
    mode,
    value,
    onChange,
    pendingChild,
    folders,
    knownFolders,
    folderAccess,
    onCreate,
    workspaceName,
    selfAuthId,
    onShareFolder,
    accessVersion = 0,
    audienceNote,
    fixedAudience,
}: AddDestinationBarProps) {
    const child = pendingChild?.trim() ?? "";
    const effective = child ? joinFolderPath(isUnfiledFolder(value) ? null : value, child) : value;
    const dest = useMemo(
        () =>
            mode === "fixed"
                ? connectorDestination(effective)
                : resolveDestination(effective, knownFolders),
        [mode, effective, knownFolders]
    );
    const from = fixedAudience ? null : dest.audienceFrom;
    const known = from ? folderAccess[normalizeFolderPath(from)] : undefined;
    const { facts, governing, settled } = useFolderAudience(from, accessVersion);

    const principals = useMemo(
        () => (facts ? audiencePrincipals(facts, governing, selfAuthId) : []),
        [facts, governing, selfAuthId]
    );
    const tone: SourceAudience | null =
        known?.audience ?? (facts ? toneOf(facts, principals) : null);
    const count = from && facts ? facts.audienceCount : null;
    const governingPath =
        facts && facts.visibility !== "restricted" && facts.inheritsFrom.restricted
            ? facts.inheritsFrom.path
            : (known?.governingPath ?? null);
    const summary =
        fixedAudience ??
        summarizeAudience(dest, tone, {
            workspaceName: facts?.workspaceName ?? workspaceName,
            governingPath,
            count,
        });
    const canShare =
        !fixedAudience &&
        dest.kind === "folder" &&
        !!onShareFolder &&
        (known?.canManage ?? facts?.canManage ?? false);

    const ToneIcon = summary ? TONE_ICON[summary.tone] : Users;

    return (
        <section
            aria-label="Where this goes and who can see it"
            data-testid="add-destination"
            className="border-line bg-panel-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5 rounded-xl border px-4 py-3 max-sm:grid-cols-1 max-sm:gap-y-1 max-sm:px-3"
        >
            <span className="text-ink-3 pt-1.5 text-xs font-medium max-sm:pt-0">
                {mode === "fixed" ? "Goes to" : "Add to"}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {mode === "pick" && onChange ? (
                    <FolderPicker
                        value={value}
                        onChange={onChange}
                        folders={folders}
                        knownFolders={knownFolders}
                        folderAccess={folderAccess}
                        onCreate={onCreate}
                    />
                ) : (
                    <span
                        className="text-ink inline-flex h-8 min-w-0 items-center gap-1.5 text-sm font-medium"
                        data-testid="add-destination-path"
                    >
                        <Folder className="text-ink-3 size-4 shrink-0" aria-hidden />
                        <span className="truncate">{destinationLabel(value)}</span>
                    </span>
                )}
                {child && (
                    <>
                        <ChevronRight className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                        <span className="text-ink min-w-0 truncate text-sm font-medium">
                            {child}
                        </span>
                        {dest.kind !== "folder" && <Badge variant="secondary">New folder</Badge>}
                    </>
                )}
            </div>

            <span className="text-ink-3 pt-0.5 text-xs font-medium max-sm:pt-1.5">
                Who can see it
            </span>
            <div className="min-w-0" data-testid="add-source-audience" role="note">
                {summary ? (
                    <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <ToneIcon
                                className={cn(
                                    "size-3.5 shrink-0",
                                    summary.tone === "private" ? "text-ink-2" : "text-brand"
                                )}
                                aria-hidden
                            />
                            <span className="text-ink text-sm font-semibold">
                                {summary.headline}
                            </span>
                            {count !== null && summary.tone === "workspace" && (
                                <span className="text-ink-3 text-xs">· {peopleCount(count)}</span>
                            )}
                            {canShare && (
                                <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="ml-auto h-auto p-0 text-xs"
                                    title={`Change who can open ${folderLeafName(dest.path)}`}
                                    onClick={() => onShareFolder?.(dest.path)}
                                >
                                    Change access
                                </Button>
                            )}
                        </div>
                        {summary.tone === "shared" && principals.length > 0 && (
                            <PrincipalChips principals={principals} />
                        )}
                        <p className="text-ink-3 mt-1 text-xs leading-relaxed">
                            {summary.detail}
                            {audienceNote ? ` ${audienceNote}` : ""}
                        </p>
                    </>
                ) : (
                    <p className="text-ink-3 text-xs">
                        {settled
                            ? "Couldn't load who can see this folder right now."
                            : "Checking who can see it…"}
                    </p>
                )}
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Audience facts
// ---------------------------------------------------------------------------

/** Private when every principal is the viewer; restricted otherwise means specific people. */
function toneOf(facts: FolderAudienceFacts, principals: AudiencePrincipal[]): SourceAudience {
    const restricted = facts.visibility === "restricted" || facts.inheritsFrom.restricted;
    if (!restricted) return "workspace";
    return principals.length > 0 && principals.every(p => p.self) ? "private" : "shared";
}

/**
 * The folder's access as the Share dialog reads it, and — when it inherits a
 * restriction — the governing folder's, for the names. Stale answers for a
 * folder no longer shown are dropped.
 */
function useFolderAudience(
    path: string | null,
    version: number
): {
    facts: FolderAudienceFacts | null;
    governing: FolderAudienceFacts | null;
    /** The request finished, whatever it said. */
    settled: boolean;
} {
    const [state, setState] = useState<{
        key: string;
        facts: FolderAudienceFacts | null;
        governing: FolderAudienceFacts | null;
    } | null>(null);
    const key = path ? `${path}#${version}` : "";

    useEffect(() => {
        if (!path) return;
        let cancelled = false;
        void (async () => {
            try {
                const facts = await peopleApi.access.folderByPath(path);
                if (!Array.isArray(facts?.grants) || !facts.inheritsFrom) {
                    throw new Error("Unexpected folder access response");
                }
                const governingPath =
                    facts.visibility !== "restricted" && facts.inheritsFrom.restricted
                        ? facts.inheritsFrom.path
                        : null;
                const governing = governingPath
                    ? await peopleApi.access.folderByPath(governingPath).catch(() => null)
                    : null;
                if (!cancelled) setState({ key, facts, governing });
            } catch {
                // Leave the folder-list answer standing; names and counts are extra.
                if (!cancelled) setState({ key, facts: null, governing: null });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [path, key]);

    return state?.key === key
        ? { facts: state.facts, governing: state.governing, settled: true }
        : { facts: null, governing: null, settled: false };
}

// ---------------------------------------------------------------------------
// People, groups and roles
// ---------------------------------------------------------------------------

const MAX_CHIPS = 4;

function PrincipalChips({ principals }: { principals: AudiencePrincipal[] }) {
    const shown = principals.slice(0, MAX_CHIPS);
    const more = principals.length - shown.length;
    const looks = usePeople(
        shown.flatMap(p => (p.type === "user" && p.authUserId ? [p.authUserId] : []))
    );
    return (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="People with access">
            {shown.map(p => {
                const look = p.authUserId ? looks[p.authUserId] : undefined;
                const name = p.self ? "You" : (look?.displayName ?? p.name);
                return (
                    <li
                        key={`${p.type}:${p.authUserId ?? p.name}`}
                        className="border-line bg-panel text-ink-2 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs sm:max-w-[12rem]"
                    >
                        {p.type === "user" ? (
                            <ProfileAvatar
                                name={look?.displayName ?? p.name}
                                src={look?.avatarUrl ?? null}
                                className="size-4"
                                fallbackClassName="text-[8px]"
                            />
                        ) : p.type === "group" ? (
                            <Users className="text-ink-3 ml-1 size-3 shrink-0" aria-hidden />
                        ) : (
                            <ShieldCheck className="text-ink-3 ml-1 size-3 shrink-0" aria-hidden />
                        )}
                        <span className="truncate">{name}</span>
                        {p.type !== "user" && (
                            <span className="text-ink-3 shrink-0">
                                {p.type === "group" ? "group" : "role"}
                            </span>
                        )}
                    </li>
                );
            })}
            {more > 0 && (
                <li className="text-ink-3 inline-flex items-center px-1 text-xs">+{more} more</li>
            )}
        </ul>
    );
}

// ---------------------------------------------------------------------------
// Folder picker
// ---------------------------------------------------------------------------

interface FolderPickerProps {
    value: string;
    onChange: (next: string) => void;
    folders: readonly string[];
    knownFolders: readonly string[];
    folderAccess: Readonly<Record<string, ItemAccessView>>;
    onCreate?: (name: string) => void | Promise<string | null | void>;
}

function FolderPicker({
    value,
    onChange,
    folders,
    knownFolders,
    folderAccess,
    onCreate,
}: FolderPickerProps) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const real = folders.filter(f => !isUnfiledFolder(f));
    const filtered = real.filter(f => f.toLowerCase().includes(q.trim().toLowerCase()));
    // Typing "Contracts/2026" creates a nested folder; the path is validated
    // the same way the folder dialog validates it.
    const candidate = normalizeFolderPath(q);
    const candidateProblem = q.trim().length > 0 ? validateFolderPath(candidate) : null;
    const canCreate =
        !!onCreate &&
        q.trim().length > 0 &&
        !candidateProblem &&
        !knownFolders.some(f => f.toLowerCase() === candidate.toLowerCase());
    const created = canCreate ? resolveDestination(candidate, knownFolders) : null;
    const createdNote = created
        ? created.kind === "new-sub" && created.audienceFrom
            ? `Inside ${folderLeafName(created.audienceFrom)} · follows its sharing`
            : "Private to you"
        : null;

    const pick = (path: string) => {
        onChange(path);
        setOpen(false);
        setQ("");
    };

    const create = () => {
        const made = onCreate?.(candidate);
        pick(candidate);
        // A taken name comes back as "Name (2)": save there.
        if (made instanceof Promise) {
            void made.then(actual => {
                if (actual && actual !== candidate) onChange(actual);
            });
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (!next) setQ("");
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 min-w-0 max-w-full justify-start"
                    data-testid="add-destination-picker"
                    aria-label={`Add to: ${destinationLabel(value)}. Change folder`}
                >
                    <Folder className="text-ink-3" aria-hidden />
                    <span className="truncate">{destinationLabel(value)}</span>
                    <ChevronDown className="text-ink-3" aria-hidden />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80 p-0"
                onOpenAutoFocus={e => {
                    e.preventDefault();
                    inputRef.current?.focus();
                }}
            >
                <div className="border-line border-b p-2">
                    <Input
                        ref={inputRef}
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Find or create a folder…"
                        aria-label="Find or create a folder"
                        className="h-8 text-[13px]"
                        onKeyDown={e => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (filtered.length === 1 && !canCreate) pick(filtered[0]!);
                            else if (canCreate) create();
                        }}
                    />
                </div>
                <div className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label="Folders">
                    {!q.trim() && (
                        <FolderOption
                            label="No folder"
                            hint="Unfiled"
                            depth={0}
                            selected={isUnfiledFolder(value)}
                            tag={{ tone: "private", label: "Only you" }}
                            onSelect={() => pick(UNFILED_FOLDER)}
                        />
                    )}
                    {filtered.map(f => (
                        <FolderOption
                            key={f}
                            label={q.trim() ? destinationLabel(f) : folderLeafName(f)}
                            depth={q.trim() ? 0 : folderDepth(f)}
                            selected={normalizeFolderPath(value) === normalizeFolderPath(f)}
                            tag={folderAudienceTag(folderAccess[normalizeFolderPath(f)])}
                            onSelect={() => pick(f)}
                        />
                    ))}
                    {q.trim() && filtered.length === 0 && !canCreate && !candidateProblem && (
                        <p className="text-ink-3 px-3 py-2 text-xs">No folder by that name.</p>
                    )}
                    {canCreate && (
                        <button
                            type="button"
                            onClick={create}
                            className={cn(
                                "text-brand hover:bg-brand-soft flex w-full items-start gap-2 px-3 py-1.5 text-left text-[13px]",
                                filtered.length > 0 && "border-line border-t"
                            )}
                        >
                            <FolderPlus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0">
                                <span className="block truncate font-semibold">
                                    Create &ldquo;{destinationLabel(candidate)}&rdquo;
                                </span>
                                <span className="text-ink-3 block text-[11px]">{createdNote}</span>
                            </span>
                        </button>
                    )}
                    {candidateProblem && (
                        <p className="text-danger px-3 py-1.5 text-[11px]">{candidateProblem}</p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function FolderOption({
    label,
    hint,
    depth,
    selected,
    tag,
    onSelect,
}: {
    label: string;
    hint?: string;
    depth: number;
    selected: boolean;
    tag: { tone: SourceAudience; label: string } | null;
    onSelect: () => void;
}) {
    const TagIcon = tag ? TONE_ICON[tag.tone] : null;
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            onClick={onSelect}
            className={cn(
                "text-ink hover:bg-brand-soft flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                selected && "bg-brand-soft/60"
            )}
        >
            <span style={{ width: depth * 12 }} className="shrink-0" aria-hidden />
            <Folder className="text-ink-3 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
                {label}
                {hint && <span className="text-ink-3 ml-1.5 text-[11px]">{hint}</span>}
            </span>
            {tag && TagIcon && (
                <span
                    className="text-ink-3 inline-flex shrink-0 items-center gap-1 text-[11px]"
                    title={`Who can see it: ${tag.label}`}
                >
                    <TagIcon className="size-3" aria-hidden />
                    {tag.label}
                </span>
            )}
            <Check
                className={cn("text-brand size-3.5 shrink-0", !selected && "invisible")}
                aria-hidden
            />
        </button>
    );
}
