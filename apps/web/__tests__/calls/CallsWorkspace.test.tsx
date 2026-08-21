/** @jest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CallsWorkspace } from "~/app/calls/_components/CallsWorkspace";
import {
    enrichmentReadyCall,
    failedCall,
    northstarPricingReviewCall,
    partialCall,
    pausedCall,
    redactedCall,
} from "~/app/calls/_fixtures/callSnapshots";

describe("CallsWorkspace", () => {
    it("renders a completed call's title, note, and transcript segments", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[northstarPricingReviewCall]} />);

        const panel = screen.getByRole("main");
        expect(
            within(panel).getByRole("heading", { name: /northstar pricing review/i })
        ).toBeInTheDocument();
        expect(within(panel).getByText(/hank drafting the enterprise tier/i)).toBeInTheDocument();

        // completed call has no capture control in the panel
        expect(within(panel).queryByRole("button", { name: /^(start|pause|resume)$/i })).toBeNull();
        expect(within(panel).queryByRole("button", { name: /retry capture/i })).toBeNull();

        await user.click(within(panel).getByRole("button", { name: /transcript/i }));
        const transcript = screen.getByLabelText("Transcript segments");
        expect(
            within(transcript).getByText(/finalize the pricing tiers before friday/i)
        ).toBeInTheDocument();
    });

    it("shows Paused status with a Resume control for a paused capture", () => {
        render(<CallsWorkspace calls={[pausedCall]} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/paused/i);
        expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    });

    it("shows Failed status with a Retry control for a failed capture", () => {
        render(<CallsWorkspace calls={[failedCall]} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/failed/i);
        expect(screen.getByRole("button", { name: /retry capture/i })).toBeInTheDocument();
    });

    it("marks a partial call and renders the gap in the transcript timeline", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[partialCall]} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/partial/i);

        await user.click(screen.getByRole("button", { name: /transcript/i }));
        const transcript = screen.getByLabelText("Transcript segments");
        expect(within(transcript).getByText(/capture paused/i)).toBeInTheDocument();
        expect(within(transcript).getByText(/45s not transcribed/i)).toBeInTheDocument();
    });

    it("redacts a private note for a non-owner", () => {
        render(<CallsWorkspace calls={[redactedCall]} />);
        expect(screen.getByText(/private to the owner/i)).toBeInTheDocument();
    });

    it("shows the AI-enhanced proposal when enrichment is ready", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[enrichmentReadyCall]} />);

        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        expect(screen.getByText(/finalize the pricing tiers by friday/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /review suggestion/i })).toBeInTheDocument();
    });

    it("lists every call in the rail and switches the panel when one is selected", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[northstarPricingReviewCall, failedCall]} />);

        const rail = screen.getByRole("complementary", { name: /calls library/i });
        expect(within(rail).getByRole("button", { name: /northstar pricing review/i })).toBeInTheDocument();
        expect(within(rail).getByRole("button", { name: /dropped investor call/i })).toBeInTheDocument();

        const panel = screen.getByRole("main");
        expect(within(panel).getByRole("heading", { name: /northstar pricing review/i })).toBeInTheDocument();

        await user.click(within(rail).getByRole("button", { name: /dropped investor call/i }));
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(/failed/i);
        expect(screen.getByRole("button", { name: /retry capture/i })).toBeInTheDocument();
    });

    it("resets panel view state when switching to another call", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[enrichmentReadyCall, redactedCall]} />);

        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        expect(screen.getByText(/finalize the pricing tiers by friday/i)).toBeInTheDocument();

        // switching calls should reset the panel back to My notes (not stay on AI)
        const rail = screen.getByRole("complementary", { name: /calls library/i });
        await user.click(within(rail).getByRole("button", { name: /private 1:1/i }));
        expect(screen.getByText(/private to the owner/i)).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /my notes/i })).toHaveAttribute(
            "aria-selected",
            "true"
        );
    });

    it("filters the rail by call title", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[northstarPricingReviewCall, failedCall]} />);

        const rail = screen.getByRole("complementary", { name: /calls library/i });
        await user.type(within(rail).getByRole("textbox", { name: /search calls/i }), "northstar");

        expect(
            within(rail).getByRole("button", { name: /northstar pricing review/i })
        ).toBeInTheDocument();
        expect(within(rail).queryByRole("button", { name: /dropped investor call/i })).toBeNull();
    });
});
