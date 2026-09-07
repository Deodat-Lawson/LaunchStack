"use client";

/**
 * Loads Google's Picker (the one external script the Drive connector needs)
 * and opens it with a server-minted, drive.file-scoped access token. Picking
 * is what grants the app access under drive.file — the Picker is not just UI,
 * it is the permission surface.
 */

import { useCallback, useState } from "react";

export interface PickedDoc {
    readonly fileId: string;
    readonly name: string;
    readonly mimeType: string;
    readonly kind: "file" | "folder";
}

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const GAPI_SRC = "https://apis.google.com/js/api.js";

interface PickerDocument {
    id: string;
    name?: string;
    mimeType?: string;
}

interface PickerResponse {
    action: string;
    docs?: PickerDocument[];
}

interface PickerView {
    setIncludeFolders(value: boolean): PickerView;
    setSelectFolderEnabled(value: boolean): PickerView;
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

interface PickerNamespace {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new () => PickerView;
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
}

interface GoogleGlobals {
    gapi?: { load(name: string, callback: () => void): void };
    google?: { picker?: PickerNamespace };
}

let pickerReady: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
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
        script.src = GAPI_SRC;
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
            const picker = await loadPicker();
            const view = new picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(true);

            new picker.PickerBuilder()
                .setTitle("Pick files and folders to sync")
                .addView(view)
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
