/** @jest-environment jsdom */

/**
 * Contract v2 in the Scenarios tab, over the harness's simulator: the form
 * starts durable runs (contractVersion 2, with an Idempotency-Key that a retry
 * of the same form reuses); a v2 run's Sources tab says what was read, what
 * was left out and why, how people were grounded, and where the result is
 * less complete than it looks; and a person's sheet says where each field
 * came from, so evidence can be told from the model's filling-in.
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { resetScenariosSim, simulateScenarios } from "~/app/dev/scenarios/scenarios-sim";
import { ScenariosTool } from "~/app/employer/tools/scenarios/ScenariosTool";
import type { ToolHost } from "~/components/tool-app/nav";

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
    headers: Record<string, string>;
}
let sent: Sent[] = [];
/** When set, the next create answers 503 once, as a dropped request would. */
let failNextCreate = false;

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
            const method = (init?.method ?? "GET").toUpperCase();
            sent.push({
                path: url.pathname,
                method,
                body:
                    typeof init?.body === "string"
                        ? (JSON.parse(init.body) as unknown)
                        : init?.body,
                headers: Object.fromEntries(
                    Object.entries((init?.headers ?? {}) as Record<string, string>).map(
                        ([k, v]) => [k.toLowerCase(), v]
                    )
                ),
            });
            if (failNextCreate && url.pathname === "/api/scenarios" && method === "POST") {
                failNextCreate = false;
                return new ShimResponse(JSON.stringify({ error: "Upstream unavailable" }), {
                    status: 503,
                });
            }
            const response = await simulateScenarios(url, init, Date.now());
            if (!response) throw new Error(`not simulated: ${raw}`);
            return response;
        },
    });
});

beforeEach(() => {
    sent = [];
    failNextCreate = false;
    resetScenariosSim();
});

function mount(at: string) {
    const host: ToolHost = { active: true, request: { at, nonce: 1 }, openHref: jest.fn() };
    render(<ScenariosTool host={host} />);
}

const creates = () => sent.filter(s => s.path === "/api/scenarios" && s.method === "POST");

describe("Scenarios v2 in the tab", () => {
    it("starts a durable run and reuses its Idempotency-Key when the same form is retried", async () => {
        failNextCreate = true;
        mount("/new");
        fireEvent.change(await screen.findByLabelText("What happens if…"), {
            target: { value: "We raise prices 20% for new customers in January." },
        });
        const run = () => screen.getByRole("button", { name: /run scenario/i });
        await waitFor(() => expect(run()).toBeEnabled());
        fireEvent.click(run());
        await waitFor(() => expect(creates()).toHaveLength(1));
        await waitFor(() => expect(run()).toBeEnabled());
        fireEvent.click(run());
        await waitFor(() => expect(creates()).toHaveLength(2));

        const [first, second] = creates();
        expect(first!.body).toMatchObject({ contractVersion: 2 });
        const key = first!.headers["idempotency-key"];
        expect(key).toEqual(expect.any(String));
        expect(key!.length).toBeGreaterThan(8);
        expect(second!.headers["idempotency-key"]).toBe(key);
    });

    it("says what a v2 run read, what it left out and why, and how people were grounded", async () => {
        mount("/runs/1?tab=sources");
        const heading = await screen.findByRole("heading", { name: "What was read" });
        const section = heading.closest("section")!;
        expect(
            within(section).getByText(/built from a map of who and what your sources mention/i)
        ).toBeInTheDocument();
        expect(within(section).getByText("2 sources left out")).toBeInTheDocument();
        expect(within(section).getByText("Board deck Q3.pdf")).toBeInTheDocument();
        expect(within(section).getByText("over the reading limit")).toBeInTheDocument();
        expect(within(section).getByText("still being processed")).toBeInTheDocument();
        expect(within(section).getByText(/many turns failed in round 4/i)).toBeInTheDocument();
    });

    it("marks where each of a person's fields came from", async () => {
        mount("/runs/1?tab=people&person=a1");
        const sheet = await screen.findByRole("dialog");
        const wallet = within(sheet)
            .getByRole("heading", { name: "Money and switching" })
            .closest("section")!;
        // Read in a source: the source id opens it in Sources.
        const from = wallet.querySelector('[data-basis="source"]');
        expect(from).not.toBeNull();
        expect(within(from as HTMLElement).getByText("From")).toBeInTheDocument();
        expect(
            within(from as HTMLElement).getByRole("button", { name: /open source e\d+/i })
        ).toBeInTheDocument();
        // Reasoned from the evidence, with the reason a hover away.
        expect(within(wallet).getAllByRole("button", { name: "Inferred" }).length).toBeGreaterThan(
            0
        );
        // A stated default.
        expect(within(wallet).getByRole("button", { name: "Assumed" })).toBeInTheDocument();
    });

    it("says a field is not known instead of inventing it", async () => {
        // Every third person's budget is unknown in the harness: a3.
        mount("/runs/1?tab=people&person=a3");
        const sheet = await screen.findByRole("dialog");
        const wallet = within(sheet)
            .getByRole("heading", { name: "Money and switching" })
            .closest("section")!;
        expect(within(wallet).getByText("Not known")).toBeInTheDocument();
    });
});
