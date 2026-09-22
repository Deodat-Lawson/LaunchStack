"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "~/lib/utils";

import { backTargetFor, type BackTarget } from "./backTarget";
import styles from "./RailBackLink.module.css";

/**
 * The way back, in the sidebar header rather than across the top of the page.
 *
 * The shell's `BackBar` guarantees every page a way up, but as a full-width
 * strip it spent 38px of every screen on a single link and sat above sidebars
 * that already own the top-left corner. A page with a sidebar puts this in
 * the sidebar's header instead, where the eye already goes to navigate.
 *
 * Rendering it is the whole contract: `DriftShell.module.css` hides the bar —
 * and gives its height back to immersive shells — whenever a
 * `[data-rail-back]` is in the page. So a collapsed sidebar, or a page that
 * has none, falls back to the bar on its own and never ends up with no way
 * back at all. That is also why this is CSS rather than a context: it is
 * right in the server-rendered HTML, with no flash of both.
 *
 * `target` overrides the route's parent. A rail that is an app's own
 * navigation passes the app's exit, since moving around inside the app is
 * what the rest of the rail is for.
 */
export function RailBackLink({ target, className }: { target?: BackTarget; className?: string }) {
    const pathname = usePathname();
    const resolved = target ?? backTargetFor(pathname ?? "");
    if (!resolved) return null;

    return (
        <Link
            href={resolved.href}
            data-rail-back
            data-testid="rail-back-link"
            aria-label={`Back to ${resolved.label}`}
            className={cn(styles.link, className)}
        >
            <ArrowLeft aria-hidden className={styles.icon} />
            <span className={styles.label}>{resolved.label}</span>
        </Link>
    );
}
