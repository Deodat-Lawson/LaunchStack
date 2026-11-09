/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { CatalogueProgramSchema, type ProgramView } from "@launchstack/pipelines/accelerators";

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
function view(score: number | null, matched = true): ProgramView {
    return {
        program,
        contentHash: "program-version",
        fitStale: false,
        fit: matched
            ? {
                  assessment: {
                      score,
                      reasons: [],
                      concerns: [],
                      unknowns: [],
                      sourceIds: [],
                      companyEvidenceIds: [],
                  },
                  profileHash: "profile-version",
                  programHash: "program-version",
                  checkedAt: "2026-11-02T00:00:00Z",
              }
            : null,
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

it("keeps a genuine zero with its saved evaluation, matched time and evidence references", () => {
    const saved = view(0);
    saved.fit!.assessment = {
        ...saved.fit!.assessment,
        reasons: ["The company has a working prototype."],
        concerns: ["The published residency requirement needs review."],
        unknowns: ["The company has not supplied its runway."],
        companyEvidenceIds: [13, 27],
    };

    const { container } = render(<FitPanel view={saved} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("0"));
    expect(screen.getAllByRole("listitem").map(item => item.textContent)).toEqual([
        ...saved.fit!.assessment.reasons,
        ...saved.fit!.assessment.concerns,
        ...saved.fit!.assessment.unknowns,
    ]);
    expect(container.querySelector("time")).toBeVisible();
    expect(container.querySelector("time")).toHaveAttribute("dateTime", saved.fit!.checkedAt);
    expect(screen.getByText(/13.*27/)).toBeVisible();
});

it("retains an unscorable evaluation instead of treating it as an unassessed Program", () => {
    const saved = view(null);
    saved.fit!.assessment.unknowns = ["The company has not supplied its runway."];
    const { container, rerender } = render(<FitPanel view={saved} />);
    const unscorableLabel = screen.getByRole("img").getAttribute("aria-label");

    expect(screen.getByRole("listitem")).toHaveTextContent(saved.fit!.assessment.unknowns[0]!);
    expect(container.querySelector("time")).toBeVisible();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();

    rerender(<FitPanel view={view(null, false)} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).not.toBe(unscorableLabel);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(container.querySelector("time")).not.toBeInTheDocument();
    expect(screen.queryByText("0", { exact: true })).not.toBeInTheDocument();
});

it("warns when a saved evaluation is stale without discarding its previous score or matched time", () => {
    const saved = { ...view(72), fitStale: true };
    const { container, rerender } = render(<FitPanel view={saved} />);

    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("72"));
    expect(container.querySelector("time")).toHaveAttribute("dateTime", saved.fit!.checkedAt);

    rerender(<FitPanel view={{ ...saved, fitStale: false }} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("72"));
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
