import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { GrowthShell } from "./_components/GrowthShell";
import { ProspectsProvider } from "./prospects/_lib/context";

/**
 * Growth: one app for making the company known (Brand) and finding the
 * companies that will buy (Prospects). The rail lives here; each route
 * below is one screen. Design rules for this surface are in ./DESIGN.md.
 */
export default function GrowthLayout({ children }: { children: React.ReactNode }) {
    return (
        <ToolsStudioShell>
            <ProspectsProvider basePath="/employer/tools/growth/prospects">
                <GrowthShell>{children}</GrowthShell>
            </ProspectsProvider>
        </ToolsStudioShell>
    );
}
