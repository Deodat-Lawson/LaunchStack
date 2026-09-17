"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ContextTarget as ContextTargetDescriptor } from "~/lib/context-menu";
import { useContextTarget } from "./useContextTarget";

/**
 * Declares a right-click target around children that cannot take the hook
 * themselves — an element rendered inside a `.map`, or markup that must not
 * change. Renders as `display: contents`, so it takes no part in layout.
 */
export function ContextTarget<TData = unknown>({
    target,
    children,
    style,
}: {
    target: ContextTargetDescriptor<TData> | null;
    children: ReactNode;
    style?: CSSProperties;
}) {
    const ctxTarget = useContextTarget(target);
    return (
        <div {...ctxTarget} style={{ display: "contents", ...style }}>
            {children}
        </div>
    );
}
