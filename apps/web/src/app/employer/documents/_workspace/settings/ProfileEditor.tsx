"use client";

/**
 * The profile half of Account: who you are everywhere, and how you appear in
 * the workspace you are in.
 *
 * Two layers, one form. The profile is the person's and follows them into
 * every workspace. The workspace card overrides three fields — photo,
 * display name, title — for the active workspace only; blank means "use my
 * profile". Resolution is `~/lib/profile/resolve`, the same function the
 * server uses, so the preview is what others will see.
 *
 * Photos save the moment the crop is confirmed (as in Slack); text fields
 * save through the chrome's one primary button.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, SelectInput, TextArea, TextInput } from "~/components/field";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";
import { PROFILE_LIMITS, PROFILE_PHOTO, type ProfileScope } from "~/lib/profile/fields";
import {
    firstFilled,
    hasOverride,
    localTimeIn,
    resolveProfile,
    type MyProfile,
} from "~/lib/profile/resolve";
import { ProfileWriteError, sendProfileWrite, useMyProfile } from "~/lib/profile/use-my-profile";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { ProfilePhotoDialog } from "./ProfilePhotoDialog";
import { StatusNote } from "./ui";

interface Draft {
    name: string;
    displayName: string;
    title: string;
    pronouns: string;
    timeZone: string;
    bio: string;
    workspaceDisplayName: string;
    workspaceTitle: string;
}

type DraftKey = keyof Draft;
const PROFILE_KEYS = ["name", "displayName", "title", "pronouns", "timeZone", "bio"] as const;

function draftFrom(data: MyProfile): Draft {
    return {
        name: data.profile.name,
        displayName: data.profile.displayName ?? "",
        title: data.profile.title ?? "",
        pronouns: data.profile.pronouns ?? "",
        timeZone: data.profile.timeZone ?? "",
        bio: data.profile.bio ?? "",
        workspaceDisplayName: data.workspace?.override.displayName ?? "",
        workspaceTitle: data.workspace?.override.title ?? "",
    };
}

/** Keeps the fields someone is editing; takes the server's value for the rest. */
function rebase(current: Draft, before: Draft, after: Draft): Draft {
    const next = { ...after };
    for (const key of Object.keys(after) as DraftKey[]) {
        if (current[key] !== before[key]) next[key] = current[key];
    }
    return next;
}

function changed(draft: Draft, base: Draft, keys: readonly DraftKey[]): DraftKey[] {
    return keys.filter(key => draft[key].trim() !== base[key].trim());
}

const orNull = (value: string) => firstFilled(value);

function timeZones(): string[] {
    const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
    try {
        return intl.supportedValuesOf?.("timeZone") ?? [];
    } catch {
        return [];
    }
}

function detectedTimeZone(): string | null {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
        return null;
    }
}

const PRONOUN_SUGGESTIONS = ["she/her", "he/him", "they/them", "she/they", "he/they"];

export function ProfileEditor({
    onActions,
    emailVerified,
}: SettingsSectionProps & { emailVerified: boolean | null }) {
    const t = useTranslations("settings.profile");
    const tc = useTranslations("common");
    const locale = useLocale();
    const { data, error: storeError, errorIsFallback, loaded } = useMyProfile();
    const error = errorIsFallback ? t("loadFailed") : storeError;
    /** A thrown write, in words: the server's sentence, else ours. */
    const failure = (err: unknown, fallback: string) =>
        err instanceof ProfileWriteError
            ? (err.serverMessage ?? t("saveFailed"))
            : err instanceof Error
              ? err.message
              : fallback;
    const base = useMemo(() => (data ? draftFrom(data) : null), [data]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const lastBase = useRef<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [photo, setPhoto] = useState<{ file: File; scope: ProfileScope } | null>(null);
    const [photoBusy, setPhotoBusy] = useState<ProfileScope | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const pickScope = useRef<ProfileScope>("global");

    // A write elsewhere (a photo upload, the header) refreshes the store; keep
    // whatever is mid-edit and take the rest.
    useEffect(() => {
        if (!base) return;
        setDraft(current =>
            current && lastBase.current ? rebase(current, lastBase.current, base) : base
        );
        lastBase.current = base;
    }, [base]);

    const zones = useMemo(timeZones, []);
    const detected = useMemo(detectedTimeZone, []);

    const profileChanges = draft && base ? changed(draft, base, PROFILE_KEYS) : [];
    const workspaceChanges =
        draft && base && data?.workspace
            ? changed(draft, base, ["workspaceDisplayName", "workspaceTitle"])
            : [];
    const nameInvalid = draft !== null && draft.name.trim().length === 0;
    const dirty = profileChanges.length + workspaceChanges.length > 0;

    const save = async () => {
        if (!draft || !base || nameInvalid) return;
        setSaving(true);
        try {
            if (profileChanges.includes("name")) {
                // The sign-in copy of the name is Better Auth's; update it
                // first so the session and the profile never disagree for long.
                const result = await authClient.updateUser({ name: draft.name.trim() });
                if (result.error) throw new Error(result.error.message ?? t("couldNotSaveName"));
            }
            if (profileChanges.length > 0) {
                const patch: Record<string, string | null> = {};
                for (const key of profileChanges) {
                    patch[key] = key === "name" ? draft.name.trim() : orNull(draft[key]);
                }
                await sendProfileWrite("/api/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                });
            }
            if (workspaceChanges.length > 0) {
                await sendProfileWrite("/api/profile/workspace", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...(workspaceChanges.includes("workspaceDisplayName")
                            ? { displayName: orNull(draft.workspaceDisplayName) }
                            : {}),
                        ...(workspaceChanges.includes("workspaceTitle")
                            ? { title: orNull(draft.workspaceTitle) }
                            : {}),
                    }),
                });
            }
            // Take the server's normalised values (trimmed, blanks cleared).
            setDraft(null);
            lastBase.current = null;
            toast.success(t("saved"));
        } catch (err) {
            toast.error(failure(err, t("saveFailed")));
        } finally {
            setSaving(false);
        }
    };

    usePublishedActions(
        onActions,
        {
            primaryLabel: t("savePrimary"),
            primaryBusyLabel: tc("status.saving"),
            onPrimary: save,
            busy: saving,
            disabled: !dirty || nameInvalid,
        },
        [draft, base, saving, dirty, nameInvalid, t, tc]
    );

    // After a save, `draft` is cleared so the effect re-seeds from the store.
    useEffect(() => {
        if (draft === null && base) {
            setDraft(base);
            lastBase.current = base;
        }
    }, [draft, base]);

    const choosePhoto = (scope: ProfileScope) => {
        pickScope.current = scope;
        fileInput.current?.click();
    };

    const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > PROFILE_PHOTO.maxBytes) {
            toast.error(t("tooLarge", { mb: PROFILE_PHOTO.maxBytes / (1024 * 1024) }));
            return;
        }
        setPhoto({ file, scope: pickScope.current });
    };

    const uploadPhoto = async (square: Blob) => {
        if (!photo) return;
        const form = new FormData();
        form.append("file", square, "photo.png");
        await sendProfileWrite(`/api/profile/photo?scope=${photo.scope}`, {
            method: "PUT",
            body: form,
        });
        toast.success(
            photo.scope === "workspace" && data?.workspace
                ? t("photoUpdatedIn", { workspace: data.workspace.name })
                : t("photoUpdated")
        );
        setPhoto(null);
    };

    const removePhoto = async (scope: ProfileScope) => {
        setPhotoBusy(scope);
        try {
            await sendProfileWrite(`/api/profile/photo?scope=${scope}`, { method: "DELETE" });
            toast.success(t("photoRemoved"));
        } catch (err) {
            toast.error(failure(err, t("removeFailed")));
        } finally {
            setPhotoBusy(null);
        }
    };

    const resetWorkspace = async () => {
        setPhotoBusy("workspace");
        try {
            await sendProfileWrite("/api/profile/workspace", { method: "DELETE" });
            // Only the workspace fields reset. Unsaved profile edits stay: the
            // store update above rebases the draft, which keeps edited fields,
            // so the workspace ones are cleared explicitly (an unsaved edit
            // there is exactly what Reset is meant to throw away).
            setDraft(current =>
                current ? { ...current, workspaceDisplayName: "", workspaceTitle: "" } : current
            );
            toast.success(t("usingProfile"));
        } catch (err) {
            toast.error(failure(err, t("resetFailed")));
        } finally {
            setPhotoBusy(null);
        }
    };

    if (!loaded || !data || !draft) {
        return (
            <Section title={t("section.title")} description={t("section.loadingDescription")}>
                <Card>
                    <StatusNote tone={error ? "danger" : "muted"} style={{ marginBottom: 0 }}>
                        {error ?? tc("status.loading")}
                    </StatusNote>
                </Card>
            </Section>
        );
    }

    // What the active workspace will see with the unsaved edits applied.
    const preview = resolveProfile(
        {
            ...data.profile,
            name: draft.name,
            displayName: orNull(draft.displayName),
            title: orNull(draft.title),
            pronouns: orNull(draft.pronouns),
            timeZone: orNull(draft.timeZone),
            bio: orNull(draft.bio),
        },
        data.workspace
            ? {
                  displayName: orNull(draft.workspaceDisplayName),
                  title: orNull(draft.workspaceTitle),
                  avatarUrl: data.workspace.override.avatarUrl,
              }
            : null
    );
    const set = (key: DraftKey) => (value: string) =>
        setDraft(current => (current ? { ...current, [key]: value } : current));
    const workspace = data.workspace;
    const localTime = localTimeIn(preview.timeZone, new Date(), locale);

    return (
        <>
            <Input
                ref={fileInput}
                type="file"
                accept={PROFILE_PHOTO.accept.join(",")}
                className="hidden"
                tabIndex={-1}
                aria-hidden
                onChange={onFile}
            />

            <Section title={t("section.title")} description={t("section.description")}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <Card>
                        <div className="mb-5 flex items-center gap-4">
                            <ProfileAvatar
                                name={preview.displayName}
                                email={data.profile.email}
                                src={data.profile.avatarUrl}
                                className="size-16"
                                fallbackClassName="text-xl"
                            />
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => choosePhoto("global")}
                                    >
                                        <Camera aria-hidden />
                                        {data.profile.avatarUrl
                                            ? t("changePhoto")
                                            : t("uploadPhoto")}
                                    </Button>
                                    {data.profile.avatarUrl && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={photoBusy === "global"}
                                            onClick={() => void removePhoto("global")}
                                        >
                                            <Trash2 aria-hidden />
                                            {tc("actions.remove")}
                                        </Button>
                                    )}
                                </div>
                                <div className="text-ink-3 mt-1.5 text-[11px]">
                                    {t("photoHint", { mb: PROFILE_PHOTO.maxBytes / (1024 * 1024) })}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-x-3.5 md:grid-cols-2">
                            <Field
                                label={t("fullName")}
                                hint={t("fullNameHint")}
                                error={nameInvalid ? t("nameEmpty") : undefined}
                            >
                                <TextInput
                                    value={draft.name}
                                    maxLength={PROFILE_LIMITS.name}
                                    autoComplete="name"
                                    onChange={e => set("name")(e.target.value)}
                                />
                            </Field>
                            <Field label={t("displayName")} hint={t("displayNameHint")}>
                                <TextInput
                                    value={draft.displayName}
                                    maxLength={PROFILE_LIMITS.displayName}
                                    placeholder={
                                        firstFilled(draft.name.split(/\s+/)[0]) ?? t("displayName")
                                    }
                                    autoComplete="nickname"
                                    onChange={e => set("displayName")(e.target.value)}
                                />
                            </Field>
                            <Field label={t("title")}>
                                <TextInput
                                    value={draft.title}
                                    maxLength={PROFILE_LIMITS.title}
                                    placeholder={t("titlePlaceholder")}
                                    autoComplete="organization-title"
                                    onChange={e => set("title")(e.target.value)}
                                />
                            </Field>
                            <Field label={t("pronouns")}>
                                <TextInput
                                    value={draft.pronouns}
                                    maxLength={PROFILE_LIMITS.pronouns}
                                    placeholder={t("pronounsPlaceholder")}
                                    list="profile-pronoun-suggestions"
                                    onChange={e => set("pronouns")(e.target.value)}
                                />
                                <datalist id="profile-pronoun-suggestions">
                                    {PRONOUN_SUGGESTIONS.map(option => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </Field>
                        </div>

                        <Field
                            label={t("timeZone")}
                            hint={
                                localTime
                                    ? t("localTimeHint", { time: localTime })
                                    : t("timeZoneHint")
                            }
                        >
                            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                                <SelectInput
                                    value={draft.timeZone}
                                    onChange={e => set("timeZone")(e.target.value)}
                                >
                                    <option value="">{t("notSet")}</option>
                                    {draft.timeZone && !zones.includes(draft.timeZone) && (
                                        <option value={draft.timeZone}>{draft.timeZone}</option>
                                    )}
                                    {zones.map(zone => (
                                        <option key={zone} value={zone}>
                                            {zone.replace(/_/g, " ")}
                                        </option>
                                    ))}
                                </SelectInput>
                                {detected && detected !== draft.timeZone && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="shrink-0"
                                        onClick={() => set("timeZone")(detected)}
                                    >
                                        {t("useZone", { zone: detected.replace(/_/g, " ") })}
                                    </Button>
                                )}
                            </div>
                        </Field>

                        <Field
                            label={t("about")}
                            hint={`${draft.bio.trim().length}/${PROFILE_LIMITS.bio}`}
                        >
                            <TextArea
                                value={draft.bio}
                                maxLength={PROFILE_LIMITS.bio}
                                rows={3}
                                placeholder={t("aboutPlaceholder")}
                                onChange={e => set("bio")(e.target.value)}
                            />
                        </Field>

                        <Field label={tc("fields.email")} hint={t("emailHint")}>
                            <div className="flex items-center gap-2">
                                <TextInput value={data.profile.email} disabled readOnly />
                                {emailVerified !== null && (
                                    <Badge variant={emailVerified ? "success" : "warn"}>
                                        {emailVerified ? t("verified") : t("unverified")}
                                    </Badge>
                                )}
                            </div>
                        </Field>
                    </Card>

                    <ProfilePreview
                        heading={
                            workspace
                                ? t("previewIn", { workspace: workspace.name })
                                : t("previewOthers")
                        }
                        preview={preview}
                        localTime={localTime}
                    />
                </div>
            </Section>

            {workspace && (
                <Section
                    title={t("workspaceSection.title", { workspace: workspace.name })}
                    description={t("workspaceSection.description")}
                >
                    <Card>
                        <div className="mb-5 flex items-center gap-4">
                            <ProfileAvatar
                                name={preview.displayName}
                                email={data.profile.email}
                                src={workspace.override.avatarUrl ?? data.profile.avatarUrl}
                                className="size-12"
                                fallbackClassName="text-base"
                            />
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        // Wraps rather than spilling out of a narrow Studio split.
                                        className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
                                        onClick={() => choosePhoto("workspace")}
                                    >
                                        <Camera aria-hidden />
                                        {workspace.override.avatarUrl
                                            ? t("changePhotoHere")
                                            : t("usePhotoHere")}
                                    </Button>
                                    {workspace.override.avatarUrl && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={photoBusy === "workspace"}
                                            onClick={() => void removePhoto("workspace")}
                                        >
                                            {t("useProfilePhoto")}
                                        </Button>
                                    )}
                                </div>
                                <div className="text-ink-3 mt-1.5 text-[11px]">
                                    {workspace.override.avatarUrl
                                        ? t("onlyWorkspaceSees", { workspace: workspace.name })
                                        : t("showingProfilePhoto")}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-x-3.5 md:grid-cols-2">
                            <Field label={t("displayNameHere")}>
                                <TextInput
                                    value={draft.workspaceDisplayName}
                                    maxLength={PROFILE_LIMITS.displayName}
                                    placeholder={
                                        orNull(draft.displayName) ??
                                        (draft.name || t("displayName"))
                                    }
                                    onChange={e => set("workspaceDisplayName")(e.target.value)}
                                />
                            </Field>
                            <Field label={t("titleHere")}>
                                <TextInput
                                    value={draft.workspaceTitle}
                                    maxLength={PROFILE_LIMITS.title}
                                    placeholder={orNull(draft.title) ?? t("titleHerePlaceholder")}
                                    onChange={e => set("workspaceTitle")(e.target.value)}
                                />
                            </Field>
                        </div>

                        {hasOverride(workspace.override) && (
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={photoBusy === "workspace"}
                                    onClick={() => void resetWorkspace()}
                                >
                                    {t("resetToProfile")}
                                </Button>
                            </div>
                        )}
                    </Card>
                </Section>
            )}

            <ProfilePhotoDialog
                file={photo?.file ?? null}
                title={
                    photo?.scope === "workspace" && workspace
                        ? t("photoDialog.titleIn", { workspace: workspace.name })
                        : t("photoDialog.titleProfile")
                }
                description={
                    photo?.scope === "workspace" && workspace
                        ? t("photoDialog.descriptionIn", { workspace: workspace.name })
                        : t("photoDialog.descriptionProfile")
                }
                onClose={() => setPhoto(null)}
                onSave={uploadPhoto}
            />
        </>
    );
}

function ProfilePreview({
    heading,
    preview,
    localTime,
}: {
    heading: string;
    preview: ReturnType<typeof resolveProfile>;
    localTime: string | null;
}) {
    const t = useTranslations("settings.profile");
    return (
        <Card className="self-start">
            <div className="text-ink-3 mb-4 text-[11px] font-semibold uppercase tracking-[0.06em]">
                {heading}
            </div>
            <ProfileAvatar
                name={preview.displayName}
                email={preview.email}
                src={preview.avatarUrl}
                className="size-20"
                fallbackClassName="text-2xl"
            />
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink text-[15px] font-semibold">{preview.displayName}</span>
                {preview.pronouns && <span className="text-ink-3 text-xs">{preview.pronouns}</span>}
            </div>
            {preview.displayName !== preview.name.trim() && preview.name.trim() && (
                <div className="text-ink-3 text-xs">{preview.name}</div>
            )}
            {preview.title && <div className="text-ink-2 mt-1 text-[13px]">{preview.title}</div>}
            {localTime && (
                <div className="text-ink-3 mt-2 flex items-center gap-1.5 text-xs">
                    <Clock className="size-3.5" aria-hidden />
                    {t("localTime", { time: localTime })}
                </div>
            )}
            {preview.bio && (
                <p className="text-ink-2 border-line mb-0 mt-3 whitespace-pre-line border-t pt-3 text-[13px] leading-normal">
                    {preview.bio}
                </p>
            )}
        </Card>
    );
}
