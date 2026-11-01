/** @jest-environment jsdom */

/**
 * The post writer's layout: a finished run opens on its draft, and the rest
 * of what the run produced sits behind tabs instead of below it — claims
 * (with how many need a person), the reasoning, research and the run's own
 * steps. Past campaigns are a drawer behind a History button, not a column.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
// CSS modules are not mapped in this Jest config: class names are their keys.
jest.mock(
    "~/styles/Employer/MarketingPipeline.module.css",
    () => new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : String(key)) })
);

import { MarketingPipelineWorkspace } from "~/app/employer/documents/components/marketing-pipeline/MarketingPipelineWorkspace";
import {
    MARKETING_ACTIVE_SESSION_KEY,
    MARKETING_SESSIONS_STORAGE_KEY,
} from "~/app/employer/documents/components/marketing-pipeline/shared";

const MESSAGE = "Onboarding takes 40% less time than before.";

function seed() {
    const session = {
        id: "s1",
        createdAt: 1,
        updatedAt: 1,
        platform: "linkedin",
        prompt: "Announce faster onboarding",
        viewMode: "preview",
        editableMessage: MESSAGE,
        result: {
            platform: "linkedin",
            message: MESSAGE,
            "image/video": "image",
            normalizedInput: { platform: "linkedin", prompt: "Announce faster onboarding" },
            research: [
                { title: "Benchmark A", url: "https://a.example", snippet: "…", source: "web" },
                { title: "Benchmark B", url: "https://b.example", snippet: "…", source: "web" },
            ],
            claimSources: [
                {
                    claim: "Onboarding takes 40% less time",
                    support: "supported",
                    match: { sourceDoc: "Handbook", excerpt: "40% faster", relevance: 0.9 },
                },
                {
                    claim: "A human on every first call",
                    support: "unsupported",
                    match: null,
                },
            ],
        },
    };
    sessionStorage.setItem(MARKETING_SESSIONS_STORAGE_KEY, JSON.stringify([session]));
    sessionStorage.setItem(MARKETING_ACTIVE_SESSION_KEY, "s1");
}

beforeEach(() => {
    sessionStorage.clear();
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { runs: [] } }),
        } as unknown as Response)
    ) as unknown as typeof fetch;
});

it("opens a finished run on its draft, with everything else one tab away", async () => {
    seed();
    render(<MarketingPipelineWorkspace embedded />);
    const tabs = await screen.findByRole("tablist");
    const names = within(tabs)
        .getAllByRole("tab")
        .map(t => t.textContent);
    expect(names).toEqual(["Draft", "Claims1", "Why it works", "Research2", "Process"]);
    expect(within(tabs).getByRole("tab", { name: /Draft/ })).toHaveAttribute(
        "aria-selected",
        "true"
    );
    // The draft is on screen; the claims are not, until asked for.
    expect(screen.getAllByText(MESSAGE).length).toBeGreaterThan(0);
    expect(screen.queryByText("A human on every first call")).not.toBeInTheDocument();

    // Radix tabs switch on mousedown (and keyboard), not click.
    fireEvent.mouseDown(within(tabs).getByRole("tab", { name: /Claims/ }));
    await waitFor(() =>
        expect(screen.getByText("A human on every first call")).toBeInTheDocument()
    );
    expect(screen.getByText("Not stated in your documents")).toBeInTheDocument();
});

it("keeps past campaigns in a drawer behind History, not a column", async () => {
    seed();
    render(<MarketingPipelineWorkspace embedded />);
    const history = await screen.findByRole("button", { name: "History (1)" });
    // No session list on the page itself…
    expect(
        screen.queryByRole("button", { name: /Announce faster onboarding/ })
    ).not.toBeInTheDocument();
    act(() => {
        fireEvent.click(history);
    });
    const drawer = await screen.findByRole("dialog");
    // …it is in the drawer.
    expect(
        within(drawer).getByRole("button", { name: /Announce faster onboarding/ })
    ).toBeInTheDocument();
});

it("shows where the draft will appear before any run", async () => {
    render(<MarketingPipelineWorkspace embedded />);
    // Pick a platform first: the workspace opens on the platform picker.
    fireEvent.click(await screen.findByRole("button", { name: /LinkedIn/ }));
    expect(
        await screen.findByText("Your draft appears here. Describe what to promote and generate.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});
