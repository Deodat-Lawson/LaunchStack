/**
 * The one error type the workspace services throw for expected failures.
 *
 * A service raises it with the HTTP status the route should answer with; the
 * route turns it into `{ error }` and everything else into a logged 500. It
 * also lets a service abort a transaction from deep inside a callback and
 * still hand the caller a precise status.
 */

export class WorkspaceError extends Error {
    readonly status: number;
    readonly extra: Record<string, unknown>;

    constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
        super(message);
        this.name = "WorkspaceError";
        this.status = status;
        this.extra = extra;
    }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
    new WorkspaceError(400, message, extra);
export const forbidden = (message = "Forbidden", extra?: Record<string, unknown>) =>
    new WorkspaceError(403, message, extra);
export const notFound = (message = "Not found") => new WorkspaceError(404, message);
export const conflict = (message: string, extra?: Record<string, unknown>) =>
    new WorkspaceError(409, message, extra);
export const gone = (message: string) => new WorkspaceError(410, message);

export function isWorkspaceError(error: unknown): error is WorkspaceError {
    return error instanceof WorkspaceError;
}
