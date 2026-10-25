import type { AnchorHTMLAttributes } from "react";

import { LANDING_HREF } from "~/config/landing";
import { cn } from "~/lib/utils";

type LandingLogoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

/**
 * Wraps the brand mark (and its wordmark, where one is shown). Clicking the
 * logo always goes to the public site, from every surface that shows it: the
 * sign-in chrome, the workspace picker, the sidebar, the collapsed rail, 404.
 *
 * It goes by way of `/site`, which redirects to the deployment's landing
 * origin at request time (see ~/config/landing for why the origin can't be
 * written into the href). A plain <a>, not next/link: /site is a route handler
 * that leaves this origin, so there is no client route to prefetch. Loading
 * screens render the bare mark instead; a link that exists for a few hundred
 * milliseconds is a mis-click, not a destination.
 */
export function LandingLogoLink({ className, children, ...props }: LandingLogoLinkProps) {
    return (
        <a
            {...props}
            href={LANDING_HREF}
            className={cn(
                "focus-visible:ring-brand/50 rounded-md outline-none focus-visible:ring-[3px]",
                className
            )}
        >
            {children}
        </a>
    );
}
