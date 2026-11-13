/** @jest-environment jsdom */

/**
 * The real Extract tab over the harness's simulator: the list, a finished
 * table's grid (every row state, sorting with blanks last, the popover behind
 * a value, the hand-offs to the chat, a source and an export), a shared table
 * the viewer cannot manage, and the form — arriving with documents chosen,
 * its validation, a starter set, the picker, and Run.
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { configureExtractSim, simulateExtraction } from "~/app/dev/extract/extract-sim";
import { ExtractTool } from "~/app/employer/tools/extract/ExtractTool";
import type { ToolHost } from "~/components/tool-app/nav";

/** jsdom has no fetch `Response`; the simulator and the API client need this much of one. */
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
    Element.prototype.scrollIntoView ??= () => undefined;
    Element.prototype.hasPointerCapture ??= () => false;
    Object.assign(globalThis, {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const raw =
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const url = new URL(raw, "http://extract.local");
            sent.push({
                path: url.pathname,
                method: (init?.method ?? "GET").toUpperCase(),
                body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
            });
            const response = await simulateExtraction(url, init, Date.now());
            if (!response) throw new Error(`not simulated: ${raw}`);
            return response;
        },
    });
});

beforeEach(() => {
    sent = [];
    configureExtractSim({ empty: false });
});

function mount(at: string, host: Partial<ToolHost> = {}) {
    const openHref = jest.fn();
    render(<ExtractTool host={{ active: true, request: { at, nonce: 1 }, openHref, ...host }} />);
    return { openHref };
}

/** The document titles of the grid's body rows, top to bottom. */
function rowTitles(): string[] {
    return screen.getAllByRole("rowheader").map(cell => cell.textContent?.trim() ?? "");
}

describe("Extract: the list", () => {
    it("lists my tables and the ones shared with me, and offers a menu only on mine", async () => {
        mount("/");
        expect(await screen.findByText("Q3 vendor invoices")).toBeInTheDocument();
        expect(screen.getByText("Supplier contracts — key terms")).toBeInTheDocument();
        expect(screen.getByText("Lease and licence review")).toBeInTheDocument();
        expect(screen.getByText("15 documents × 7 fields", { exact: false })).toBeInTheDocument();
        expect(screen.getByText(/Ingrid Vasquez-Moll/)).toBeInTheDocument();
        expect(screen.getByText("Shared")).toBeInTheDocument();
        expect(screen.getByText("Done · 1 failed")).toBeInTheDocument();
        expect(screen.getAllByText(/Reading \d+ of 10/).length).toBeGreaterThan(0);
        expect(
            screen.getByRole("button", { name: "Actions for Q3 vendor invoices" })
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Actions for Lease and licence review" })
        ).not.toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: /new table/i }).length).toBeGreaterThan(0);
    });

    it("says what the tool does when there is nothing yet", async () => {
        configureExtractSim({ empty: true });
        mount("/");
        expect(await screen.findByText("No tables yet")).toBeInTheDocument();
        expect(screen.getByText(/lines them up in one table/)).toBeInTheDocument();
    });
});

describe("Extract: a finished table", () => {
    it("draws every row state and a column per field", async () => {
        mount("/t/1");
        expect(
            await screen.findByRole("heading", { name: "Q3 vendor invoices" })
        ).toBeInTheDocument();
        const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
        expect(headers).toHaveLength(8);
        expect(headers[0]).toContain("Document");
        expect(headers[4]).toContain("Total amount");
        expect(rowTitles()).toHaveLength(15);

        expect(screen.getAllByText("Not found").length).toBeGreaterThanOrEqual(3);
        expect(screen.getAllByText("Read from image")).toHaveLength(2);
        // Numbers in the reader's format; a long list as two chips and a count.
        expect(screen.getByRole("button", { name: "1,284,500" })).toBeInTheDocument();
        expect(screen.getByText("+12")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Yes" }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole("button", { name: "Jul 3, 2026" })).toHaveLength(1);

        // The failed row says why, and can be retried — alone or with the rest.
        expect(screen.getByText(/did not answer in time/)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Retry INV-2291 Brightwater (scan).pdf" })
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Retry failed (1)" })).toBeInTheDocument();
        // Finished: nothing to cancel, no progress bar.
        expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("sorts by a column, both ways, with rows that have no value last", async () => {
        mount("/t/1");
        const header = await screen.findByRole("columnheader", { name: /Total amount/ });
        expect(header).toHaveAttribute("aria-sort", "none");
        fireEvent.click(within(header).getByRole("button"));
        expect(header).toHaveAttribute("aria-sort", "ascending");
        let titles = rowTitles();
        expect(titles[0]).toBe("Café Lumen receipt.png");
        expect(titles[titles.length - 1]).toBe("INV-2291 Brightwater (scan).pdf");
        fireEvent.click(within(header).getByRole("button"));
        expect(header).toHaveAttribute("aria-sort", "descending");
        titles = rowTitles();
        expect(titles[0]).toBe("Brightwater Analytics — 2026-0098.pdf");
        expect(titles[titles.length - 1]).toBe("INV-2291 Brightwater (scan).pdf");
    });

    it("filters by document title", async () => {
        mount("/t/1");
        const filter = await screen.findByRole("searchbox", { name: "Filter documents" });
        fireEvent.change(filter, { target: { value: "receipt" } });
        expect(rowTitles()).toEqual(["Taxi receipt 0412.jpg", "Café Lumen receipt.png"]);
        expect(screen.getByText("2 of 15 shown")).toBeInTheDocument();
        fireEvent.change(filter, { target: { value: "zzz" } });
        expect(screen.getByText("No documents match the filter.")).toBeInTheDocument();
    });

    it("opens what a value rests on: the quote, the page and the way to the source", async () => {
        const { openHref } = mount("/t/1");
        fireEvent.click(await screen.findByRole("button", { name: "1,284,500" }));
        const detail = await screen.findByRole("dialog", {
            name: "Total amount in Brightwater Analytics — 2026-0098.pdf",
        });
        expect(within(detail).getByText("1,284,500")).toBeInTheDocument();
        expect(within(detail).getByText("“Total due GBP 1,284,500.00”")).toBeInTheDocument();
        expect(within(detail).getByText("“Total due GBP 1,284,500.00”").tagName).toBe("BLOCKQUOTE");
        expect(within(detail).getByText("Page 1")).toBeInTheDocument();
        const link = within(detail).getByRole("link", { name: "Open source" });
        // The link carries the quote and page, so the document opens at the passage.
        const href = link.getAttribute("href") ?? "";
        expect(href.startsWith("/employer/documents?source=d102&find=")).toBe(true);
        expect(new URLSearchParams(href.split("?")[1]).get("find")?.length).toBeGreaterThan(0);
        fireEvent.click(link);
        expect(openHref).toHaveBeenCalledWith(href);
    });

    it("hands the chat a question that names the table, and links the exports", async () => {
        const { openHref } = mount("/t/1");
        const ask = await screen.findByRole("link", { name: "Ask about these results" });
        const href = ask.getAttribute("href")!;
        expect(new URL(href, "http://x").searchParams.get("ask")).toBe(
            'Using the extraction table "Q3 vendor invoices" (#1): '
        );
        fireEvent.click(ask);
        expect(openHref).toHaveBeenCalledWith(href);

        // The document title opens the source too.
        const title = screen.getByRole("link", { name: "Hotel Aldermoor folio.jpg" });
        expect(title).toHaveAttribute("href", "/employer/documents?source=d112");
    });

    it("retries a failed row and goes back to reading", async () => {
        mount("/t/1");
        fireEvent.click(
            await screen.findByRole("button", { name: "Retry INV-2291 Brightwater (scan).pdf" })
        );
        await waitFor(() =>
            expect(sent.find(s => s.path === "/api/extraction/1/rerun")?.body).toMatchObject({
                rowIds: [expect.any(Number)],
            })
        );
        expect(await screen.findByRole("progressbar")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        expect(screen.queryByText(/did not answer in time/)).not.toBeInTheDocument();
    });
});

describe("Extract: a running table and a shared one", () => {
    it("shows how far a run is and lets its owner cancel", async () => {
        mount("/t/2");
        expect(
            await screen.findByRole("heading", { name: "Supplier contracts — key terms" })
        ).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toBeInTheDocument();
        expect(screen.getByText(/^\d+ of 10 documents$/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        const confirm = await screen.findByRole("dialog", { name: "Stop reading?" });
        fireEvent.click(within(confirm).getByRole("button", { name: "Stop" }));
        expect(await screen.findAllByText(/Not read/)).not.toHaveLength(0);
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("withholds a row the viewer cannot open and offers no way to manage the table", async () => {
        mount("/t/3");
        expect(
            await screen.findByRole("heading", { name: "Lease and licence review" })
        ).toBeInTheDocument();
        expect(screen.getByText("You don't have access to this file")).toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: /Settlement Agreement/ })
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Ask about these results" })).toBeInTheDocument();
    });

    it("says a table is gone rather than failing", async () => {
        mount("/t/999");
        expect(await screen.findByText("This table is not here")).toBeInTheDocument();
    });
});

describe("Extract: a new table", () => {
    it("arrives with documents chosen, leaves out the ones it cannot use, validates, and runs", async () => {
        mount("/new?docs=101,d102,131,999");
        const docs = await screen.findByRole("region", { name: "Documents" });
        expect(
            await within(docs).findByText("Halvorsen Freight — INV-4471.pdf")
        ).toBeInTheDocument();
        expect(within(docs).getByText("2 documents")).toBeInTheDocument();
        expect(
            within(docs).getByText(/2 documents from the link were left out/)
        ).toBeInTheDocument();
        expect(screen.getByText("2 documents × 1 field")).toBeInTheDocument();

        // Run with an unnamed field: nothing is sent, and the field says why.
        fireEvent.click(screen.getByRole("button", { name: "Run" }));
        expect(screen.getByText("Give this field a name, or remove it.")).toBeInTheDocument();
        expect(screen.getByText("Fix the fields marked above first.")).toBeInTheDocument();
        expect(sent.some(s => s.method === "POST")).toBe(false);

        // A starter set fills the editor; a repeated name is caught at once.
        fireEvent.click(screen.getByRole("button", { name: "Invoice" }));
        expect(screen.getByLabelText("Name of field 1")).toHaveValue("Vendor");
        expect(screen.getByLabelText("Name of field 5")).toHaveValue("Currency");
        expect(screen.getByLabelText("What to look for in Total amount")).toHaveValue(
            "The final amount due, including tax"
        );
        expect(screen.getByText("2 documents × 5 fields")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Name of field 2"), { target: { value: "vendor" } });
        expect(screen.getAllByText("Another field already has this name.")).toHaveLength(2);
        fireEvent.change(screen.getByLabelText("Name of field 2"), {
            target: { value: "Invoice number" },
        });
        expect(screen.queryByText("Another field already has this name.")).not.toBeInTheDocument();

        // Reorder and remove.
        fireEvent.click(screen.getByRole("button", { name: "Move Currency up" }));
        expect(screen.getByLabelText("Name of field 4")).toHaveValue("Currency");
        fireEvent.click(screen.getByRole("button", { name: "Remove Invoice date" }));
        expect(screen.getByText("2 documents × 4 fields")).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("Q3 vendor invoices"), {
            target: { value: "July invoices" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Run" }));
        await waitFor(() =>
            expect(
                sent.find(s => s.path === "/api/extraction" && s.method === "POST")?.body
            ).toEqual({
                title: "July invoices",
                fields: [
                    { name: "Vendor", type: "text" },
                    { name: "Invoice number", type: "text" },
                    {
                        name: "Currency",
                        type: "text",
                        instruction: "Three-letter code, such as EUR or USD",
                    },
                    {
                        name: "Total amount",
                        type: "number",
                        instruction: "The final amount due, including tax",
                    },
                ],
                documentIds: [101, 102],
            })
        );
        // On success the table opens.
        expect(await screen.findByRole("heading", { name: "July invoices" })).toBeInTheDocument();
        expect(screen.getAllByRole("rowheader")).toHaveLength(2);
    });

    it("asks before a starter set replaces fields someone typed", async () => {
        mount("/new");
        fireEvent.change(await screen.findByLabelText("Name of field 1"), {
            target: { value: "Deposit" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Contract" }));
        const confirm = await screen.findByRole("dialog", { name: "Replace the fields you have?" });
        expect(screen.getByLabelText("Name of field 1")).toHaveValue("Deposit");
        fireEvent.click(within(confirm).getByRole("button", { name: "Replace" }));
        await waitFor(() =>
            expect(screen.getByLabelText("Name of field 1")).toHaveValue("Parties")
        );
    });

    it("picks many documents at once: a whole folder, everything found, never one still processing", async () => {
        mount("/new");
        fireEvent.click(await screen.findByRole("button", { name: "Choose documents" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose documents" });
        const receipts = await within(dialog).findByRole("region", { name: "Finance/Receipts" });
        expect(within(receipts).getByText("0 of 6")).toBeInTheDocument();
        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "Select every document in Finance/Receipts",
            })
        );
        expect(within(receipts).getByText("6 of 6")).toBeInTheDocument();
        expect(within(dialog).getByText("6 documents selected")).toBeInTheDocument();

        // Still being processed: listed, and cannot be chosen.
        const scan = within(dialog).getByRole("checkbox", { name: /Scan 0412\.pdf/ });
        expect(scan).toBeDisabled();
        expect(within(dialog).getByText("Still being processed")).toBeInTheDocument();

        // Everything a search finds, in one click.
        fireEvent.change(within(dialog).getByRole("textbox", { name: "Find by name or folder" }), {
            target: { value: "brightwater" },
        });
        fireEvent.click(within(dialog).getByRole("button", { name: "Select all 3" }));
        expect(within(dialog).getByText("9 documents selected")).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByText("9 documents × 1 field")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Remove Taxi receipt 0412.jpg" }));
        expect(screen.getByText("8 documents × 1 field")).toBeInTheDocument();
    });
});
