import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { ProspectsShell } from "./_components/ProspectsShell";
import { ProspectsProvider } from "./_lib/context";

/**
 * Prospects: find the companies that would buy what you sell, profile them
 * with cited evidence, find the people, and run the deal. The rail and the
 * segment live here; each route below is one screen. Design rules for this
 * surface are in ./DESIGN.md.
 */
export default function ProspectsLayout({ children }: { children: React.ReactNode }) {
    return (
        <ToolsStudioShell>
            <ProspectsProvider basePath="/employer/tools/prospects">
                <ProspectsShell>{children}</ProspectsShell>
            </ProspectsProvider>
        </ToolsStudioShell>
    );
}
