/**
 * Thrown when an upload references a file the workspace may not read, or an
 * internal file that cannot be processed in the current configuration.
 * Callers map this onto an HTTP response instead of a generic 500.
 *
 * Kept in its own module, free of the db and the engine — like
 * ~/lib/authz/permissions — so a route can catch it without importing
 * `internal-file-ref`, which pulls in the db client and the whole engine
 * composition root just to name an error type.
 *
 * The sentence may be a `Copy` (~/i18n/copy): `message` is its English, and
 * the route words `copy` in the reader's language.
 */

import type { Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

export class UploadAuthorizationError extends Error {
    readonly status: number;
    readonly copy: Copy | null;

    constructor(message: string | Copy, status = 403) {
        super(typeof message === "string" ? message : englishCopy(message));
        this.name = "UploadAuthorizationError";
        this.status = status;
        this.copy = typeof message === "string" ? null : message;
    }
}
