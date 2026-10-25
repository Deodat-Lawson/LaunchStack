"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import {
    registerDocument,
    sourceUploadErrorMessage,
    uploadFileToStorage,
} from "~/app/employer/documents/_workspace/sourceUpload";

import { UPLOAD_FOLDER, acceptsUpload } from "./files";

/** A file on its way into the workspace. Once added it is a picked file like any other. */
export interface UploadItem {
    key: string;
    name: string;
    size: number;
    state: "uploading" | "failed";
    message?: string;
}

/**
 * Uploads from the new-scenario form: each file is stored, registered as a
 * workspace document in the Company folder (which starts reading it), and
 * handed to `onAdded` with its document id so the form can pick it. `room`
 * is how many more files may be picked; uploads past it are refused before
 * anything is stored. Adding a file that failed again tries it again.
 */
export function useUploads({
    room,
    onAdded,
}: {
    room: number;
    onAdded: (documentId: number | null, name: string) => void;
}) {
    const t = useTranslations("scenarios.files");
    const tUpload = useTranslations("sources.sourceUpload");
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    /** Every key on screen, and whether it is still uploading. */
    const states = useRef(new Map<string, UploadItem["state"]>());
    const onAddedRef = useRef(onAdded);
    onAddedRef.current = onAdded;

    /** Put `key` in `next`'s state where it stands in the list, or take it off with null. */
    const settle = useCallback((key: string, next: UploadItem | null) => {
        if (next) states.current.set(key, next.state);
        else states.current.delete(key);
        setUploads(list => {
            if (!next) return list.filter(u => u.key !== key);
            return list.some(u => u.key === key)
                ? list.map(u => (u.key === key ? next : u))
                : [...list, next];
        });
    }, []);

    const add = useCallback(
        (files: File[]) => {
            const inFlight = [...states.current.values()].filter(s => s === "uploading").length;
            let left = room - inFlight;
            for (const file of files) {
                const key = `${file.name}-${file.size}-${file.lastModified}`;
                if (states.current.get(key) === "uploading") continue;
                const item: UploadItem = {
                    key,
                    name: file.name,
                    size: file.size,
                    state: "uploading",
                };
                if (!acceptsUpload(file.name)) {
                    settle(key, { ...item, state: "failed", message: t("notDocument") });
                    continue;
                }
                if (left <= 0) {
                    settle(key, { ...item, state: "failed", message: t("noRoom") });
                    continue;
                }
                left--;
                settle(key, item);
                void (async () => {
                    try {
                        const stored = await uploadFileToStorage(file);
                        const { documentId } = await registerDocument({
                            file,
                            ...stored,
                            category: UPLOAD_FOLDER,
                        });
                        settle(key, null);
                        onAddedRef.current(documentId, file.name);
                    } catch (e) {
                        settle(key, {
                            ...item,
                            state: "failed",
                            message:
                                sourceUploadErrorMessage(e, tUpload, t("uploadFailed")) ||
                                t("uploadFailed"),
                        });
                    }
                })();
            }
        },
        [room, settle, t, tUpload]
    );

    const dismiss = useCallback((key: string) => settle(key, null), [settle]);

    return { uploads, add, dismiss, busy: uploads.some(u => u.state === "uploading") };
}
