/** @jest-environment jsdom */

/**
 * This week drafts the week on arrival: with no agenda and something on
 * file, it asks for the draft once — even under React's double effect —
 * shows that it is drafting, and lands on suggestions. A draft that does not
 * show up in the next read is offered again ("Draft it now"), never claimed
 * as "all caught up" and never retried on its own. With nothing on file it
 * asks for something to read instead, without nudges that say it twice;
 * with everything answered it says so; a failed draft can be tried again.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type * as VantageApi from "~/app/employer/tools/vantage/api";
import type { AgendaDto, OverviewDto } from "~/app/employer/tools/vantage/api";

jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));

const mockPush = jest.fn();
jest.mock("~/components/tool-app/nav", () => ({
    useToolRouter: () => ({
        push: mockPush,
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
    }),
}));
jest.mock("~/components/tool-app/ToolLink", () => {
    const { forwardRef } = jest.requireActual<typeof React>("react");
    return {
        ToolLink: forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
            function ToolLink(props, ref) {
                return <a ref={ref} {...props} />;
            }
        ),
    };
});

const mockOverview = jest.fn<Promise<OverviewDto>, []>();
const mockPrepare = jest.fn<Promise<{ agenda: AgendaDto }>, [string | undefined]>();
const mockPatchTopic = jest.fn();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: {
        overview: () => mockOverview(),
        prepare: (week?: string) => mockPrepare(week),
        patchTopic: (...args: unknown[]) => mockPatchTopic(...args),
    },
}));

import { OverviewScreen } from "~/app/employer/tools/vantage/_screens/OverviewScreen";
import { resetAutoDraftForTests } from "~/app/employer/tools/vantage/_lib/useAutoDraft";

import { weekRange } from "~/app/employer/tools/vantage/_lib/format";

import { WEEK, WEEK_END, agenda, overview, signals, topic } from "../vantage/factories";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** What `/api/vantage/overview` answers right now; tests move it on. */
let current: OverviewDto;

const withMaterial = () =>
    overview({ counts: { evidenceThisWindow: 3, openCommitments: 1, metricsWithData: 2 } });

const pricing = topic({
    id: "t-pricing",
    title: "Pricing page converts at half last month's rate",
    whyItMatters: "Most trials now start from the pricing page.",
});
const sso = topic({ id: "t-sso", position: 1, title: "Two design partners asked for SSO" });
const drafted = agenda({
    id: "a-drafted",
    topics: [pricing, sso],
    summary: "Conversion halved while two partners asked for SSO.",
    generatedAt: "2026-10-03T08:00:00.000Z",
    modelMetadata: { mode: "ai" },
});

beforeEach(() => {
    resetAutoDraftForTests();
    window.localStorage.clear();
    jest.clearAllMocks();
    current = overview();
    mockOverview.mockImplementation(() => Promise.resolve(current));
    mockPrepare.mockImplementation(() => Promise.resolve({ agenda: drafted }));
    mockPatchTopic.mockImplementation((id: string) => Promise.resolve({ topic: topic({ id }) }));
});

describe("OverviewScreen", () => {
    it("drafts the week once on arrival, shows it drafting, then lands on suggestions", async () => {
        current = withMaterial();
        const draft = deferred<{ agenda: AgendaDto }>();
        mockPrepare.mockReturnValue(draft.promise);

        const strict = (
            <React.StrictMode>
                <OverviewScreen />
            </React.StrictMode>
        );
        const first = render(strict);

        expect(
            await screen.findByText("Vantage is drafting your week…", { exact: false })
        ).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "Reading 3 pieces of evidence, 2 metrics and 1 open commitment"
        );
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(mockPrepare).toHaveBeenCalledWith(WEEK);

        // Leave This week and come back while the draft is still on its way:
        // the screen waits on the same request instead of asking again.
        first.unmount();
        render(strict);
        expect(
            await screen.findByText("Vantage is drafting your week…", { exact: false })
        ).toBeInTheDocument();
        expect(mockPrepare).toHaveBeenCalledTimes(1);

        current = { ...withMaterial(), agenda: drafted };
        await act(async () => draft.resolve({ agenda: drafted }));

        const card = await screen.findByRole("article", { name: pricing.title });
        expect(within(card).getByRole("button", { name: "Add to agenda" })).toBeVisible();
        expect(screen.getByRole("article", { name: sso.title })).toBeInTheDocument();
        expect(screen.getByText(drafted.summary!)).toBeInTheDocument();
        expect(screen.queryByRole("status")).toBeNull();
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("answers a drafted suggestion in one click and reloads the week", async () => {
        current = { ...withMaterial(), agenda: drafted };
        render(<OverviewScreen />);
        const card = await screen.findByRole("article", { name: pricing.title });
        const loads = mockOverview.mock.calls.length;

        current = {
            ...withMaterial(),
            agenda: { ...drafted, topics: [{ ...pricing, status: "kept" }, sso] },
        };
        fireEvent.click(within(card).getByRole("button", { name: "Add to agenda" }));
        expect(screen.queryByRole("article", { name: pricing.title })).toBeNull();
        await act(async () => {});

        expect(mockPatchTopic).toHaveBeenCalledWith(pricing.id, { status: "kept" });
        await waitFor(() => expect(mockOverview.mock.calls.length).toBeGreaterThan(loads));
        expect(screen.queryByRole("article", { name: pricing.title })).toBeNull();
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("asks for something to read, without drafting or doubling its nudges, when nothing is on file", async () => {
        current = overview({
            daysSinceLastEntry: null,
            lastEntryAt: null,
            signals: signals({ metricsWithoutData: [{ metricId: "m", key: "mrr", name: "MRR" }] }),
        });

        render(<OverviewScreen />);

        expect(await screen.findByText("Give Vantage something to read")).toBeInTheDocument();
        expect(mockPrepare).not.toHaveBeenCalled();
        expect(screen.queryByText("Vantage is drafting your week…")).toBeNull();
        expect(screen.queryByText("You're all caught up")).toBeNull();
        // The empty state already asks for a conversation and the numbers.
        expect(screen.queryByRole("region", { name: "Keep the record current" })).toBeNull();
        expect(screen.queryByRole("article", { name: "Log a conversation" })).toBeNull();
        expect(screen.queryByRole("article", { name: "Record this week's numbers" })).toBeNull();
    });

    it("offers to draft again, not 'caught up', when the draft did not show up (workspace switch)", async () => {
        current = withMaterial();

        render(<OverviewScreen />);

        const title = `No agenda for ${weekRange(WEEK, WEEK_END)} yet`;
        expect(await screen.findByText(title)).toBeInTheDocument();
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("You're all caught up")).toBeNull();

        // Re-reads that still have no agenda do not set off another draft.
        const reads = mockOverview.mock.calls.length;
        await act(async () => {
            window.dispatchEvent(new Event("vantage:changed"));
        });
        await waitFor(() => expect(mockOverview.mock.calls.length).toBeGreaterThan(reads));
        expect(screen.getByText(title)).toBeInTheDocument();
        expect(mockPrepare).toHaveBeenCalledTimes(1);

        current = { ...withMaterial(), agenda: drafted };
        fireEvent.click(screen.getByRole("button", { name: "Draft it now" }));

        expect(mockPrepare).toHaveBeenCalledTimes(2);
        expect(await screen.findByRole("article", { name: pricing.title })).toBeInTheDocument();
        expect(screen.queryByText(title)).toBeNull();
    });

    it("says you're all caught up when every topic is answered and nothing else waits", async () => {
        current = {
            ...withMaterial(),
            agenda: agenda({
                status: "ready",
                topics: [
                    topic({ id: "k1", status: "kept", title: "Pricing" }),
                    topic({ id: "k2", position: 1, status: "kept", title: "SSO" }),
                ],
            }),
        };

        render(<OverviewScreen />);

        expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
        expect(screen.queryByRole("article")).toBeNull();
        expect(screen.getByText("On the agenda")).toBeInTheDocument();
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("says the draft failed and tries again on request", async () => {
        current = withMaterial();
        mockPrepare.mockRejectedValueOnce(new Error("The model is busy"));

        render(<OverviewScreen />);

        expect(await screen.findByText("Vantage could not draft the week")).toBeInTheDocument();
        expect(screen.getByText("The model is busy")).toBeInTheDocument();
        expect(mockPrepare).toHaveBeenCalledTimes(1);

        current = { ...withMaterial(), agenda: drafted };
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        expect(mockPrepare).toHaveBeenCalledTimes(2);
        expect(await screen.findByRole("article", { name: pricing.title })).toBeInTheDocument();
        expect(screen.queryByText("Vantage could not draft the week")).toBeNull();
    });
});
