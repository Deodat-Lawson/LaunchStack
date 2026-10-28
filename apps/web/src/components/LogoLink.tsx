import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";

import { LANDING_HREF } from "~/config/landing";
import { WORKSPACE_PATH } from "~/lib/tool-app/locations";
import { cn } from "~/lib/utils";

type LogoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    /** Whether the person looking at the logo is signed in. */
    signedIn: boolean;
};

/**
 * Wraps the brand mark (and its wordmark, where one is shown) on every surface
 * that shows it: the sign-in chrome, the workspace picker, the sidebar, the
 * collapsed rail, 404.
 *
 * Signed in, the logo is the app's home button, as it is in every product
 * people already use: it opens the active workspace. Middleware sends someone
 * with no workspace they may act in on to the picker or the pending-approval
 * page from there. The public site can't see this origin's session, so
 * sending a member there would greet them with "Log in" as if they were a
 * stranger. Sign-out, Help and the deployment guide still reach it.
 *
 * Signed out, the logo leads to the public site, which is where an anonymous
 * visitor came from. It goes by way of `/site`, which redirects to the
 * deployment's landing origin at request time (see ~/config/landing for why
 * the origin can't be written into the href). A plain <a>, not next/link:
 * /site is a route handler that leaves this origin, so there is no client
 * route to prefetch.
 *
 * Loading screens render the bare mark instead; a link that exists for a few
 * hundred milliseconds is a mis-click, not a destination.
 */
export function LogoLink({ signedIn, className, children, ...props }: LogoLinkProps) {
    const classes = cn(
        "focus-visible:ring-brand/50 rounded-md outline-none focus-visible:ring-[3px]",
        className
    );
    if (signedIn) {
        return (
            <Link {...props} href={WORKSPACE_PATH} className={classes}>
                {children}
            </Link>
        );
    }
    return (
        <a {...props} href={LANDING_HREF} className={classes}>
            {children}
        </a>
    );
}
