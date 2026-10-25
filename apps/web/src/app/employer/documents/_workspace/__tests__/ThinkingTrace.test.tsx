/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThinkingTrace } from "../ThinkingTrace";
import { applyStep, currentStep, durationParts, settleSteps, thoughtParts } from "../turnTrace";
import type { ThreadMessage } from "../types";

const working: ThreadMessage = {
    id: "a1",
    role: "assistant",
    text: "",
    status: "streaming",
    createdAt: new Date().toISOString(),
    steps: [
        {
            id: "search",
            label: "Found 5 passages in 1 source",
            state: "done",
            detail: "Globex MSA 2026.pdf",
            startMs: 80,
            endMs: 930,
        },
        { id: "think", label: "Thinking", state: "active", startMs: 990 },
    ],
};

describe("ThinkingTrace", () => {
    it("is open while the answer works, naming the step in progress", () => {
        render(<ThinkingTrace msg={working} />);
        expect(screen.getByRole("button", { name: /Thinking/ })).toHaveAttribute(
            "aria-expanded",
            "true"
        );
        expect(screen.getByText("Found 5 passages in 1 source")).toBeInTheDocument();
        expect(screen.getByText("Globex MSA 2026.pdf")).toBeInTheDocument();
        expect(screen.getByText("0.9s")).toBeInTheDocument();
    });

    it("streams model reasoning under the thinking step", () => {
        render(<ThinkingTrace msg={{ ...working, reasoning: "Section 12.2 sets 60 days." }} />);
        const think = document.querySelector('[data-step="think"]')!;
        expect(think).toContainElement(screen.getByText("Section 12.2 sets 60 days."));
    });

    it("never shows half-arrived Markdown in live reasoning", () => {
        render(<ThinkingTrace msg={{ ...working, reasoning: "Notice is given **60 da" }} />);
        const box = screen.getByTestId("trace-reasoning");
        expect(box).not.toHaveTextContent("**");
        expect(box.querySelector("strong")).toHaveTextContent("60 da");
    });

    it("folds to 'Thought for Ns' when the first word arrives", () => {
        const { rerender } = render(<ThinkingTrace msg={working} />);
        rerender(<ThinkingTrace msg={{ ...working, text: "Either party", thoughtMs: 4200 }} />);
        const button = screen.getByRole("button", { name: /Thought for 4s/ });
        expect(button).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("Found 5 passages in 1 source")).not.toBeInTheDocument();
    });

    it("keeps the reader's choice over the automatic fold", () => {
        const { rerender } = render(<ThinkingTrace msg={working} />);
        fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
        fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
        rerender(<ThinkingTrace msg={{ ...working, text: "Either", thoughtMs: 2000 }} />);
        expect(screen.getByRole("button", { name: /Thought for 2s/ })).toHaveAttribute(
            "aria-expanded",
            "true"
        );
    });

    it("never shows an empty box for a model that keeps its reasoning private", () => {
        const done: ThreadMessage = {
            ...working,
            text: "Answer.",
            status: "complete",
            thoughtMs: 3100,
            tokens: 3698,
            chunksAnalyzed: 5,
            tokenBreakdown: { inputTokens: 3412, outputTokens: 286 },
            steps: settleSteps(
                [
                    ...working.steps!.slice(0, 1),
                    {
                        id: "think",
                        label: "Thought it through",
                        state: "done",
                        startMs: 990,
                        endMs: 3100,
                    },
                    {
                        id: "write",
                        label: "Wrote the answer",
                        state: "done",
                        startMs: 3100,
                        endMs: 3300,
                    },
                ],
                3300
            ),
        };
        render(<ThinkingTrace msg={done} />);
        fireEvent.click(screen.getByRole("button", { name: /Thought for 3s/ }));
        expect(screen.getByText("Thought it through")).toBeInTheDocument();
        expect(screen.getByText("Wrote the answer")).toBeInTheDocument();
        expect(screen.queryByTestId("trace-reasoning")).not.toBeInTheDocument();
        expect(screen.getByText("3,698 tokens · 5 passages read")).toHaveAttribute(
            "title",
            "3,412 prompt + 286 completion"
        );
    });

    it("words a step a shared chat left unnamed by its kind", () => {
        render(
            <ThinkingTrace
                msg={{
                    role: "assistant",
                    text: "Answer.",
                    status: "complete",
                    thoughtMs: 2000,
                    steps: [
                        { id: "source-1", label: "", state: "done" },
                        { id: "web-2", label: "", state: "done" },
                        { id: "doc-3", label: "", state: "done" },
                    ],
                }}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: /Thought for 2s/ }));
        expect(screen.getByText("Looked through the sources")).toBeInTheDocument();
        expect(screen.getByText("Searched the web")).toBeInTheDocument();
        expect(screen.getByText("Made a document")).toBeInTheDocument();
    });

    it("shows nothing for an older answer with no trace, and says when one stopped", () => {
        const { container, rerender } = render(
            <ThinkingTrace
                msg={{ role: "assistant", text: "Old answer", status: "complete", elapsedMs: 8100 }}
            />
        );
        expect(container).toBeEmptyDOMElement();
        rerender(
            <ThinkingTrace
                msg={{ role: "assistant", text: "Part", status: "stopped", elapsedMs: 2400 }}
            />
        );
        expect(screen.getByText("Stopped after 2s")).toBeInTheDocument();
        rerender(<ThinkingTrace msg={{ role: "assistant", text: "Part", status: "stopped" }} />);
        expect(screen.getByText("Stopped")).toBeInTheDocument();
    });

    it("marks a step cut off by a stop as unfinished, not running", () => {
        render(
            <ThinkingTrace
                msg={{
                    ...working,
                    status: "stopped",
                    elapsedMs: 1500,
                    steps: settleSteps(working.steps, 1500),
                }}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: /Stopped after 2s/ }));
        expect(document.querySelector('[data-step="think"]')).toHaveAttribute(
            "data-state",
            "active"
        );
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
});

describe("turn trace helpers", () => {
    it("upserts a step by id and stamps its start and end", () => {
        let steps = applyStep(undefined, { id: "search", label: "Searching", state: "active" }, 80);
        steps = applyStep(steps, { id: "web", label: "Searching the web", state: "active" }, 90);
        steps = applyStep(
            steps,
            { id: "search", label: "Found 2 passages", state: "done", detail: "a.pdf" },
            900.4
        );
        expect(steps).toEqual([
            {
                id: "search",
                label: "Found 2 passages",
                state: "done",
                detail: "a.pdf",
                startMs: 80,
                endMs: 900,
            },
            { id: "web", label: "Searching the web", state: "active", startMs: 90 },
        ]);
        expect(currentStep(steps)?.id).toBe("web");
    });

    it("treats a step first seen as done as instant", () => {
        expect(applyStep([], { id: "history", label: "Reviewed", state: "done" }, 12)).toEqual([
            { id: "history", label: "Reviewed", state: "done", startMs: 12, endMs: 12 },
        ]);
    });

    it("closes open steps when the turn ends", () => {
        expect(
            settleSteps([{ id: "think", label: "Thinking", state: "active", startMs: 5 }], 700)
        ).toEqual([{ id: "think", label: "Thinking", state: "active", startMs: 5, endMs: 700 }]);
    });

    it("splits durations for steps and the headline", () => {
        expect(durationParts(850)).toEqual({ seconds: "0.9" });
        expect(durationParts(12_400)).toEqual({ seconds: "12" });
        expect(durationParts(65_000)).toEqual({ minutes: 1, seconds: "05" });
        expect(thoughtParts(200)).toEqual({ seconds: "1" });
        expect(thoughtParts(4_200)).toEqual({ seconds: "4" });
        expect(thoughtParts(75_000)).toEqual({ minutes: 1, seconds: "15" });
    });
});
