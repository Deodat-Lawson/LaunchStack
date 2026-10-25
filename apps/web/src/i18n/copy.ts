/**
 * A sentence the server writes, carried as its message key and values rather
 * than as words, so it can be worded in the reader's language where the
 * response is made: an error a service throws far below the route
 * (`WorkspaceError`), a label a DTO sends to a screen.
 *
 * Free of the catalogues, so client code can name the shape a DTO carries.
 * Wording it is `wordCopy` / `englishCopy` in ./translate (server).
 */

import type { MessageKeys, NestedKeyOf } from "use-intl";

import type { Messages } from "./messages";

/** Any message key, dotted from the namespace: `"growth.server.errors.noSegment"`. */
export type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

export type CopyValues = Record<string, string | number | Date>;

export interface Copy {
    key: MessageKey;
    values?: CopyValues;
}

/** `{ key, values }`, typed. */
export function copy(key: MessageKey, values?: CopyValues): Copy {
    return values ? { key, values } : { key };
}

export function isCopy(value: unknown): value is Copy {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { key?: unknown }).key === "string"
    );
}
