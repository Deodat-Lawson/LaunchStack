/**
 * One browser, several accounts, many tabs: the session cookie is shared, so
 * switching account in one tab changes who every other tab acts as. Tabs tell
 * each other when that happens, so each can stop and say so
 * (~/components/auth/AccountChangeGuard) instead of carrying on as someone
 * else.
 *
 * BroadcastChannel where there is one, and a localStorage write as well: the
 * `storage` event reaches other tabs in browsers without BroadcastChannel.
 * A message only says "check": each tab asks the server who it is now.
 */

const CHANNEL = "launchstack-account";
const STORAGE_KEY = "launchstack:account-changed";

/** This tab, so it ignores its own announcements (a channel hears itself across instances). */
const TAB_ID =
    typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

type Message = { type: "account-changed"; from: string };

/** Tell the other tabs the active account may have changed. */
export function announceAccountChange(): void {
    const message: Message = { type: "account-changed", from: TAB_ID };
    try {
        const channel = new BroadcastChannel(CHANNEL);
        channel.postMessage(message);
        channel.close();
    } catch {
        // No BroadcastChannel: the storage event below still gets through.
    }
    try {
        localStorage.setItem(STORAGE_KEY, `${TAB_ID}:${Date.now()}`);
    } catch {
        // Storage off (private mode): focus and visibility checks remain.
    }
}

/** Calls `listener` when another tab announces a change; returns the unsubscribe. */
export function onAccountChange(listener: () => void): () => void {
    let channel: BroadcastChannel | null = null;
    try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (event: MessageEvent<Message>) => {
            if (event.data?.type === "account-changed" && event.data.from !== TAB_ID) listener();
        };
    } catch {
        channel = null;
    }
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY && !event.newValue?.startsWith(`${TAB_ID}:`)) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
        channel?.close();
        window.removeEventListener("storage", onStorage);
    };
}

/**
 * Leaves a tab whose account changed: to /signin when nobody is signed in any
 * more, to the workspace picker from a workspace page (it may belong to a
 * workspace the new account can't open), else a plain reload.
 */
export function leaveAfterAccountChange(signedOut: boolean): void {
    if (signedOut) window.location.assign("/signin");
    else if (window.location.pathname.startsWith("/employer"))
        window.location.assign("/workspaces");
    else window.location.reload();
}
