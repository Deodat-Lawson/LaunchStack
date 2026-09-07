import type { ReactNode } from "react";

import { ToolsStudioShell } from "../_chrome/ToolsStudioShell";

/** The sessions browser scrolls inside the full-height tools shell. */
export default function AgentSessionsLayout({ children }: { children: ReactNode }) {
    return <ToolsStudioShell>{children}</ToolsStudioShell>;
}
