/**
 * Whether an address belongs to OneDrive or SharePoint, and which of the two.
 * Shared on purpose: Add source checks a pasted link before sending it, the
 * items route trusts only its own reading of it, and "Open in OneDrive" /
 * "Open in SharePoint" is worded from the address Microsoft gave for a file.
 *
 * - `*.sharepoint.com` is SharePoint, except a tenant's `-my` host
 *   (`contoso-my.sharepoint.com`), which is OneDrive for work or school.
 * - `onedrive.live.com`, `onedrive.com` and the `1drv.ms` short links are
 *   personal OneDrive.
 * - `*.sharepoint.example` is the development stand-in's tenant. `.example`
 *   is reserved and resolves nowhere, so accepting it opens nothing real.
 */

export type Microsoft365Place = "onedrive" | "sharepoint";

const SHAREPOINT_SUFFIXES = [".sharepoint.com", ".sharepoint.example"] as const;
const ONEDRIVE_HOSTS = new Set(["onedrive.live.com", "onedrive.com", "1drv.ms"]);

/** Which product serves `host`, or null when it is neither. */
export function microsoft365PlaceOfHost(host: string): Microsoft365Place | null {
    const name = host.toLowerCase();
    if (ONEDRIVE_HOSTS.has(name) || name.endsWith(".onedrive.com")) return "onedrive";
    for (const suffix of SHAREPOINT_SUFFIXES) {
        if (!name.endsWith(suffix)) continue;
        const tenant = name.slice(0, -suffix.length);
        if (!tenant || tenant.includes(".")) return null;
        return tenant.endsWith("-my") ? "onedrive" : "sharepoint";
    }
    return null;
}

/**
 * A pasted OneDrive or SharePoint link as the https address to hand to
 * Microsoft, or null when it is not one. A link pasted without its scheme
 * is read as https.
 */
export function microsoft365LinkFrom(raw: string): string | null {
    const text = raw.trim();
    if (!text || /\s/.test(text)) return null;
    let url: URL;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;
    if (!microsoft365PlaceOfHost(url.hostname)) return null;
    // The bare site or drive home names no file or folder.
    if (url.pathname === "/" && !url.search) return null;
    return url.toString();
}
