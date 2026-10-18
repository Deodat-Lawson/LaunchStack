"use client";

/**
 * Workspace › General — the workspace's own details: name, URL, description,
 * industry, team size and colour. The same fields the create form asks for
 * (`/workspaces`), which until now could not be changed afterwards.
 *
 * Body only, like every section: the chrome draws the header and the one
 * Save button this publishes (disabled until something changed). Everyone
 * reads these; without `settings.manage` the fields are read-only and there
 * is no Save.
 *
 * A rename shows at once in the sidebar and the account menu: the name is
 * patched into the permissions snapshot the sidebar reads, and the server
 * layout that feeds the workspace card is refreshed in place.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { WorkspaceMark } from "~/app/employer/_chrome/WorkspaceMark";
import { Card } from "~/components/layout/page-shell";
import { Button } from "~/components/ui/button";
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
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useInstanceHost } from "~/lib/instance-host";
import { setWorkspaceNameLocally, usePermissions } from "~/lib/use-permissions";
import { cn } from "~/lib/utils";
import {
    WORKSPACE_DETAIL_LIMITS,
    WORKSPACE_SLUG_RE,
    WORKSPACE_SWATCHES,
    WORKSPACE_TEAM_SIZES,
    workspaceInitials,
    type WorkspaceDetails,
    type WorkspaceDetailsPatch,
    type WorkspaceDetailsResponse,
} from "~/lib/workspace-details";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { StatusNote } from "./ui";

interface Draft {
    name: string;
    slug: string;
    description: string;
    industry: string;
    teamSize: string;
    swatch: number;
}

function draftOf(details: WorkspaceDetails): Draft {
    return {
        name: details.name,
        slug: details.slug ?? "",
        description: details.description ?? "",
        industry: details.industry ?? "",
        teamSize: details.teamSize,
        swatch: details.swatch,
    };
}

/** Only what differs from what is saved, in the API's words. */
function patchOf(saved: Draft, draft: Draft): WorkspaceDetailsPatch {
    const patch: WorkspaceDetailsPatch = {};
    if (draft.name.trim() !== saved.name) patch.name = draft.name.trim();
    if (draft.slug.trim().toLowerCase() !== saved.slug)
        patch.slug = draft.slug.trim().toLowerCase();
    if (draft.description.trim() !== saved.description)
        patch.description = draft.description.trim();
    if (draft.industry.trim() !== saved.industry) patch.industry = draft.industry.trim();
    if (draft.teamSize !== saved.teamSize) patch.teamSize = draft.teamSize;
    if (draft.swatch !== saved.swatch) patch.swatch = draft.swatch;
    return patch;
}

/** A team size from before the create form's options ("1" from sign-up) reads as a count. */
function teamSizeLabel(value: string): string {
    const count = /^\d+$/.test(value) ? Number(value) : null;
    if (count === null) return value;
    return count === 1 ? "Just one person" : `About ${count} people`;
}

type SlugState =
    | { kind: "unchanged" }
    | { kind: "invalid" }
    | { kind: "checking" }
    | { kind: "available" }
    | { kind: "taken" };

export function WorkspaceGeneralSection({ onActions }: SettingsSectionProps) {
    const router = useRouter();
    const { loaded: permissionsLoaded, can } = usePermissions();
    const [saved, setSaved] = useState<WorkspaceDetails | null>(null);
    const [canEditServer, setCanEditServer] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [slugState, setSlugState] = useState<SlugState>({ kind: "unchanged" });
    // "<this instance's host>/<slug>", as the workspace picker shows it.
    const host = useInstanceHost();

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const res = await fetch("/api/workspace/details");
            const body = (await res
                .json()
                .catch(() => ({}))) as Partial<WorkspaceDetailsResponse> & {
                error?: string;
            };
            if (!res.ok || !body.workspace) {
                setLoadError(
                    body.error ?? `Couldn't load the workspace's details (${res.status}).`
                );
                return;
            }
            setSaved(body.workspace);
            setDraft(draftOf(body.workspace));
            setCanEditServer(Boolean(body.canEdit));
        } catch {
            setLoadError("Couldn't reach the server. Check your connection and try again.");
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);

    // The server says who may save; the role decides too, so a role change
    // mid-visit takes the button away before the server would refuse it.
    const canEdit = canEditServer && permissionsLoaded && can("settings.manage");
    const savedDraft = useMemo(() => (saved ? draftOf(saved) : null), [saved]);
    const patch = useMemo(
        () => (savedDraft && draft ? patchOf(savedDraft, draft) : {}),
        [savedDraft, draft]
    );
    const dirty = Object.keys(patch).length > 0;

    // Live check of a new URL, debounced; the workspace's own is never "taken".
    const wantedSlug = draft?.slug.trim().toLowerCase() ?? "";
    const savedSlug = saved?.slug ?? "";
    const hasDraft = draft !== null;
    useEffect(() => {
        if (!hasDraft || wantedSlug === savedSlug) {
            setSlugState({ kind: "unchanged" });
            return;
        }
        if (wantedSlug.length < 2 || !WORKSPACE_SLUG_RE.test(wantedSlug)) {
            setSlugState({ kind: "invalid" });
            return;
        }
        setSlugState({ kind: "checking" });
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const res = await fetch(
                        `/api/workspaces/slug-available?slug=${encodeURIComponent(wantedSlug)}`,
                        { signal: controller.signal }
                    );
                    const body = (await res.json()) as { available?: boolean; valid?: boolean };
                    if (controller.signal.aborted) return;
                    if (body.valid === false) setSlugState({ kind: "invalid" });
                    else setSlugState({ kind: body.available ? "available" : "taken" });
                } catch {
                    // A failed check is not a verdict; Save still asks the server.
                    if (!controller.signal.aborted) setSlugState({ kind: "unchanged" });
                }
            })();
        }, 350);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [wantedSlug, savedSlug, hasDraft]);

    const nameMissing = draft !== null && draft.name.trim().length === 0;
    const blocked = nameMissing || slugState.kind === "invalid" || slugState.kind === "taken";

    // Read through refs so the published Save stays the same function: a new
    // one each render would republish the actions, and the chrome's state
    // change would render this again.
    const patchRef = useRef(patch);
    patchRef.current = patch;
    const routerRef = useRef(router);
    routerRef.current = router;
    const save = useCallback(async () => {
        const body = patchRef.current;
        if (Object.keys(body).length === 0) return;
        setSaving(true);
        setSaveError(null);
        try {
            const res = await fetch("/api/workspace/details", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = (await res.json().catch(() => ({}))) as {
                workspace?: WorkspaceDetails;
                error?: string;
                field?: string;
            };
            if (!res.ok || !result.workspace) {
                if (res.status === 409 && result.field === "slug") setSlugState({ kind: "taken" });
                setSaveError(result.error ?? `Couldn't save (${res.status}).`);
                return;
            }
            const next = result.workspace;
            setSaved(next);
            setDraft(draftOf(next));
            toast.success("Workspace details saved");
            // The sidebar's name comes from the permissions snapshot; the
            // workspace card and the account menu from the server layout.
            setWorkspaceNameLocally(next.name);
            if (body.name !== undefined || body.swatch !== undefined) routerRef.current.refresh();
        } catch {
            setSaveError("Couldn't reach the server. Nothing was saved.");
        } finally {
            setSaving(false);
        }
    }, []);

    const discard = useCallback(() => {
        if (savedDraft) setDraft(savedDraft);
        setSaveError(null);
    }, [savedDraft]);

    usePublishedActions(
        onActions,
        canEdit
            ? {
                  primaryLabel: "Save changes",
                  primaryBusyLabel: "Saving…",
                  onPrimary: save,
                  busy: saving,
                  disabled: !dirty || blocked,
                  secondary: dirty ? (
                      <Button variant="ghost" onClick={discard} disabled={saving}>
                          Discard
                      </Button>
                  ) : undefined,
              }
            : {},
        [canEdit, save, saving, dirty, blocked, discard]
    );

    if (loadError) {
        return (
            <StatusNote tone="danger">
                {loadError}{" "}
                <Button variant="link" className="h-auto p-0" onClick={() => void load()}>
                    Try again
                </Button>
            </StatusNote>
        );
    }
    if (!draft || !saved) return <StatusNote tone="muted">Loading…</StatusNote>;

    const set =
        <K extends keyof Draft>(key: K) =>
        (value: Draft[K]) =>
            setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
    const disabled = !canEdit || saving;
    const teamSizes: readonly string[] = WORKSPACE_TEAM_SIZES.includes(
        draft.teamSize as (typeof WORKSPACE_TEAM_SIZES)[number]
    )
        ? WORKSPACE_TEAM_SIZES
        : [draft.teamSize, ...WORKSPACE_TEAM_SIZES];
    const initials = workspaceInitials(draft.name || saved.name);

    return (
        <div data-testid="workspace-general">
            {!canEdit && permissionsLoaded && (
                <StatusNote tone="muted">
                    Changing these takes a role that manages the workspace&apos;s settings.
                </StatusNote>
            )}
            {saveError && <StatusNote tone="danger">{saveError}</StatusNote>}
            <Card padding="4px 20px">
                <FieldRow
                    id="workspace-name"
                    label="Name"
                    description="What everyone in the workspace sees: the sidebar, the workspace picker, invitations."
                >
                    <Input
                        id="workspace-name"
                        value={draft.name}
                        maxLength={WORKSPACE_DETAIL_LIMITS.name}
                        onChange={e => set("name")(e.target.value)}
                        disabled={disabled}
                        aria-invalid={nameMissing || undefined}
                        autoComplete="off"
                    />
                    {nameMissing && <FieldNote tone="danger">Give the workspace a name.</FieldNote>}
                </FieldRow>

                <FieldRow
                    id="workspace-slug"
                    label="URL"
                    description="How the workspace is listed when you switch between workspaces. It must be unique on this server; nothing else links to it."
                >
                    <div
                        className={cn(
                            "border-line bg-line-background dark:bg-line/30 focus-within:border-brand focus-within:ring-brand/50 flex h-9 items-center overflow-hidden rounded-md border focus-within:ring-[3px]",
                            (slugState.kind === "invalid" || slugState.kind === "taken") &&
                                "border-danger",
                            disabled && "opacity-50"
                        )}
                    >
                        {host && (
                            <span className="text-ink-3 max-w-[45%] shrink-0 truncate pl-3 font-mono text-[12.5px]">
                                {host}/
                            </span>
                        )}
                        <Input
                            id="workspace-slug"
                            value={draft.slug}
                            maxLength={WORKSPACE_DETAIL_LIMITS.slug}
                            onChange={e => set("slug")(e.target.value)}
                            disabled={disabled}
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={
                                slugState.kind === "invalid" ||
                                slugState.kind === "taken" ||
                                undefined
                            }
                            aria-describedby="workspace-slug-status"
                            className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent pl-1 font-mono focus-visible:ring-0 disabled:opacity-100 dark:bg-transparent"
                        />
                    </div>
                    <div id="workspace-slug-status" aria-live="polite">
                        <SlugNote state={slugState} />
                    </div>
                </FieldRow>

                <FieldRow
                    id="workspace-description"
                    label="Description"
                    description="One sentence on what the company does. Optional; it helps the assistant."
                >
                    <Textarea
                        id="workspace-description"
                        value={draft.description}
                        maxLength={WORKSPACE_DETAIL_LIMITS.description}
                        onChange={e => set("description")(e.target.value)}
                        disabled={disabled}
                        rows={3}
                        placeholder="We turn scattered context into a knowledge graph for AI workflows."
                    />
                </FieldRow>

                <FieldRow
                    id="workspace-industry"
                    label="Industry"
                    description="The field the company works in. Optional."
                >
                    <Input
                        id="workspace-industry"
                        value={draft.industry}
                        maxLength={WORKSPACE_DETAIL_LIMITS.industry}
                        onChange={e => set("industry")(e.target.value)}
                        disabled={disabled}
                        placeholder="e.g. Logistics software"
                        autoComplete="off"
                    />
                </FieldRow>

                <FieldRow
                    id="workspace-team-size"
                    label="Team size"
                    description="Roughly how many people work here."
                >
                    <Select
                        value={draft.teamSize}
                        onValueChange={value => set("teamSize")(value)}
                        disabled={disabled}
                    >
                        <SelectTrigger id="workspace-team-size" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {teamSizes.map(size => (
                                <SelectItem key={size} value={size}>
                                    {teamSizeLabel(size)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FieldRow>

                <FieldRow
                    id="workspace-colour"
                    label="Colour"
                    description="The workspace's mark in the sidebar and the workspace picker."
                >
                    <ToggleGroup
                        id="workspace-colour"
                        type="single"
                        value={String(draft.swatch)}
                        onValueChange={value => {
                            // Clicking the chosen colour again deselects it in a
                            // single toggle group; a workspace always has one.
                            if (value) set("swatch")(Number(value));
                        }}
                        disabled={disabled}
                        aria-label="Colour"
                        className="flex-wrap justify-start gap-1.5"
                    >
                        {WORKSPACE_SWATCHES.map(n => (
                            <ToggleGroupItem
                                key={n}
                                value={String(n)}
                                aria-label={`Colour ${n}`}
                                className="data-[state=on]:ring-brand data-[state=on]:ring-offset-panel size-9 min-w-9 rounded-[10px] p-0 data-[state=on]:bg-transparent data-[state=on]:ring-2 data-[state=on]:ring-offset-2"
                            >
                                <WorkspaceMark swatch={n} initials={initials} />
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </FieldRow>
            </Card>
        </div>
    );
}

/**
 * Label and description beside the control while both fit, stacked below
 * that — the same rhythm as a registry row (`SettingRow`), sized by the room
 * the section has rather than the window.
 */
function FieldRow({
    id,
    label,
    description,
    children,
}: {
    id: string;
    label: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <div className="border-line border-b py-4 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 flex-[1_1_220px]">
                    <Label htmlFor={id} className="text-ink text-[13px] font-semibold">
                        {label}
                    </Label>
                    <p className="text-ink-3 m-0 mt-1 max-w-[560px] text-[12.5px] leading-normal">
                        {description}
                    </p>
                </div>
                <div className="min-w-0 max-w-[380px] flex-[999_1_280px]">{children}</div>
            </div>
        </div>
    );
}

function FieldNote({
    tone,
    children,
}: {
    tone: "ok" | "danger" | "muted";
    children: React.ReactNode;
}) {
    return (
        <p
            className={cn(
                "m-0 mt-1.5 flex items-center gap-1 text-[12px]",
                tone === "ok" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink-3"
            )}
        >
            {children}
        </p>
    );
}

function SlugNote({ state }: { state: SlugState }) {
    switch (state.kind) {
        case "unchanged":
            return null;
        case "checking":
            return <FieldNote tone="muted">Checking…</FieldNote>;
        case "invalid":
            return (
                <FieldNote tone="danger">
                    At least two characters: lowercase letters, numbers and dashes.
                </FieldNote>
            );
        case "available":
            return (
                <FieldNote tone="ok">
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                    Available
                </FieldNote>
            );
        case "taken":
            return <FieldNote tone="danger">Taken — try a different URL.</FieldNote>;
    }
}
