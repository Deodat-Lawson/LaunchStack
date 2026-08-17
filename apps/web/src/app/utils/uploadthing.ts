import {
    generateUploadButton,
    generateUploadDropzone,
} from "@uploadthing/react";
import type { ObjectRef } from "@launchstack/core/storage";

import type { FileRouter } from "uploadthing/next";

type ClientFileRouter = FileRouter;

export const UploadButton = generateUploadButton<ClientFileRouter>();
export const UploadDropzone = generateUploadDropzone<ClientFileRouter>();

type UploadThingServerData = {
    url?: unknown;
    ref?: unknown;
};

type UploadThingClientItem = {
    url?: unknown;
    serverData?: UploadThingServerData | null;
};

function isObjectRef(value: unknown): value is ObjectRef {
    return Boolean(
        value &&
            typeof value === "object" &&
            typeof (value as { adapter?: unknown }).adapter === "string" &&
            typeof (value as { storageLocationId?: unknown }).storageLocationId === "string" &&
            typeof (value as { key?: unknown }).key === "string",
    );
}

/**
 * Enforces the UploadThing callback contract: every successful upload must
 * carry both `url` and canonical `ref` in serverData.
 */
export function readUploadThingResult(item: UploadThingClientItem | undefined): {
    url: string;
    ref: ObjectRef;
} {
    const serverData = item?.serverData ?? null;
    const serverUrl = typeof serverData?.url === "string" ? serverData.url.trim() : "";
    const fallbackUrl = typeof item?.url === "string" ? item.url.trim() : "";
    const url = serverUrl || fallbackUrl;

    if (!url) {
        throw new Error("UploadThing: callback did not return a usable url.");
    }

    if (!isObjectRef(serverData?.ref)) {
        throw new Error("UploadThing: callback did not return a canonical object ref.");
    }

    return {
        url,
        ref: serverData.ref,
    };
}
