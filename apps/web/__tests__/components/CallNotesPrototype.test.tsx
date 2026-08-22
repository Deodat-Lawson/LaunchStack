/** @jest-environment jsdom */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CallNotesPrototype } from "~/app/prototypes/call-notes/CallNotesPrototype";

function setRoute(scenario = "detected") {
    window.history.replaceState(null, "", `/prototypes/call-notes?scenario=${scenario}`);
}

async function startDetectedCall(user: UserEvent) {
    const notification = screen.getByRole("region", { name: /detected zoom call/i });
    await user.click(within(notification).getByRole("button", { name: /start capture/i }));
    expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
        /connecting/i
    );
    await waitFor(() =>
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/live/i)
    );
}

describe("Call Notes collapsed workspace", () => {
    it("keeps the Calls rail visible and switches between note views", async () => {
        const user = userEvent.setup();
        setRoute();
        render(<CallNotesPrototype />);

        expect(screen.getByRole("complementary", { name: /calls library/i })).toBeInTheDocument();
        expect(screen.getByRole("main")).toBeInTheDocument();
        expect(
            screen.queryByRole("navigation", { name: /prototype variants/i })
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^transcript/i })).toHaveAttribute(
            "aria-expanded",
            "false"
        );
        expect(screen.getByRole("tab", { name: /my notes/i })).toHaveAttribute(
            "aria-selected",
            "true"
        );
        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        expect(screen.getByRole("tabpanel", { name: /ai enhanced note/i })).toHaveTextContent(
            /starts after capture/i
        );
        await user.click(screen.getByRole("tab", { name: /my notes/i }));
        expect(screen.getByRole("textbox", { name: /call note/i })).toBeInTheDocument();
    });

    it("filters transcript segments and clears the search", async () => {
        const user = userEvent.setup();
        setRoute("review");
        render(<CallNotesPrototype />);

        await user.click(screen.getByRole("button", { name: /^transcript/i }));
        await user.type(screen.getByRole("textbox", { name: /search transcript/i }), "operations");
        const transcript = screen.getByLabelText("Transcript segments");
        expect(within(transcript).getByText(/pricing still feels hard/i)).toBeInTheDocument();
        expect(within(transcript).queryByText(/thanks for making time/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /clear transcript search/i }));
        expect(within(transcript).getByText(/thanks for making time/i)).toBeInTheDocument();
    });

    it("starts a detected Call, preserves the note, and records a paused interval", async () => {
        const user = userEvent.setup();
        setRoute();
        render(<CallNotesPrototype />);
        await startDetectedCall(user);

        const note = screen.getByRole("textbox", { name: /call note/i });
        await user.click(note);
        await user.keyboard("Pricing concerns and launch sequencing.");
        expect(note).toHaveTextContent(/pricing concerns/i);

        await user.click(screen.getByRole("button", { name: /^transcript/i }));
        await user.click(screen.getByRole("button", { name: /pause/i }));
        const captureStatus = screen.getByRole("status", { name: /capture status/i });
        expect(captureStatus).toHaveTextContent(/paused/i);
        expect(captureStatus).toHaveTextContent(/partial/i);
        expect(screen.getByText("Capture paused")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /resume/i }));
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/live/i);
        expect(note).toHaveTextContent(/pricing concerns/i);
    });

    it("lets the owner change visibility and add a commented shared Bookmark", async () => {
        const user = userEvent.setup();
        setRoute();
        render(<CallNotesPrototype />);
        await startDetectedCall(user);

        const visibility = screen.getByRole("switch", { name: /shared with company/i });
        expect(visibility).toBeChecked();
        await user.click(visibility);
        expect(visibility).not.toBeChecked();
        expect(screen.getByText(/private to you/i)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^transcript/i }));
        await user.click(screen.getAllByRole("button", { name: /bookmark segment/i })[0]!);
        const bookmarkDialog = screen.getByRole("dialog", { name: /add bookmark/i });
        await user.type(
            within(bookmarkDialog).getByRole("textbox", { name: /bookmark comment/i }),
            "Keep the exact customer wording."
        );
        await user.click(within(bookmarkDialog).getByRole("button", { name: /save bookmark/i }));

        expect(screen.getByText("Keep the exact customer wording.")).toBeInTheDocument();
    });

    it("keeps a failed Call Note and retries through the same capture flow", async () => {
        const user = userEvent.setup();
        setRoute("failure");
        render(<CallNotesPrototype />);

        expect(screen.getByRole("alert")).toHaveTextContent(/could not start rtms/i);
        expect(screen.getByRole("textbox", { name: /call note/i })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /retry capture/i }));
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            /connecting/i
        );
        await waitFor(() =>
            expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
                /live/i
            )
        );
    });

    it("reviews an owner-only enrichment proposal beside the canonical Call Note", async () => {
        const user = userEvent.setup();
        setRoute("review");
        render(<CallNotesPrototype />);

        expect(screen.getByLabelText(/enrichment ready/i)).toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        expect(screen.getByText(/ready to review/i)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /review enrichment/i }));
        expect(screen.getByRole("region", { name: /current call note/i })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: /enriched note proposal/i })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /open transcript evidence/i }));
        expect(screen.getByRole("dialog", { name: /transcript evidence/i })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await act(async () => {
            await user.click(screen.getByRole("button", { name: /accept proposal/i }));
        });
        expect(screen.getByText(/revision accepted/i)).toBeInTheDocument();
    });
});
