/** @jest-environment jsdom */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { SessionsBrowser } from "~/app/employer/agent-sessions/_sessions/ui/SessionsBrowser";
import {
    fetchSessionsPreview,
    importSessions,
} from "~/app/employer/agent-sessions/_sessions/lib/api";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("~/app/employer/agent-sessions/_sessions/lib/api", () => ({
    fetchSessionsPreview: jest.fn(),
    importSessions: jest.fn(),
    importAllSessions: jest.fn(),
}));

it("keeps imported transcript actions unavailable until the workspace refresh finishes", async () => {
    const sourceId = "agent-sessions://codex/aaaaaaaa-1111-4111-8111-111111111111";
    jest.mocked(fetchSessionsPreview).mockResolvedValue({
        enabled: true,
        roots: [{ toolId: "codex", dir: "/sessions", exists: true, sessionCount: 1 }],
        truncated: false,
        skipped: [],
        items: [
            {
                sourceId,
                tool: "codex",
                title: "Imported conversation",
                preview: null,
                projectSlug: null,
                projectPath: null,
                gitBranch: null,
                bytes: 100,
                modifiedAt: "2026-01-01T00:00:00Z",
                relativePath: "session.jsonl",
                archived: false,
                active: false,
                imported: null,
            },
        ],
    });
    jest.mocked(importSessions).mockResolvedValue({
        counts: { discovered: 1, stored: 1, created: 1, revised: 0, skipped: 0, failed: 0 },
        stored: [{ sourceId, documentId: 42, versionId: 1, revised: false }],
        skipped: [],
        failed: [],
        missing: [],
    });
    let finishRefresh!: () => void;
    const refresh = new Promise<void>(resolve => {
        finishRefresh = resolve;
    });
    const user = userEvent.setup();
    render(<SessionsBrowser onImported={() => refresh} />);

    await user.click(await screen.findByRole("button", { name: "Import" }));

    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();

    await act(async () => {
        finishRefresh();
        await refresh;
    });

    expect(await screen.findByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});
