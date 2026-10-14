/**
 * What the join pages (`/join/<code>`, `/invite/<token>`) hand themselves and
 * the workspace across a sign-in, kept in this tab's sessionStorage.
 *
 * - The **intent** says "this person started signing in *from this join page*,
 *   so join the moment they're back". It is what lets a new person go from
 *   link to workspace without a second Join click. It lives in sessionStorage
 *   on purpose: another site can link someone to a join page, but it cannot
 *   write this tab's storage — so a signed-in person who merely opens a link
 *   still has to click Join, and can't be dropped into a stranger's workspace.
 * - The **welcome** is the one-time "You joined X" note the workspace shows on
 *   arrival.
 *
 * Storage can be missing or throw (private windows, blocked site data); every
 * read and write here degrades to "nothing stored", which only costs a click.
 */

const INTENT_KEY = "ls:join-intent";
const WELCOME_KEY = "ls:join-welcome";

/** Long enough for an OAuth round trip or a password-manager detour, no longer. */
export const JOIN_INTENT_TTL_MS = 30 * 60 * 1000;

export type JoinSourceKind = "link" | "invite";

interface StoredIntent {
    kind: JoinSourceKind;
    key: string;
    at: number;
}

export interface JoinWelcome {
    workspaceName: string;
    roleName: string;
    invitedBy: string | null;
}

function storage(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.sessionStorage;
    } catch {
        return null;
    }
}

function read(key: string): unknown {
    try {
        const raw = storage()?.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        return null;
    }
}

function write(key: string, value: unknown): void {
    try {
        storage()?.setItem(key, JSON.stringify(value));
    } catch {
        // Nothing stored: the person clicks Join themselves.
    }
}

function remove(key: string): void {
    try {
        storage()?.removeItem(key);
    } catch {
        // Already unreadable, so already gone as far as we're concerned.
    }
}

/** Called the moment someone starts signing in or up from a join page. */
export function rememberJoinIntent(kind: JoinSourceKind, key: string, now = Date.now()): void {
    write(INTENT_KEY, { kind, key, at: now } satisfies StoredIntent);
}

/**
 * True when this tab started signing in from the join page for this exact
 * link within the last half hour. Reading does not consume it: the join page
 * clears it once the server has answered the join, so a request cut off by a
 * navigation is simply retried by the page that loads next. A stale intent is
 * dropped here; one for another link is left for that link.
 */
export function hasJoinIntent(kind: JoinSourceKind, key: string, now = Date.now()): boolean {
    const stored = read(INTENT_KEY);
    if (!stored || typeof stored !== "object") return false;
    const intent = stored as Partial<StoredIntent>;
    if (
        typeof intent.at !== "number" ||
        now - intent.at < 0 ||
        now - intent.at > JOIN_INTENT_TTL_MS
    ) {
        remove(INTENT_KEY);
        return false;
    }
    return (
        intent.kind === kind &&
        typeof intent.key === "string" &&
        intent.key.toLowerCase() === key.toLowerCase()
    );
}

export function clearJoinIntent(): void {
    remove(INTENT_KEY);
}

export function leaveJoinWelcome(welcome: JoinWelcome): void {
    write(WELCOME_KEY, welcome);
}

/** The welcome left by a join page, once; null when there is none. */
export function takeJoinWelcome(): JoinWelcome | null {
    const stored = read(WELCOME_KEY);
    remove(WELCOME_KEY);
    if (!stored || typeof stored !== "object") return null;
    const welcome = stored as Partial<JoinWelcome>;
    if (typeof welcome.workspaceName !== "string" || typeof welcome.roleName !== "string") {
        return null;
    }
    return {
        workspaceName: welcome.workspaceName,
        roleName: welcome.roleName,
        invitedBy: typeof welcome.invitedBy === "string" ? welcome.invitedBy : null,
    };
}

/**
 * A full navigation into the workspace, not a client-side push: the
 * middleware re-reads memberships, and the server picks up the
 * active-workspace cookie the accept route just set.
 */
export function enterWorkspace(href: string): void {
    window.location.assign(href);
}
