/**
 * The one error type the workspace services throw for expected failures.
 *
 * A service raises it with the HTTP status the route should answer with; the
 * route turns it into `{ error }` and everything else into a logged 500. It
 * also lets a service abort a transaction from deep inside a callback and
 * still hand the caller a precise status.
 *
 * The sentence is a `Copy` (a message key and its values) where a screen
 * shows it: `message` is its English, and `workspaceErrorResponse` words it
 * in the reader's language.
 */

import { copy, type Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

export type ErrorText = string | Copy;

export class WorkspaceError extends Error {
    readonly status: number;
    readonly extra: Record<string, unknown>;
    readonly copy: Copy | null;

    constructor(status: number, message: ErrorText, extra: Record<string, unknown> = {}) {
        super(typeof message === "string" ? message : englishCopy(message));
        this.name = "WorkspaceError";
        this.status = status;
        this.extra = extra;
        this.copy = typeof message === "string" ? null : message;
    }
}

export const badRequest = (message: ErrorText, extra?: Record<string, unknown>) =>
    new WorkspaceError(400, message, extra);
export const forbidden = (
    message: ErrorText = copy("errors.api.forbidden"),
    extra?: Record<string, unknown>
) => new WorkspaceError(403, message, extra);
export const notFound = (message: ErrorText = copy("errors.api.notFound")) =>
    new WorkspaceError(404, message);
export const conflict = (message: ErrorText, extra?: Record<string, unknown>) =>
    new WorkspaceError(409, message, extra);
export const gone = (message: ErrorText) => new WorkspaceError(410, message);

export function isWorkspaceError(error: unknown): error is WorkspaceError {
    return error instanceof WorkspaceError;
}
