/** @jest-environment jsdom */

/**
 * The New scenario form, in the real Scenarios tab over the harness's
 * simulator. What it pins: workspace files are picked in a dialog that lists
 * the company's own files first and will not take one that could not be read;
 * a picked file shows in the "What happens if…" box; an upload goes into the
 * Company folder, is attached at once, and holds the run until it has been
 * read; a file that is not a document is refused before anything is stored;
 * and the run is started with every attached file.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    TIMING,
    resetScenariosSim,
    simulateScenarios,
    simulateUpload,
} from "~/app/dev/scenarios/scenarios-sim";
import { ScenariosTool } from "~/app/employer/tools/scenarios/ScenariosTool";
import type { ToolHost } from "~/components/tool-app/nav";

/** jsdom has no fetch `Response`; the simulator and the API clients need this much of one. */
class ShimResponse {
    readonly status: number;
    readonly ok: boolean;
    private readonly body: string;
    constructor(body?: unknown, init?: { status?: number }) {
        this.body = typeof body === "string" ? body : "";
        this.status = init?.status ?? 200;
        this.ok = this.status >= 200 && this.status < 300;
    }
    text() {
        return Promise.resolve(this.body);
    }
    json(): Promise<unknown> {
        return Promise.resolve(JSON.parse(this.body));
    }
}

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

interface Sent {
    path: string;
    method: string;
    body: unknown;
}
let sent: Sent[] = [];

beforeAll(() => {
    if (typeof globalThis.Response === "undefined") {
        Object.assign(globalThis, { Response: ShimResponse });
    }
    if (typeof globalThis.ResizeObserver === "undefined") {
        Object.assign(globalThis, { ResizeObserver: NoopResizeObserver });
    }
    Object.assign(globalThis, {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const raw =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const url = new URL(raw, "http://scenarios.local");
            sent.push({
                path: url.pathname,
                method: (init?.method ?? "GET").toUpperCase(),
                body:
                    typeof init?.body === "string"
                        ? (JSON.parse(init.body) as unknown)
                        : init?.body,
            });
            const response =
                (await simulateUpload(url, init, Date.now())) ??
                (await simulateScenarios(url, init, Date.now()));
            if (!response) throw new Error(`not simulated: ${raw}`);
            return response;
        },
    });
});

beforeEach(() => {
    jest.useFakeTimers();
    sent = [];
    resetScenariosSim();
});

afterEach(() => {
    jest.useRealTimers();
});

function mount() {
    const host: ToolHost = { active: true, request: { at: "/new", nonce: 1 }, openHref: jest.fn() };
    render(<ScenariosTool host={host} />);
}

const subjectBox = () => screen.findByLabelText("What happens if…");
const runButton = () => screen.getByRole("button", { name: /run scenario/i });
const attached = () => screen.getByRole("list", { name: "Attached files" });

async function describeSituation(text: string) {
    fireEvent.change(await subjectBox(), { target: { value: text } });
}

/** Run was pressed: the create call went out, and the run it started opened in the tab. */
async function startedWith(documentIds: number[]) {
    await waitFor(() => expect(created()?.sources.documentIds).toEqual(documentIds));
    await waitFor(() =>
        expect(screen.queryByLabelText("What happens if…")).not.toBeInTheDocument()
    );
    expect(await screen.findAllByText(/gathering|casting|round/i)).not.toHaveLength(0);
}

function created(): { sources: { documentIds: number[] } } | undefined {
    return sent.find(s => s.path === "/api/scenarios" && s.method === "POST")?.body as
        | { sources: { documentIds: number[] } }
        | undefined;
}

describe("New scenario", () => {
    it("picks workspace files from a dialog that lists the company's files first", async () => {
        mount();
        await describeSituation("We raise prices 20% for new customers in January.");

        fireEvent.click(screen.getByRole("button", { name: /choose from your files/i }));
        const dialog = await screen.findByRole("dialog", { name: "Choose files" });
        const company = await within(dialog).findByRole("region", { name: "Company files" });
        const other = within(dialog).getByRole("region", { name: "Other files" });
        expect(within(company).getByText("Pricing & plans 2026.pdf")).toBeInTheDocument();
        expect(within(company).getByText("Board update — October.pdf")).toBeInTheDocument();
        expect(within(other).getByText("Churn notes Q3.docx")).toBeInTheDocument();
        expect(
            company.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();

        // A file that could not be read gives the people nothing, so it cannot be picked.
        expect(
            within(dialog).getByRole("checkbox", { name: /scanned lease agreement/i })
        ).toBeDisabled();

        fireEvent.click(within(dialog).getByRole("checkbox", { name: /pricing & plans 2026/i }));
        fireEvent.click(within(dialog).getByRole("checkbox", { name: /churn notes q3/i }));
        expect(within(dialog).getByText("2 of 20 picked")).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(within(attached()).getByText("Pricing & plans 2026.pdf")).toBeInTheDocument();
        expect(within(attached()).getByText("Churn notes Q3.docx")).toBeInTheDocument();

        // Taking one out of the box un-picks it.
        fireEvent.click(screen.getByRole("button", { name: "Remove Churn notes Q3.docx" }));
        expect(within(attached()).queryByText("Churn notes Q3.docx")).not.toBeInTheDocument();

        await waitFor(() => expect(runButton()).toBeEnabled());
        fireEvent.click(runButton());
        await startedWith([336]);
    });

    it("files an upload in the Company folder and holds the run until it has been read", async () => {
        mount();
        await describeSituation("A competitor launches a free version of our product.");

        const upload = new File(["Our Q4 pricing"], "Q4 pricing.pdf", {
            type: "application/pdf",
        });
        fireEvent.change(screen.getByLabelText("Upload files about the situation"), {
            target: { files: [upload] },
        });

        // Attached at once, while it uploads; then a workspace file being read.
        expect(within(attached()).getByText("Q4 pricing.pdf")).toBeInTheDocument();
        expect(await within(attached()).findByText("Being read")).toBeInTheDocument();
        expect(within(attached()).getByText("Q4 pricing.pdf")).toBeInTheDocument();
        const registered = sent.find(s => s.path === "/api/uploadDocument");
        expect(registered?.body).toMatchObject({
            documentName: "Q4 pricing.pdf",
            category: "Company",
        });

        // Still being read: the people could not use it yet.
        expect(runButton()).toBeDisabled();
        expect(screen.getByText(/waiting for a file to be read/i)).toBeInTheDocument();

        // The form asks again while it waits; once read, the run can start.
        await act(async () => {
            jest.advanceTimersByTime(TIMING.reading + 3500);
        });
        await waitFor(() =>
            expect(within(attached()).queryByText("Being read")).not.toBeInTheDocument()
        );
        await waitFor(() => expect(runButton()).toBeEnabled());

        fireEvent.click(runButton());
        await startedWith([900]);
    });

    it("refuses a file that is not a document before storing anything", async () => {
        mount();
        await subjectBox();

        fireEvent.change(screen.getByLabelText("Upload files about the situation"), {
            target: { files: [new File(["…"], "voice memo.mp3", { type: "audio/mpeg" })] },
        });

        expect(
            await screen.findByText(/not a document this form reads/i, { exact: false })
        ).toBeInTheDocument();
        expect(sent.some(s => s.path === "/api/upload-local")).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Dismiss voice memo.mp3" }));
        expect(screen.queryByText("voice memo.mp3")).not.toBeInTheDocument();
    });

    it("starts a situation from a suggestion and reads it back in the summary", async () => {
        mount();
        await subjectBox();

        fireEvent.click(
            screen.getByRole("button", { name: "We move support from phone to chat only." })
        );
        expect(await subjectBox()).toHaveValue("We move support from phone to chat only.");
        expect(
            screen.getByText("What happens if we move support from phone to chat only.")
        ).toBeInTheDocument();
    });
});
