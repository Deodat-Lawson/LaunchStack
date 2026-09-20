"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useBreadcrumbs } from "./BreadcrumbContext";
import { backTargetFor } from "./backTarget";
import styles from "./BackBar.module.css";

/**
 * The one way back, on every page.
 *
 * Before this, almost nothing under /employer had one: settings, employees,
 * statistics, metadata, upload, and five of the six tools were all dead ends
 * you left by editing the URL or hitting the browser's own button. The two
 * exceptions each invented their own — a "Back to all artifacts" link mid-page,
 * a "Back to Studio" pinned to the bottom of a rail — which is the other half
 * of the problem: even where it existed you had to go and find it.
 *
 * So it lives in the shell, in flow above the page rather than floating over
 * it. In-flow matters: almost every screen here already owns its top-left
 * corner (the Studio rail's logo, the Prospects rail, the settings rail), and
 * a fixed pill would have landed on top of one of them on most pages.
 *
 * It names a destination rather than saying "Back", because it goes *up* the
 * product's hierarchy, not backwards through history — see `backTarget.ts` for
 * why. Any crumbs a page publishes are shown after it, so the bar doubles as
 * the breadcrumb surface that `BreadcrumbContext` has been collecting for and
 * nothing has ever rendered.
 */
export function BackBar() {
    const pathname = usePathname();
    const { crumbs } = useBreadcrumbs();
    const target = backTargetFor(pathname ?? "");

    if (!target) return null;

    // The first crumb is always the app name, which the bar does not repeat.
    const trail = crumbs.slice(1).filter(Boolean);

    return (
        <div className={styles.bar} data-testid="back-bar">
            <Link
                href={target.href}
                className={styles.back}
                data-testid="back-bar-link"
                aria-label={`Back to ${target.label}`}
            >
                <ArrowLeft aria-hidden className={styles.icon} />
                <span>{target.label}</span>
            </Link>
            {trail.length > 0 && (
                <nav aria-label="Breadcrumb" className={styles.trail}>
                    {trail.map((crumb, i) => (
                        <span key={`${crumb}-${String(i)}`} className={styles.crumb}>
                            <span aria-hidden className={styles.sep}>
                                /
                            </span>
                            {crumb}
                        </span>
                    ))}
                </nav>
            )}
        </div>
    );
}
