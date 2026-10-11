/**
 * Turns whatever someone pastes into "I have an invite" — a `/join/<code>`
 * link, an `/invite/<token>` link, a legacy `/signup?code=` link, or just the
 * code — into the page that handles it. Only the path is kept, so a pasted
 * link from another host still lands on this origin's join page.
 */

/** Join codes are hex: 8 characters (legacy) or 32. */
const CODE = /^[0-9A-Fa-f]{8,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;

export function inviteDestination(input: string): string | null {
    const raw = input.trim();
    if (!raw) return null;

    // A bare code, with or without the dashes people add when retyping it.
    const bare = raw.replace(/[\s-]/g, "");
    if (CODE.test(bare)) return `/join/${bare.toLowerCase()}`;

    let url: URL;
    try {
        url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {
        return null;
    }
    const join = /^\/join\/([^/]+)\/?$/.exec(url.pathname);
    if (join && CODE.test(join[1]!)) return `/join/${join[1]!.toLowerCase()}`;
    const invite = /^\/invite\/([^/]+)\/?$/.exec(url.pathname);
    if (invite && TOKEN.test(invite[1]!)) return `/invite/${invite[1]}`;
    const legacy = url.pathname === "/signup" ? url.searchParams.get("code")?.trim() : null;
    if (legacy && CODE.test(legacy)) return `/join/${legacy.toLowerCase()}`;
    return null;
}
