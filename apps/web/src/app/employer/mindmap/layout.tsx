import type { ReactNode } from "react";

import { ToolsStudioShell } from "../_chrome/ToolsStudioShell";

/**
 * Mindmap runs full-height and immersive: the canvas owns the viewport and
 * supplies its own chrome, so the employer shell's scroll container would only
 * fight it.
 */
export default function MindmapLayout({ children }: { children: ReactNode }) {
    return <ToolsStudioShell>{children}</ToolsStudioShell>;
}
