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

/**
 * Sections whose own landing page is the natural parent for everything under
 * it. Order matters: the longest matching prefix wins, so a company detail
 * page goes to the company list rather than to the tool's home.
 */
const SECTION_PARENTS: ReadonlyArray<{ prefix: string; target: BackTarget }> = [
    // No tool is here. Growth, Proposals and Vantage were pages with their
    // own sections once; they are tabs of the workspace now, their old URLs
    // only redirect into the tab, and "back" inside a tool is the tab's own
    // history (components/tool-app).
    { prefix: "/employer/documents/", target: STUDIO },
    { prefix: "/employer/mindmap/", target: STUDIO },
];

/**
 * Routes that are the top of the app, with nothing above them to go back to.
 *
 * The workspace picker is not their parent. A workspace is a whole separate
 * environment — other people, other documents — so leaving one is switching,
 * not going back, and it lives in Settings rather than behind a back arrow.
 */
const ROOTS = new Set(["/employer/documents", "/employer", "/employer/home"]);

function normalise(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
    return pathname;
}

/**
 * The parent of `pathname`, or null when there is none: the Studio itself,
 * or a page outside /employer (sign-in, the marketing shell) where the shell
 * should stay out of the way.
 */
export function backTargetFor(pathname: string): BackTarget | null {
    const path = normalise(pathname);
    if (!path.startsWith("/employer")) return null;

    // The Studio is the top. Switching workspace is not "back".
    if (ROOTS.has(path)) return null;

    for (const { prefix, target } of SECTION_PARENTS) {
        // `!==` guards the section's own landing page, which must not point at
        // itself.
        if (path.startsWith(prefix) && path !== target.href) return target;
    }

    // Anything else is one level below the Studio: settings, employees,
    // statistics, an old tool page on its way into the Studio. Up is the
    // Studio.
    return STUDIO;
}
