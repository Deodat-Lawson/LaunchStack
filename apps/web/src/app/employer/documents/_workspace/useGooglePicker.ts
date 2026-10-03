"use client";

/**
 * Loads Google's Picker (the one external script the Drive connector needs)
 * and opens it with a server-minted access token. Under drive.file, picking
 * is what grants the app access — the Picker is not just UI, it is the
 * permission surface. It opens on three views, because a folder someone
 * shared with you is easy to miss in the default list and a shared drive is
 * not shown unless asked for: Drive, Shared with me, and Shared drives.
 */

import { useCallback, useState } from "react";

export interface PickedDoc {
    readonly fileId: string;
    readonly name: string;
    readonly mimeType: string;
    readonly kind: "file" | "folder";
}

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

interface PickerDocument {
    id: string;
    name?: string;
    mimeType?: string;
}

interface PickerResponse {
    action: string;
    docs?: PickerDocument[];
}

export interface PickerView {
    setIncludeFolders(value: boolean): PickerView;
    setSelectFolderEnabled(value: boolean): PickerView;
    setOwnedByMe(me: boolean): PickerView;
    setEnableDrives(enabled: boolean): PickerView;
}

interface PickerBuilder {
    addView(view: PickerView): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    enableFeature(feature: string): PickerBuilder;
    setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    build(): { setVisible(visible: boolean): void };
}

export interface PickerNamespace {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new () => PickerView;
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
}

/**
 * The Picker's tabs: everything (the view it always had), Shared with me, and
 * Shared drives. Google's rules: `setEnableDrives` can't be combined with
 * `setOwnedByMe` or `setParent`, so each view sets only its own filter.
 */
export function buildDriveViews(picker: Pick<PickerNamespace, "DocsView">): PickerView[] {
    const browsable = () =>
        new picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(true);
    return [browsable(), browsable().setOwnedByMe(false), browsable().setEnableDrives(true)];
}

interface GoogleGlobals {
    gapi?: { load(name: string, callback: () => void): void };
    google?: { picker?: PickerNamespace };
}

let pickerReady: Promise<PickerNamespace> | null = null;

function loadPicker(scriptUrl: string): Promise<PickerNamespace> {
    pickerReady ??= new Promise<PickerNamespace>((resolve, reject) => {
        const globals = window as unknown as GoogleGlobals;

        const onGapi = () => {
            globals.gapi?.load("picker", () => {
                const picker = globals.google?.picker;
                if (picker) resolve(picker);
                else reject(new Error("Google Picker failed to initialize"));
            });
        };

        if (globals.gapi) {
            onGapi();
            return;
        }
        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = true;
        script.onload = onGapi;
        script.onerror = () => {
            pickerReady = null;
            reject(new Error("Failed to load the Google API script"));
        };
        document.head.appendChild(script);
    });
    return pickerReady;
}

export interface OpenPickerOptions {
    /** Google's api.js, or the dev stand-in's copy — from the status route. */
    readonly scriptUrl: string;
    /** Browser API key (NEXT_PUBLIC_GOOGLE_API_KEY), from the status route. */
    readonly apiKey: string;
    /** Cloud project number — registers picks to our OAuth client. Mandatory. */
    readonly appId: string;
    /** Server-minted short-lived access token. */
    readonly accessToken: string;
    readonly onPicked: (docs: readonly PickedDoc[]) => void;
}

export function useGooglePicker() {
    const [opening, setOpening] = useState(false);

    const openPicker = useCallback(async (options: OpenPickerOptions) => {
        setOpening(true);
        try {
            const picker = await loadPicker(options.scriptUrl);
            const builder = new picker.PickerBuilder().setTitle("Pick files and folders to sync");
            for (const view of buildDriveViews(picker)) builder.addView(view);

            builder
                .setOAuthToken(options.accessToken)
                .setDeveloperKey(options.apiKey)
                .setAppId(options.appId)
                .enableFeature(picker.Feature.MULTISELECT_ENABLED)
                .setCallback(data => {
                    if (data.action !== picker.Action.PICKED) return;
                    const docs: PickedDoc[] = (data.docs ?? []).map(doc => ({
                        fileId: doc.id,
                        name: doc.name ?? "Untitled",
                        mimeType: doc.mimeType ?? "",
                        kind: doc.mimeType === GOOGLE_FOLDER_MIME ? "folder" : "file",
                    }));
                    if (docs.length > 0) options.onPicked(docs);
                })
                .build()
                .setVisible(true);
        } finally {
            setOpening(false);
        }
    }, []);

    return { openPicker, opening };
}
