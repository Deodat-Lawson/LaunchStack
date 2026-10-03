"use client";

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";

import { useToolNav } from "./nav";

export type ToolLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    /** App-relative ("/prospects/companies"), query-only ("?view=new"), or any site href. */
    href: string;
    replace?: boolean;
    /** Accepted for parity with `next/link`; a tab has nothing to prefetch. */
    prefetch?: boolean;
    /** Accepted for parity with `next/link`; the frame owns scrolling. */
    scroll?: boolean;
};

/**
 * `next/link` for tool screens. It is a real anchor whose href is the
 * shareable URL of the screen, so ⌘-click, middle-click and "Copy link"
 * behave like any link on the web — and a plain click moves inside the tab
 * instead of leaving the workspace.
 */
export const ToolLink = forwardRef<HTMLAnchorElement, ToolLinkProps>(function ToolLink(
    { href, replace, prefetch: _prefetch, scroll: _scroll, onClick, target, ...rest },
    ref
) {
    const { navigate, linkFor } = useToolNav();
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        // Let the browser have anything that asks for a new tab or window.
        if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            (target && target !== "_self")
        ) {
            return;
        }
        event.preventDefault();
        navigate(href, { replace });
    };
    return <a ref={ref} href={linkFor(href)} target={target} onClick={handleClick} {...rest} />;
});
