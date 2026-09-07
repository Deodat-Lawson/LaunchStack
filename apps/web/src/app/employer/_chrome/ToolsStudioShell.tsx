"use client";

import type { ReactNode } from "react";

/**
 * Full-height wrapper for standalone tool routes. Navigation lives inside Studio controls.
 *
 * `dvh` rather than `vh`: on mobile browsers `100vh` is the viewport with the
 * URL bar retracted, so a tool that fills it puts its own bottom chrome — the
 * mindmap's zoom bar, for one — underneath the browser's.
 */
export function ToolsStudioShell({ children }: { children: ReactNode }) {
    return (
        <div
            data-drift-immersive="true"
            style={{
                display: "flex",
                height: "100dvh",
                width: "100%",
                overflow: "hidden",
                position: "relative",
            }}
        >
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {children}
            </div>
        </div>
    );
}
