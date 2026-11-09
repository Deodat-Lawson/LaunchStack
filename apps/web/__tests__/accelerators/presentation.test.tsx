/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { CatalogueProgramSchema, type ProgramView } from "@launchstack/pipelines/accelerators";

import programFixture from "../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json";
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
                  rubricVersion: null,
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
