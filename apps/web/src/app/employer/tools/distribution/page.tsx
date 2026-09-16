"use client";

import { ToolsStudioShell } from "~/app/employer/_chrome/ToolsStudioShell";

import { DistributionApp } from "./components/DistributionApp";

export default function DistributionPage() {
    return (
        <ToolsStudioShell>
            <DistributionApp />
        </ToolsStudioShell>
    );
}
