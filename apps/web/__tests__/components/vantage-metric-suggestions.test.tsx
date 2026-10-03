/** @jest-environment jsdom */

/**
 * What Vantage suggests on the numbers screen, wired the way MetricsScreen
 * wires it: two sources disagreeing about a metric (keep one, the other is
 * removed, Undo records it again exactly as it was) and metrics with no
 * number this week (record it, or ignore it for the week).
 */
import React, { useCallback, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import type * as VantageApi from "~/app/employer/tools/vantage/api";
import type {
    MetricObservationDto,
    ObservationInput,
    WeeklySignals,
} from "~/app/employer/tools/vantage/api";

jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));

const mockDeleteObservation = jest.fn();
const mockAddObservation = jest.fn();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: {
        deleteObservation: (...args: unknown[]) => mockDeleteObservation(...args),
        addObservation: (...args: unknown[]) => mockAddObservation(...args),
    },
}));

import { MetricSuggestions } from "~/app/employer/tools/vantage/_components/MetricSuggestions";
import { useOneClick } from "~/app/employer/tools/vantage/_lib/actions";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";
import { useHiddenSuggestions } from "~/app/employer/tools/vantage/_lib/hidden";

import { WEEK, signals } from "../vantage/factories";

const mockToast = jest.mocked(toast);

type Conflict = WeeklySignals["metricConflicts"][number];

const stripe = {
    observationId: "o-stripe",
    value: 120,
    periodStart: "2026-09-28",
    periodEnd: "2026-10-04",
    source: "Stripe",
};
const mixpanel = {
    observationId: "o-mixpanel",
    value: 95,
    periodStart: "2026-09-28",
    periodEnd: "2026-10-04",
    source: "Mixpanel",
};
const signups: Conflict = {
    metricId: "m-signups",
    key: "signups",
    name: "Signups",
    a: stripe,
    b: mixpanel,
};

function observation(over: Partial<MetricObservationDto>): MetricObservationDto {
    return {
        id: "o",
        metricId: "m-signups",
        metricKey: "signups",
        metricName: "Signups",
        value: 0,
        periodStart: "2026-09-28",
        periodEnd: "2026-10-04",
        source: null,
        note: null,
        createdAt: "2026-10-03T09:00:00.000Z",
        ...over,
    };
}

/** The numbers on file. A conflict is there while both of its numbers are. */
let onFile: MetricObservationDto[];

function read(): WeeklySignals {
    const ids = new Set(onFile.map(o => o.id));
    const restored = (side: Conflict["a"]) =>
        onFile.find(o => o.id === side.observationId || o.id === `${side.observationId}-again`);
    const a = restored(stripe);
    const b = restored(mixpanel);
    return signals({
        metricConflicts:
            a && b
                ? [
                      {
                          ...signups,
                          a: { ...stripe, observationId: a.id },
                          b: { ...mixpanel, observationId: b.id },
                      },
                  ]
                : [],
        metricsWithoutData: ids.has("o-mrr")
            ? []
            : [{ metricId: "m-mrr", key: "mrr", name: "MRR" }],
    });
}

const onRecord = jest.fn();

function Harness() {
    const [data, setData] = useState(() => ({ signals: read(), observations: onFile }));
    const refresh = useCallback(async () => {
        await Promise.resolve();
        setData({ signals: read(), observations: onFile });
    }, []);
    const { act: answer, gone } = useOneClick(refresh);
    const hidden = useHiddenSuggestions();
    return (
        <MetricSuggestions
            signals={data.signals}
            week={WEEK}
            observations={data.observations}
            act={answer}
            gone={gone}
            hidden={hidden}
            onRecord={onRecord}
        />
    );
}

const settle = () => act(() => new Promise<void>(r => setTimeout(r, 0)));
const CONFLICT = "Signups: two numbers disagree";
const card = (name: string) => screen.getByRole("article", { name });
const queryCard = (name: string) => screen.queryByRole("article", { name });
const hiddenStore = () =>
    JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}") as Record<string, string>;

function lastToast() {
    const call = mockToast.mock.calls.at(-1) as unknown as
        | [string, { description?: string; action?: { label: string; onClick: () => void } }]
        | undefined;
    if (!call) throw new Error("no toast was shown");
    return { message: call[0], options: call[1] };
}

async function undo() {
    const { options } = lastToast();
    expect(options.action?.label).toBe("Undo");
    act(() => options.action?.onClick());
    await settle();
}

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    onFile = [
        observation({ id: "o-stripe", value: 120, source: "Stripe" }),
        observation({
            id: "o-mixpanel",
            value: 95,
            source: "Mixpanel",
            note: "From the weekly export",
        }),
    ];
    mockDeleteObservation.mockImplementation((id: string) => {
        onFile = onFile.filter(o => o.id !== id);
        return Promise.resolve({ ok: true });
    });
    mockAddObservation.mockImplementation((input: ObservationInput) => {
        const back = observation({
            ...input,
            id: input.source === "Stripe" ? "o-stripe-again" : "o-mixpanel-again",
        });
        onFile = [...onFile, back];
        return Promise.resolve({ observations: [back] });
    });
});

describe("MetricSuggestions — numbers that disagree", () => {
    it("asks which number counts, with both answers and Ignore on the card", () => {
        render(<Harness />);
        const c = card(CONFLICT);

        expect(within(c).getByText("Two numbers disagree")).toBeInTheDocument();
        expect(c).toHaveTextContent("Signups: 120 from Stripe, or 95 from Mixpanel?");
        const answers = screen.getByRole("group", {
            name: "Signups: 120 from Stripe, or 95 from Mixpanel?",
        });
        expect(within(answers).getByRole("button", { name: "Keep 120 · Stripe" })).toBeVisible();
        expect(within(answers).getByRole("button", { name: "Keep 95 · Mixpanel" })).toBeVisible();
        expect(within(answers).getByRole("button", { name: "Ignore" })).toBeVisible();
    });

    it("Keep A removes B, and Undo records B again exactly as it was", async () => {
        render(<Harness />);

        fireEvent.click(within(card(CONFLICT)).getByRole("button", { name: "Keep 120 · Stripe" }));
        expect(queryCard(CONFLICT)).toBeNull();
        await settle();

        expect(mockDeleteObservation).toHaveBeenCalledTimes(1);
        expect(mockDeleteObservation).toHaveBeenCalledWith("o-mixpanel");
        expect(lastToast().message).toBe("Kept 120 for Signups");
        expect(lastToast().options.description).toBe("Removed 95 (Mixpanel)");
        expect(queryCard(CONFLICT)).toBeNull();

        await undo();

        expect(mockAddObservation).toHaveBeenCalledWith({
            metricId: "m-signups",
            value: 95,
            periodStart: "2026-09-28",
            periodEnd: "2026-10-04",
            source: "Mixpanel",
            note: "From the weekly export",
        });
        expect(card(CONFLICT)).toBeInTheDocument();
    });

    it("Keep B removes A, and Undo restores A with no note when it had none", async () => {
        render(<Harness />);

        await act(async () => {
            fireEvent.click(
                within(card(CONFLICT)).getByRole("button", { name: "Keep 95 · Mixpanel" })
            );
        });
        await settle();

        expect(mockDeleteObservation).toHaveBeenCalledWith("o-stripe");
        await undo();

        expect(mockAddObservation).toHaveBeenCalledWith({
            metricId: "m-signups",
            value: 120,
            periodStart: "2026-09-28",
            periodEnd: "2026-10-04",
            source: "Stripe",
            note: null,
        });
    });

    it("Ignore keeps both numbers and sets the question aside on this browser", async () => {
        render(<Harness />);

        await act(async () => {
            fireEvent.click(within(card(CONFLICT)).getByRole("button", { name: "Ignore" }));
        });

        expect(queryCard(CONFLICT)).toBeNull();
        expect(mockDeleteObservation).not.toHaveBeenCalled();
        expect(mockAddObservation).not.toHaveBeenCalled();
        expect(hiddenStore()).toEqual({
            "conflict:o-stripe:o-mixpanel": addDaysIso(todayIso(), 60),
        });
        expect(lastToast().message).toBe("Ignored — both numbers stay");
    });
});

describe("MetricSuggestions — no number this week", () => {
    it("Record it opens that metric, and Ignore hides it for the week", async () => {
        render(<Harness />);
        const nudge = card("Record MRR");

        fireEvent.click(within(nudge).getByRole("button", { name: "Record it" }));
        expect(onRecord).toHaveBeenCalledWith("m-mrr");

        await act(async () => {
            fireEvent.click(within(nudge).getByRole("button", { name: "Ignore" }));
        });

        expect(queryCard("Record MRR")).toBeNull();
        expect(hiddenStore()).toEqual({ [`numbers:${WEEK}:m-mrr`]: addDaysIso(todayIso(), 7) });
        expect(mockAddObservation).not.toHaveBeenCalled();
    });

    it("shows nothing when there is nothing to settle", () => {
        onFile = [observation({ id: "o-mrr", metricId: "m-mrr" })];
        const { container } = render(<Harness />);

        expect(container).toBeEmptyDOMElement();
    });
});
