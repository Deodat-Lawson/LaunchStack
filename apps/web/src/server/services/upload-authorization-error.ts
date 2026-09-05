/**
 * Thrown when an upload references a file the workspace may not read, or an
 * internal file that cannot be processed in the current configuration.
 * Callers map this onto an HTTP response instead of a generic 500.
 *
 * Kept in its own dependency-free module — like ~/lib/authz/permissions — so a
 * route can catch it without importing `internal-file-ref`, which pulls in the
 * db client and the whole engine composition root just to name an error type.
 */
export class UploadAuthorizationError extends Error {
    readonly status: number;

    constructor(message: string, status = 403) {
        super(message);
        this.name = "UploadAuthorizationError";
        this.status = status;
    }
}
