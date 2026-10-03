import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { VantageShell } from "./_components/VantageShell";

/**
 * Vantage: the evidence-backed weekly meeting loop. The rail lives here;
 * each route below is one screen. Design rules follow Growth's DESIGN.md.
 */
export default function VantageLayout({ children }: { children: React.ReactNode }) {
    return (
        <ToolsStudioShell>
            <VantageShell>{children}</VantageShell>
        </ToolsStudioShell>
    );
}
