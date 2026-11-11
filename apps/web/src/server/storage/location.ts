import { env } from "~/env";

import type { StorageAdapter } from "./object-ref";

export function normalizeStorageEndpoint(endpoint: string | undefined): string | null {
    if (!endpoint) return null;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
        return null;
    }
}

/** The identity of the provider location this process is allowed to mutate. */
export function currentStorageLocationId(adapter: StorageAdapter): string | null {
    switch (adapter) {
        case "s3": {
            const endpoint = normalizeStorageEndpoint(env.server.NEXT_PUBLIC_S3_ENDPOINT);
            const bucket = env.server.S3_BUCKET_NAME;
            return endpoint && bucket ? `s3:${endpoint}@${bucket}` : null;
        }
        case "database":
            return "database:file_uploads";
        case "vercel-blob": {
            // @vercel/blob extracts storeId from token.split("_")[3].
            const token = env.server.BLOB_READ_WRITE_TOKEN;
            const storeId = token && /^vercel_blob_rw_([a-z\d-]+)_[^\s]+$/i.exec(token)?.[1];
            return storeId ? `vercel-blob:${storeId.toLowerCase()}` : null;
        }
        case "uploadthing": {
            const token = env.server.UPLOADTHING_TOKEN;
            if (!token) return null;
            try {
                // UploadThing v7's UploadThingToken schema decodes base64 JSON.
                const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as {
                    appId?: unknown;
                } | null;
                const appId = decoded?.appId;
                return typeof appId === "string" && appId.length > 0
                    ? `uploadthing:${appId}`
                    : null;
            } catch {
                return null;
            }
        }
    }
}
