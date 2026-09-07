import type { ReactNode } from "react";

import { ToolsStudioShell } from "../_chrome/ToolsStudioShell";

/**
 * Artifacts run full-height like Mindmap: the viewer's sandboxed iframe owns
 * the viewport, and the gallery scrolls inside the shell.
 */
export default function ArtifactsLayout({ children }: { children: ReactNode }) {
    return <ToolsStudioShell>{children}</ToolsStudioShell>;
}
