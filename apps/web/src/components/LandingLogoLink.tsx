import type { AnchorHTMLAttributes } from "react";

import { LANDING_URL } from "~/config/landing";
import { cn } from "~/lib/utils";

type LandingLogoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

/**
 * Wraps the brand mark (and its wordmark, where one is shown). Clicking the
 * logo always goes to the public site, from every surface that shows it: the
 * sign-in chrome, the workspace picker, the sidebar, the collapsed rail, 404.
 *
 * A plain <a>, not next/link: the landing site is apps/landing on another
 * origin, so there is no client route to prefetch. Loading screens render the
 * bare mark instead; a link that exists for a few hundred milliseconds is a
 * mis-click, not a destination.
 */
export function LandingLogoLink({ className, children, ...props }: LandingLogoLinkProps) {
    return (
        <a
            {...props}
            href={LANDING_URL}
            rel="noopener"
            className={cn(
                "focus-visible:ring-brand/50 rounded-md outline-none focus-visible:ring-[3px]",
                className
            )}
        >
            {children}
        </a>
    );
}
