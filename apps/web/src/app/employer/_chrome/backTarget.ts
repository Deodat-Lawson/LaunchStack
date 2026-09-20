/**
 * Where "back" goes from any route in the app.
 *
 * Deliberately derived from the path rather than from browser history. History
 * is wrong here in two ordinary situations: a deep link opened in a fresh tab
 * has nothing behind it, and a page reached sideways (a toast link, a redirect
 * after save) would send someone somewhere unrelated to where they are. A
 * computed parent always points *up* the product's own hierarchy, and is the
 * same answer every time from the same page — which is what makes it something
 * you stop thinking about.
 *
 * Pure and framework-free, so the whole table is unit-testable.
 */

export interface BackTarget {
    href: string;
    /** What the control says, e.g. "Studio". A place, never "Back". */
    label: string;
}

/** The workspace's home. Everything that is not a tool falls back to it. */
export const STUDIO: BackTarget = { href: "/employer/documents", label: "Studio" };

/** Above the Studio sits the workspace picker — so even home has somewhere up. */
export const WORKSPACES: BackTarget = { href: "/workspaces", label: "Workspaces" };

/**
 * Sections whose own landing page is the natural parent for everything under
 * it. Order matters: the longest matching prefix wins, so a company detail
 * page goes to the company list rather than to the tool's home.
 */
const SECTION_PARENTS: ReadonlyArray<{ prefix: string; target: BackTarget }> = [
    {
        prefix: "/employer/tools/growth/prospects/companies/",
        target: { href: "/employer/tools/growth/prospects/companies", label: "Companies" },
    },
    {
        prefix: "/employer/tools/growth/prospects/",
        target: { href: "/employer/tools/growth/prospects", label: "Prospects" },
    },
    {
        prefix: "/employer/tools/growth/brand/",
        target: { href: "/employer/tools/growth/brand", label: "Brand" },
    },
    // Both halves of Growth sit under it, so anything else there goes to the
    // app's own home rather than all the way out to the Studio.
    {
        prefix: "/employer/tools/growth/",
        target: { href: "/employer/tools/growth", label: "Growth" },
    },
    // `/employer/tools/prospects/*` is the old location, kept as a redirect
    // shim. Send it to where Prospects actually lives now.
    {
        prefix: "/employer/tools/prospects",
        target: { href: "/employer/tools/growth/prospects", label: "Prospects" },
    },
    { prefix: "/employer/artifacts/", target: { href: "/employer/artifacts", label: "Artifacts" } },
    { prefix: "/employer/documents/", target: STUDIO },
    { prefix: "/employer/mindmap/", target: STUDIO },
];

/** Routes that are their own top: going up leaves the workspace entirely. */
const ROOTS = new Set(["/employer/documents", "/employer", "/employer/home"]);

function normalise(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
    return pathname;
}

/**
 * The parent of `pathname`, or null when the page is not under /employer at
 * all (sign-in, the marketing shell) and the shell should stay out of the way.
 */
export function backTargetFor(pathname: string): BackTarget | null {
    const path = normalise(pathname);
    if (!path.startsWith("/employer")) return null;

    // The Studio is the workspace's home; above it is the workspace picker.
    if (ROOTS.has(path)) return WORKSPACES;

    for (const { prefix, target } of SECTION_PARENTS) {
        // `!==` guards the section's own landing page, which must not point at
        // itself — /employer/tools/prospects falls through to the Studio.
        if (path.startsWith(prefix) && path !== target.href) return target;
    }

    // Anything else is one level below the Studio: settings, employees,
    // statistics, a tool's landing page. Up is the Studio.
    return STUDIO;
}
