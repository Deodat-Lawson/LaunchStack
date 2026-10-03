/** The origin a page request came in on, for showing absolute stand-in URLs. */
export function requestOrigin(h: Headers): string {
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000")
        .split(",")[0]!
        .trim();
    const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
    return `${proto}://${host}`;
}
