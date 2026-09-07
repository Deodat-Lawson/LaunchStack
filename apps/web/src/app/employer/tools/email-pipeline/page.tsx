"use client";

import { Suspense } from "react";

import { EmailPipelineWorkspace } from "~/app/employer/documents/components/email-pipeline/EmailPipelineWorkspace";
import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

export default function EmailPipelinePage() {
    return (
        <Suspense>
            <ToolsStudioShell>
                <main>
                    <EmailPipelineWorkspace />
                </main>
            </ToolsStudioShell>
        </Suspense>
    );
}
