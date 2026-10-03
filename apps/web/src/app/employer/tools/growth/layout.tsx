import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { ProspectsProvider } from "./prospects/_lib/context";

/**
 * Growth: two tool pages, Brand and Prospects, plus a landing page that
 * opens either. No rail of its own: each page is laid out like the other
 * tools (a header, then the workspace), details open in a side panel, and
 * the shell's back bar is the way out. Design rules are in ./DESIGN.md.
 */
export default function GrowthLayout({ children }: { children: React.ReactNode }) {
    return (
        <ToolsStudioShell>
            <ProspectsProvider basePath="/employer/tools/growth/prospects">
                {children}
            </ProspectsProvider>
        </ToolsStudioShell>
    );
}
