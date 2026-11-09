/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    type FitDimensionResult,
    type FitDimensions,
    type ProgramView,
} from "@launchstack/pipelines/accelerators";

import programFixture from "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json";
import { FitPanel } from "~/app/employer/tools/accelerators/_components/FitPanel";
import { FitStatus, Narrative } from "~/app/employer/tools/accelerators/_components/ProgramFacts";
import { RunStatus } from "~/app/employer/tools/accelerators/_components/RunStatus";
import { renderWithLocale } from "~/i18n/testing/render";
import { runCopy } from "~/server/proposals/copy";

const mockUseAccelerators = jest.fn();
jest.mock("~/app/employer/tools/accelerators/_lib/context", () => ({
    ...jest.requireActual("~/app/employer/tools/accelerators/_lib/context"),
    useAccelerators: () => mockUseAccelerators(),
}));

const program = CatalogueProgramSchema.parse(programFixture);
const unknownDimension: FitDimensionResult = {
    score: null,
    applicable: true,
    note: "Unknown",
    evidence: { sourceIds: [], companyEvidenceIds: [] },
};
const unknownDimensions = Object.fromEntries(
    FIT_DIMENSION_KEYS.map(key => [key, unknownDimension])
) as FitDimensions;
function view(score: number | null, matched = true): ProgramView {
    return {
        program,
        contentHash: "program-version",
        fit: matched
            ? {
                  rubricVersion: FIT_RUBRIC_VERSION,
                  eligibility: { status: "unknown", note: "Unknown" },
                  dimensions: unknownDimensions,
                  overall: { score, coverage: score === null ? 0 : 100 },
              }
            : null,
        freshness: matched
            ? { status: "current", reasons: [], assessedAt: "2026-11-02T00:00:00Z" }
            : { status: "not_assessed", reasons: [], assessedAt: null },
    };
}

it("does not turn an unknown fit into zero or a genuine zero into unknown", () => {
    const { rerender } = render(<FitStatus view={view(null)} ring />);
    const unknownLabel = screen.getByRole("img").getAttribute("aria-label");
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();

    rerender(<FitStatus view={view(0)} ring />);
    expect(screen.getByText("0", { exact: true })).toBeVisible();
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("0"));
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toBe(unknownLabel);
});

it("distinguishes an unassessed Program from a saved unscorable fit", () => {
    const { rerender } = render(<FitStatus view={view(null, false)} ring />);
    const unmatchedLabel = screen.getByRole("img").getAttribute("aria-label");
    rerender(<FitStatus view={view(null)} ring />);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toBe(unmatchedLabel);
});

it("keeps a genuine zero with its eligibility and assessed time", () => {
    const saved = view(0);
    saved.fit!.eligibility = { status: "ineligible", note: "Requires a Singapore company." };

    const { container } = render(<FitPanel view={saved} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("0"));
    expect(screen.getByText("Not eligible")).toBeVisible();
    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-11-02T00:00:00Z");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps too little evidence apart from a Program that was never assessed", () => {
    const { container, rerender } = render(<FitPanel view={view(null)} />);
    const insufficientLabel = screen.getByRole("img").getAttribute("aria-label");
    expect(container.querySelector("time")).toBeVisible();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();

    rerender(<FitPanel view={view(null, false)} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).not.toBe(insufficientLabel);
    expect(container.querySelector("time")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
});

it("says why a result is out of date without discarding its previous score", () => {
    const saved: ProgramView = {
        ...view(72),
        freshness: {
            status: "out_of_date",
            reasons: ["profile_changed", "rubric_changed"],
            assessedAt: "2026-11-02T00:00:00Z",
        },
    };
    const { rerender } = render(<FitPanel view={saved} />);

    expect(screen.getByRole("status")).toHaveTextContent(/company profile changed/);
    expect(screen.getByRole("status")).toHaveTextContent(/scoring rules changed/);
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("72"));

    rerender(<FitPanel view={view(72)} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("72"));
});

it("shows no grades for a result saved under an older rubric", () => {
    render(
        <FitPanel
            view={{
                ...view(null, false),
                freshness: {
                    status: "out_of_date",
                    reasons: ["rubric_changed"],
                    assessedAt: "2026-11-02T00:00:00Z",
                },
            }}
        />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/scoring rules changed/);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
});

it.each([false, true])(
    "identifies interpreted source text without labelling a direct account (%s)",
    interpretation => {
        render(
            <Narrative
                title="Target applicants"
                narrative={{ ...program.targetApplicants, interpretation }}
            />
        );
        if (interpretation) expect(screen.getByRole("note")).toBeVisible();
        else expect(screen.queryByRole("note")).not.toBeInTheDocument();
    }
);

it("presents a persisted credit refusal in the reader's Chinese locale", () => {
    const error = "Insufficient credits";
    mockUseAccelerators.mockReturnValue({
        activeRun: {
            id: "failed-matching",
            kind: "programs",
            status: "failed",
            steps: [],
            summary: null,
            error,
            ...runCopy({ headline: null, error }),
            creditsUsed: 0,
            createdAt: "2026-11-02T00:00:00Z",
            startedAt: "2026-11-02T00:00:00Z",
            completedAt: "2026-11-02T00:00:01Z",
        },
        pollError: null,
        resumePolling: jest.fn(),
    });
    renderWithLocale(<RunStatus />, "zh-CN");
    expect(screen.getByRole("alert")).toHaveTextContent(/\p{Script=Han}/u);
});
