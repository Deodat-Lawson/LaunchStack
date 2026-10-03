import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { ProposalsShell } from "./_components/ProposalsShell";
import { ProposalsProvider } from "./_lib/context";

/**
 * Proposals: a writing app. Find the funders that fit, turn their call into
 * a checklist, draft every answer from what the workspace's sources prove,
 * review, submit. The rail lives here; each route below is one screen.
 */
export default function ProposalsLayout({ children }: { children: React.ReactNode }) {
    return (
        <ToolsStudioShell>
            <ProposalsProvider basePath="/employer/tools/proposals">
                <ProposalsShell>{children}</ProposalsShell>
            </ProposalsProvider>
        </ToolsStudioShell>
    );
}
