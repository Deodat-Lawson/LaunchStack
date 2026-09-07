"use client";

/**
 * Dev-only harness: the ConversationViewer against a fixture transcript
 * served from a data: URL — no import, no database, no connector flag.
 */

import { useMemo } from "react";

import { ConversationViewer } from "~/app/employer/documents/components/ConversationViewer";
import type { DocumentType } from "~/app/employer/documents/types";

const FIXTURE = `# Deploy pipeline chat

> Imported Claude Code session \`932ee456-8cca-4c12-86ca-de9103ba0cf8\`.
> project \`/Users/me/LaunchStack\` · branch \`main\`.
> 2026-08-27 02:20 → 2026-08-27 03:11.
> Not imported: 166 thinking blocks, 12 subagent records, 208 harness records.

## User — 2026-08-27 02:20

How should I deploy my app publicly using Azure? Give me the options.

## Assistant

Three options stand out, in increasing order of ceremony:

1. **A single VM with Compose** — cheapest, closest to your local setup.
2. **Azure Container Apps** — managed scale-to-zero.
3. **AKS** — only if you need real orchestration.

> → **Bash** — \`az vm list-sizes --location eastus --output table\`

\`\`\`\`
Name              vCPUs    MemoryGB
Standard_D2as_v7  2        8
Standard_D4as_v7  4        16
\`\`\`\`

Given your traffic, the \`D2as_v7\` route is the cheapest that fits. Here is a
compose overlay that pins the worker's memory:

\`\`\`yaml
services:
  worker:
    mem_limit: 2g
\`\`\`

## User — 2026-08-27 02:41

Go with the single VM. Set it up.

## Assistant

Done — the VM is provisioned and the stack is live.

> → **Write** — \`/Users/me/LaunchStack/compose.lean.yml\`

\`\`\`\`
Wrote 42 lines to compose.lean.yml… [+1382 chars]
\`\`\`\`
`;

export function ConversationViewerPreview() {
    const doc = useMemo<DocumentType>(
        () => ({
            id: 1,
            title: "Deploy pipeline chat",
            category: "Agent Sessions",
            url: `data:text/markdown;charset=utf-8,${encodeURIComponent(FIXTURE)}`,
            mimeType: "text/markdown",
            ocrMetadata: {
                connector: "agent-sessions",
                tool: "claude-code",
                sessionId: "932ee456-8cca-4c12-86ca-de9103ba0cf8",
                projectPath: "/Users/me/LaunchStack",
                gitBranch: "main",
                startedAt: "2026-08-27T02:20:45.256Z",
                endedAt: "2026-08-27T03:11:02.000Z",
                dropped: { thinking: 166, sidechain: 12, metadata: 208, unknown: 0, malformed: 0 },
            },
        }),
        []
    );

    return (
        <div className="bg-surface h-dvh">
            <ConversationViewer document={doc} />
        </div>
    );
}
