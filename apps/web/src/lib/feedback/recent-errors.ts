/**
 * The last few things that went wrong in this tab, kept so a bug report can
 * say what the page was doing before someone opened it — "it just broke" is
 * hard to fix; "it broke, and the console said `TypeError: … reading 'id'`"
 * often isn't.
 *
 * Three sources: uncaught errors, unhandled promise rejections, and
 * `console.error` (which is where React and our own catch blocks report).
 * Only the message is kept, trimmed; nothing leaves the browser unless the
 * reporter sends it, and the dialog shows the list before they do.
 */

import { FEEDBACK_LIMITS, type RecentError } from "./contract";

const buffer: RecentError[] = [];
let installed = false;

function push(source: string, message: string) {
    const text = message.trim().slice(0, FEEDBACK_LIMITS.errorMessageMax);
    if (!text) return;
    // A render loop logs the same line hundreds of times; one is enough.
    if (buffer.at(-1)?.message === text) return;
    buffer.push({ message: text, source, at: new Date().toISOString() });
    if (buffer.length > FEEDBACK_LIMITS.recentErrorsMax) buffer.shift();
}

function describe(value: unknown): string {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** Start listening. Idempotent; a no-op on the server. */
export function installRecentErrors(): void {
    if (installed || typeof window === "undefined") return;
    installed = true;
    window.addEventListener("error", event => {
        push("error", event.error ? describe(event.error) : event.message);
    });
    window.addEventListener("unhandledrejection", event => {
        push("unhandledrejection", describe(event.reason));
    });
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
        try {
            // React passes a format string first: "%s … %s", then its parts.
            push("console", args.map(describe).join(" "));
        } catch {
            // Recording must never be the thing that breaks logging.
        }
        original(...args);
    };
}

/** Newest last. A copy, so the dialog can drop entries without touching the record. */
export function recentErrors(): RecentError[] {
    return buffer.slice();
}

/** For tests. */
export function clearRecentErrors(): void {
    buffer.length = 0;
}
