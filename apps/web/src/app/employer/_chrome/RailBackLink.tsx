"use client";

import { usePathname } from "next/navigation";

import { BackButton } from "./BackButton";
import { backTargetFor, type BackTarget } from "./backTarget";

/**
 * The way back, in a sidebar's own header rather than across the top of the
 * page.
 *
 * Rendering it is the whole contract: `DriftShell.module.css` hides the
 * shell's `BackBar` — and gives its height back to immersive shells —
 * whenever a `[data-rail-back]` is in the page. A collapsed sidebar, or a
 * page without one, therefore falls back to the bar by itself and never ends
 * up with no way back. CSS rather than a context so it is right in the
 * server-rendered HTML, with no flash of both.
 *
 * `target` overrides the route's parent. A sidebar that is an app's own
 * navigation passes the app's exit, since moving around inside the app is
 * what the rest of the sidebar is for.
 */
export function RailBackLink({ target, className }: { target?: BackTarget; className?: string }) {
    const pathname = usePathname();
    const resolved = target ?? backTargetFor(pathname ?? "");
    if (!resolved) return null;
    return (
        <BackButton
            to={resolved}
            className={className}
            data-rail-back
            data-testid="rail-back-link"
        />
    );
}
