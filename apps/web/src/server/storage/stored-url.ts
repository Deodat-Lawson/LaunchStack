import { isInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";

import { env } from "~/env";

import { currentStorageLocationId, normalizeStorageEndpoint } from "./location";
import { refIdentity, type ObjectRef } from "./object-ref";

type StoredUrlResult =
    | { ok: true; ref: ObjectRef }
    | { ok: false; reason: "unrecognized" | "ambiguous" };

/** Recognize only our provider URL forms; never guess which store owns a URL. */
export function refFromStoredUrl(url: string): StoredUrlResult {
    const matches = new Map<string, ObjectRef>();
    const add = (ref: ObjectRef) => matches.set(refIdentity(ref), ref);
    try {
        const fileId = parseInternalFileId(url);
        if (
            fileId !== null &&
            isInternalFileUrl(url, env.server.APP_PUBLIC_URL ?? "http://app:3000")
        ) {
            add({
                adapter: "database",
                storageLocationId: currentStorageLocationId("database")!,
                key: String(fileId),
            });
        }

        // Relative paths belong only to the database provider.
        let parsed: URL | null = null;
        try {
            parsed = new URL(url);
        } catch {
            // A relative /api/files URL may already have matched above.
        }
        if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
            const internalEndpoint = normalizeStorageEndpoint(env.server.NEXT_PUBLIC_S3_ENDPOINT);
            if (internalEndpoint && currentStorageLocationId("s3")) {
                const endpoints = new Set([
                    internalEndpoint,
                    normalizeStorageEndpoint(env.server.S3_PUBLIC_ENDPOINT),
                ]);
                for (const endpoint of endpoints) {
                    if (!endpoint) continue;
                    const base = new URL(endpoint);
                    const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
                    if (parsed.origin !== base.origin || !parsed.pathname.startsWith(prefix))
                        continue;
                    const path = parsed.pathname.slice(prefix.length);
                    const slash = path.indexOf("/");
                    if (slash <= 0 || slash === path.length - 1) continue;
                    const bucket = decodeURIComponent(path.slice(0, slash));
                    add({
                        adapter: "s3",
                        storageLocationId: `s3:${internalEndpoint}@${bucket}`,
                        key: decodeURIComponent(path.slice(slash + 1)),
                    });
                }
            }

            const blobStore = /^([a-z\d-]+)\.(?:public|private)\.blob\.vercel-storage\.com$/.exec(
                parsed.hostname
            )?.[1];
            if (blobStore && parsed.pathname.length > 1) {
                add({
                    adapter: "vercel-blob",
                    storageLocationId: `vercel-blob:${blobStore}`,
                    key: decodeURIComponent(parsed.pathname.slice(1)),
                });
            }

            if (parsed.protocol === "https:") {
                const appId = /^([a-z\d-]+)\.ufs\.sh$/.exec(parsed.hostname)?.[1];
                const legacyHost =
                    parsed.hostname === "utfs.io" || parsed.hostname === "uploadthing.com";
                const key = /^\/f\/([^/]+)$/.exec(parsed.pathname)?.[1];
                const location = appId
                    ? `uploadthing:${appId}`
                    : legacyHost
                      ? currentStorageLocationId("uploadthing")
                      : null;
                if (location && key) {
                    add({
                        adapter: "uploadthing",
                        storageLocationId: location,
                        key: decodeURIComponent(key),
                    });
                }
            }
        }
    } catch {
        // Malformed URLs/percent encoding are not safe object references.
        return { ok: false, reason: "unrecognized" };
    }
    if (matches.size > 1) return { ok: false, reason: "ambiguous" };
    const ref = matches.values().next().value;
    return ref ? { ok: true, ref } : { ok: false, reason: "unrecognized" };
}
