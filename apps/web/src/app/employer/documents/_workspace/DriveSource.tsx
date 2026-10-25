"use client";

/**
 * The Google Drive buttons in Add source's Files and Folder tabs (see
 * useDriveSource): beside "Browse files", pick files from Drive; beside
 * "Choose folder", pick a Drive folder or paste its link. Either way it goes
 * to the folder in the destination bar and stays in sync with Drive.
 *
 * Renders nothing for someone who can't pick (see useDriveSource), and in
 * the Folder tab where this server can't import a folder's contents.
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { GoogleDriveLogo } from "~/components/icons/brand";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { driveIdFromLink } from "~/lib/integrations/google-drive-link";

import type { PickedDoc } from "./useGooglePicker";
import {
    DRIVE_CONNECT_URL,
    DRIVE_FOLDER_ACCESS_URL,
    type DriveSourceState,
    type useDriveSource,
} from "./useDriveSource";

type DriveSource = ReturnType<typeof useDriveSource>;

function addedToast(
    t: ReturnType<typeof useTranslations<"sources.driveSource">>,
    docs: readonly PickedDoc[]
) {
    const [first] = docs;
    if (docs.length === 1 && first) {
        toast.success(
            first.kind === "folder"
                ? t("addedFolder", { name: first.name })
                : t("addedOne", { name: first.name })
        );
    } else {
        toast.success(t("addedMany", { count: docs.length }));
    }
}

/** A link that leaves for Google's consent screen, drawn as the Drive button. */
function ConsentLink({ href, label }: { href: string; label: string }) {
    return (
        <Button asChild variant="outline">
            <a href={href}>
                <GoogleDriveLogo size={16} />
                {label}
            </a>
        </Button>
    );
}

/** Beside "Browse files": files from Drive, into `destination`. */
export function DriveFilesButton({
    drive,
    destination,
    onAdded,
}: {
    drive: DriveSource;
    destination: string;
    onAdded: () => void;
}) {
    const t = useTranslations("sources.driveSource");
    const state = drive.state;
    if (state.kind === "connect") {
        return <ConsentLink href={DRIVE_CONNECT_URL} label={t("connect")} />;
    }
    if (state.kind === "reconnect") return <ConsentLink href={state.href} label={t("reconnect")} />;
    if (state.kind !== "ready") return null;
    return (
        <Button
            type="button"
            variant="outline"
            disabled={drive.busy}
            onClick={() =>
                void drive.pick("files", destination, docs => {
                    addedToast(t, docs);
                    onAdded();
                })
            }
        >
            <GoogleDriveLogo size={16} />
            {t("chooseFiles")}
        </Button>
    );
}

/** Whether the Files tab says picked Drive files stay in sync — whenever its button shows. */
export function drivePickShown(state: DriveSourceState): boolean {
    return state.kind === "connect" || state.kind === "reconnect" || state.kind === "ready";
}

/**
 * Whether the Folder tab offers Drive at all: only where a picked folder can
 * bring its contents, now or after the folder-access consent.
 */
export function driveFolderShown(state: DriveSourceState): boolean {
    if (state.kind === "connect") return state.folderImport;
    if (state.kind === "reconnect") return true;
    return state.kind === "ready" && state.access !== "files-only";
}

/** Beside "Choose folder": a Drive folder, rebuilt inside `destination`. */
export function DriveFolderButton({
    drive,
    destination,
    onAdded,
}: {
    drive: DriveSource;
    destination: string;
    onAdded: () => void;
}) {
    const t = useTranslations("sources.driveSource");
    const state = drive.state;
    if (!driveFolderShown(state)) return null;
    // From here, connecting asks for folder access straight away: a folder is
    // what they came for.
    if (state.kind === "connect") {
        return <ConsentLink href={DRIVE_FOLDER_ACCESS_URL} label={t("connect")} />;
    }
    if (state.kind === "reconnect") return <ConsentLink href={state.href} label={t("reconnect")} />;
    if (state.kind === "ready" && state.access === "allow") {
        return <ConsentLink href={DRIVE_FOLDER_ACCESS_URL} label={t("chooseFolder")} />;
    }
    return (
        <Button
            type="button"
            variant="outline"
            disabled={drive.busy}
            onClick={() =>
                void drive.pick("folders", destination, docs => {
                    addedToast(t, docs);
                    onAdded();
                })
            }
        >
            <GoogleDriveLogo size={16} />
            {t("chooseFolder")}
        </Button>
    );
}

/** The line under the Folder tab's buttons: what a Drive folder does, or what it needs first. */
export function DriveFolderHint({ drive }: { drive: DriveSource }) {
    const t = useTranslations("sources.driveSource");
    const state = drive.state;
    if (!driveFolderShown(state)) return null;
    const needsConsent =
        state.kind === "connect" || (state.kind === "ready" && state.access === "allow");
    return (
        <p className="text-ink-3 mx-auto mt-3 max-w-[380px] text-xs">
            {needsConsent ? t("folderNeedsAccess") : t("folderSyncs")}
        </p>
    );
}

/**
 * Paste a Drive folder's link — for one shared with the account that the
 * Picker's lists make hard to find. Offered only where folders import whole.
 */
export function DriveFolderLinkForm({
    drive,
    destination,
    onAdded,
}: {
    drive: DriveSource;
    destination: string;
    onAdded: () => void;
}) {
    const t = useTranslations("sources.driveSource");
    const [link, setLink] = useState("");
    const [error, setError] = useState<string | null>(null);
    if (drive.state.kind !== "ready" || drive.state.access !== "ready") return null;

    const submit = async () => {
        const value = link.trim();
        if (!driveIdFromLink(value)) {
            setError(t("notDriveLink"));
            return;
        }
        setError(null);
        const failed = await drive.addLink(value, destination);
        if (failed) {
            setError(failed);
            return;
        }
        toast.success(t("linkAdded"));
        setLink("");
        onAdded();
    };

    return (
        <form
            className="mt-4"
            onSubmit={event => {
                event.preventDefault();
                void submit();
            }}
        >
            <label
                htmlFor="drive-folder-link"
                className="text-ink-3 mb-1.5 block text-xs font-semibold"
            >
                {t("pasteLinkLabel")}
            </label>
            <div className="flex gap-2 max-sm:flex-col">
                <div className="relative min-w-0 flex-1">
                    <Link2 className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                        id="drive-folder-link"
                        value={link}
                        onChange={event => {
                            setLink(event.target.value);
                            setError(null);
                        }}
                        placeholder="https://drive.google.com/drive/folders/…"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? "drive-folder-link-error" : undefined}
                        className="pl-8"
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>
                <Button type="submit" variant="outline" disabled={drive.busy || !link.trim()}>
                    {drive.busy ? t("adding") : t("addFolder")}
                </Button>
            </div>
            {error ? (
                <p id="drive-folder-link-error" className="text-danger mt-1.5 text-xs">
                    {error}
                </p>
            ) : (
                <p className="text-ink-3 mt-1.5 text-xs">
                    {drive.accountEmail
                        ? t("linkHintAccount", { account: drive.accountEmail })
                        : t("linkHintThis")}
                </p>
            )}
        </form>
    );
}
