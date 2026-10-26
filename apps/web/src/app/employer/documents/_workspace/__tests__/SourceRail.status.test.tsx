/** @jest-environment jsdom */

import React, { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ContextMenuProvider } from "~/components/context-menu";
import type { SourceProcessingView } from "~/lib/source-progress";
import { SourceRail } from "../SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "../types";

/**
 * A source still processing shows how far along it is; a failed one says
 * what went wrong in words, offers Retry where retrying could help, and
 * points at support where it can't.
 */

jest.mock("~/lib/profile/use-people", () => ({ usePeople: () => ({}) }));

const QUOTA_429 =
    'pipeline event dead: OpenAI API error: 429 - [{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}]';

function processing(overrides: Partial<SourceProcessingView> = {}): SourceProcessingView {
    return {
        jobId: "job-1",
        status: "processing",
        progress: null,
        retryCount: 0,
        retry: null,
        ...overrides,
    };
}

function src(id: string, overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title: `${id}.pdf`,
        type: "doc",
        size: "",
        added: "",
        folder: "Unfiled",
        tags: [],
        domain: "General",
        ...overrides,
    };
}

const FOLDERS: WorkspaceFolder[] = [{ id: "f-Unfiled", name: "Unfiled", color: "x" }];

function Harness({
    sources,
    onRetrySource,
    onOpenSource = jest.fn(),
}: {
    sources: WorkspaceSource[];
    onRetrySource?: (source: WorkspaceSource) => Promise<void>;
    onOpenSource?: (source: WorkspaceSource) => void;
}) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={sources}
                folders={FOLDERS}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={jest.fn()}
                onOpenSource={onOpenSource}
                onRetrySource={onRetrySource}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
            />
        </ContextMenuProvider>
    );
}

describe("SourceRail status line", () => {
    it("shows the stage, a bar and the percent the worker reported", () => {
        render(
            <Harness
                sources={[
                    src("d1", {
                        indexStatus: "processing",
                        processing: processing({
                            progress: {
                                stage: "embedding",
                                done: 120,
                                total: 267,
                                updatedAt: "2026-10-23T12:00:00Z",
                            },
                        }),
                    }),
                ]}
            />
        );
        const status = screen.getByTestId("source-progress-d1");
        expect(status).toHaveTextContent("Embedding 120/267");
        expect(status).toHaveTextContent("61%");
        expect(within(status).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "61");
        expect(screen.queryByText("syncing…")).not.toBeInTheDocument();
    });

    it("shows no number before anything was reported", () => {
        render(<Harness sources={[src("d1", { indexStatus: "processing" })]} />);
        const status = screen.getByTestId("source-progress-d1");
        expect(status).toHaveTextContent("Syncing…");
        expect(within(status).queryByRole("progressbar")).not.toBeInTheDocument();
        expect(status).not.toHaveTextContent("%");
    });

    it("says what failed in words, never the provider's JSON", () => {
        render(
            <Harness
                sources={[
                    src("d1", {
                        indexStatus: "failed",
                        errorMessage: QUOTA_429,
                        processing: processing({ status: "failed" }),
                    }),
                ]}
            />
        );
        const row = screen.getByTestId("source-row-d1");
        expect(row).toHaveTextContent("Usage limit hit");
        expect(row).not.toHaveTextContent("RESOURCE_EXHAUSTED");
    });

    it("retries from the row without opening the source", async () => {
        const user = userEvent.setup();
        const onRetrySource = jest.fn().mockResolvedValue(undefined);
        const onOpenSource = jest.fn();
        const failed = src("d1", {
            indexStatus: "failed",
            errorMessage: QUOTA_429,
            processing: processing({ status: "failed" }),
        });
        render(
            <Harness sources={[failed]} onRetrySource={onRetrySource} onOpenSource={onOpenSource} />
        );

        await user.click(screen.getByTestId("source-retry-d1"));

        expect(onRetrySource).toHaveBeenCalledWith(failed);
        expect(onOpenSource).not.toHaveBeenCalled();
    });

    it("explains the failure, with the raw error only behind Details", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                onRetrySource={jest.fn().mockResolvedValue(undefined)}
                sources={[
                    src("d1", {
                        indexStatus: "failed",
                        errorMessage: QUOTA_429,
                        processing: processing({ status: "failed" }),
                    }),
                ]}
            />
        );

        await user.click(screen.getByTestId("source-failure-d1"));

        const card = await screen.findByRole("dialog");
        expect(card).toHaveTextContent(
            "The embedding service is over its usage limit. Try again in a few minutes."
        );
        expect(within(card).getByRole("button", { name: /Retry/ })).toBeInTheDocument();
        // A first failure that retrying may fix: no support detour yet.
        expect(within(card).queryByRole("link", { name: /Contact us/ })).not.toBeInTheDocument();
        expect(card).not.toHaveTextContent("RESOURCE_EXHAUSTED");

        await user.click(within(card).getByRole("button", { name: /Details/ }));
        expect(card).toHaveTextContent("RESOURCE_EXHAUSTED");
        expect(card).toHaveTextContent("job-1");
    });

    it("points at support when retrying can't help, with the details in the link", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                onRetrySource={jest.fn().mockResolvedValue(undefined)}
                sources={[
                    src("d7", {
                        title: "Scanned.pdf",
                        indexStatus: "failed",
                        errorMessage:
                            "pipeline event dead: PDF is encrypted and requires a password",
                        processing: processing({ jobId: "job-7", status: "failed" }),
                    }),
                ]}
            />
        );
        expect(screen.queryByTestId("source-retry-d7")).not.toBeInTheDocument();

        await user.click(screen.getByTestId("source-failure-d7"));

        const card = await screen.findByRole("dialog");
        expect(within(card).queryByRole("button", { name: /^Retry$/ })).not.toBeInTheDocument();
        const contact = within(card).getByRole("link", { name: /Contact us about this error/ });
        const params = new URLSearchParams(contact.getAttribute("href")!.split("?")[1]);
        expect(params.get("document")).toBe("Scanned.pdf");
        expect(params.get("documentId")).toBe("7");
        expect(params.get("category")).toBe("file_unreadable");
        expect(params.get("job")).toBe("job-7");
    });

    it("offers support as well as Retry once a retry has failed again", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                onRetrySource={jest.fn().mockResolvedValue(undefined)}
                sources={[
                    src("d1", {
                        indexStatus: "failed",
                        errorMessage: QUOTA_429,
                        processing: processing({ status: "failed", retryCount: 1 }),
                    }),
                ]}
            />
        );

        await user.click(screen.getByTestId("source-failure-d1"));

        const card = await screen.findByRole("dialog");
        expect(card).toHaveTextContent("It failed again after a retry.");
        expect(within(card).getByRole("button", { name: /Retry/ })).toBeInTheDocument();
        expect(within(card).getByRole("link", { name: /Contact us/ })).toBeInTheDocument();
    });

    it("offers no Retry to someone who can't edit the file, or without the handler", () => {
        const failed = {
            indexStatus: "failed" as const,
            errorMessage: QUOTA_429,
            processing: processing({ status: "failed" }),
        };
        const { unmount } = render(
            <Harness
                onRetrySource={jest.fn()}
                sources={[
                    src("d1", {
                        ...failed,
                        access: {
                            audience: "workspace",
                            ownAudience: false,
                            principalCount: 0,
                            canEdit: false,
                            canManage: false,
                        },
                    }),
                ]}
            />
        );
        expect(screen.queryByTestId("source-retry-d1")).not.toBeInTheDocument();
        unmount();

        render(<Harness sources={[src("d1", failed)]} />);
        expect(screen.queryByTestId("source-retry-d1")).not.toBeInTheDocument();
    });
});
