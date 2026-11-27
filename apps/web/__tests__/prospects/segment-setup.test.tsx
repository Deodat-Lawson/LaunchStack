/** @jest-environment jsdom */

/**
 * Prospects' first screen: the three questions on the page, drafted from the
 * company profile, and one button that creates the segment and starts the
 * search — instead of a disabled button and a popover to find.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockCreate = jest.fn();
const mockSuggestion = jest.fn();
jest.mock("~/app/employer/tools/growth/prospects/api", () => ({
    prospectsApi: {
        createSegment: (...a: unknown[]) => mockCreate(...a),
        segmentSuggestion: () => mockSuggestion(),
    },
}));
const mockStartRun = jest.fn();
const mockReload = jest.fn();
const mockSetSegment = jest.fn();
jest.mock("~/app/employer/tools/growth/prospects/_lib/context", () => ({
    useProspects: () => ({
        startRun: (...a: unknown[]) => mockStartRun(...a),
        reloadSegments: () => mockReload(),
        setSegmentId: (...a: unknown[]) => mockSetSegment(...a),
    }),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import { SegmentSetup } from "~/app/employer/tools/growth/prospects/_components/SegmentSetup";

beforeEach(() => {
    jest.clearAllMocks();
    mockSuggestion.mockResolvedValue({
        suggestion: {
            offering: "Bookkeeping and payroll for independent restaurants",
            place: "Baltimore, United States",
            basis: { profile: true, headquarters: true },
        },
    });
    mockCreate.mockResolvedValue({ segment: { id: "seg-1", name: "Restaurants · Baltimore" } });
    mockReload.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
});

it("asks who you sell to on the page, drafted from the profile", async () => {
    render(<SegmentSetup />);
    expect(screen.getByRole("heading", { name: "Who do you sell to?" })).toBeInTheDocument();
    await waitFor(() =>
        expect(screen.getByLabelText("Where")).toHaveValue("Baltimore, United States")
    );
    expect(screen.getByLabelText("What you sell")).toHaveValue(
        "Bookkeeping and payroll for independent restaurants"
    );
    expect(
        screen.getByText("From your company profile. Change it to look somewhere else.")
    ).toBeInTheDocument();
    // Who buys is never guessed: the button waits for it.
    expect(screen.getByLabelText("Who buys from you")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Find companies" })).toBeDisabled();
});

it("creates the segment from the answers and starts the search on it", async () => {
    render(<SegmentSetup />);
    await waitFor(() =>
        expect(screen.getByLabelText("Where")).toHaveValue("Baltimore, United States")
    );
    fireEvent.change(screen.getByLabelText("Who buys from you"), {
        target: { value: "restaurants, cafés" },
    });
    fireEvent.change(screen.getByLabelText("Where"), {
        target: { value: "Baltimore, MD, USA; Austin, TX" },
    });
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Find companies" }));
    });
    expect(mockCreate).toHaveBeenCalledWith({
        name: "restaurants, cafés · Baltimore, MD, USA",
        offering: "Bookkeeping and payroll for independent restaurants",
        industries: ["restaurants", "cafés"],
        places: ["Baltimore, MD, USA", "Austin, TX"],
    });
    expect(mockSetSegment).toHaveBeenCalledWith("seg-1");
    // The run starts on the segment just made, not whatever was selected before.
    expect(mockStartRun).toHaveBeenCalledWith({ segmentId: "seg-1" });
});

it("doesn't overwrite what the member already typed when the draft arrives late", async () => {
    let resolve!: (v: unknown) => void;
    mockSuggestion.mockReturnValue(new Promise(r => (resolve = r)));
    render(<SegmentSetup />);
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "Netherlands" } });
    await act(async () => {
        resolve({
            suggestion: {
                offering: "x",
                place: "Baltimore, United States",
                basis: { profile: true, headquarters: true },
            },
        });
    });
    expect(screen.getByLabelText("Where")).toHaveValue("Netherlands");
});

it("says beside “What you sell” when it is too long, counts it, and holds the button", async () => {
    render(<SegmentSetup />);
    await waitFor(() =>
        expect(screen.getByLabelText("Where")).toHaveValue("Baltimore, United States")
    );
    fireEvent.change(screen.getByLabelText("Who buys from you"), {
        target: { value: "restaurants" },
    });
    const offering = screen.getByLabelText("What you sell");

    // Near the limit: a count, no error.
    fireEvent.change(offering, { target: { value: "x".repeat(3_500) } });
    expect(screen.getByText("3,500 / 4,000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find companies" })).toBeEnabled();

    // Over it: the sentence replaces the hint, and nothing is sent.
    fireEvent.change(offering, { target: { value: "x".repeat(4_321) } });
    expect(
        screen.getByText("4,321 characters; this can be up to 4,000.")
    ).toBeInTheDocument();
    expect(offering).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Find companies" })).toBeDisabled();
    fireEvent.submit(offering.closest("form")!);
    expect(mockCreate).not.toHaveBeenCalled();
});

it("says which kind of buyer or place is too long", async () => {
    render(<SegmentSetup />);
    await waitFor(() =>
        expect(screen.getByLabelText("Where")).toHaveValue("Baltimore, United States")
    );
    fireEvent.change(screen.getByLabelText("Who buys from you"), {
        target: { value: `restaurants, ${"y".repeat(250)}` },
    });
    expect(
        screen.getByText(
            "One kind of buyer is 250 characters; each can be up to 200. Separate kinds with commas."
        )
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "z".repeat(240) } });
    expect(
        screen.getByText(
            "One place is 240 characters; each can be up to 200. Separate places with “;”."
        )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find companies" })).toBeDisabled();
});

it("cuts the name made from long answers instead of having it refused", async () => {
    render(<SegmentSetup />);
    await waitFor(() =>
        expect(screen.getByLabelText("Where")).toHaveValue("Baltimore, United States")
    );
    const buyers = ["b".repeat(190), "c".repeat(190)];
    fireEvent.change(screen.getByLabelText("Who buys from you"), {
        target: { value: buyers.join(", ") },
    });
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Find companies" }));
    });
    const [input] = mockCreate.mock.calls[0] as [{ name: string; industries: string[] }];
    expect(input.industries).toEqual(buyers);
    expect(input.name).toHaveLength(256);
    expect(input.name.endsWith("…")).toBe(true);
});
