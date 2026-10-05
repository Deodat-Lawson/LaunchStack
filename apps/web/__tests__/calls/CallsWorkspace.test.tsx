/** @jest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
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
    workerErrorPausedCall,
} from "~/app/calls/_fixtures/callSnapshots";

jest.mock("~/app/calls/_components/CallsChat", () => ({
    CallsChat: () => null,
}));

// Markdown rendering is exercised in the browser; keep these interaction tests
// independent of Jest's unsupported pnpm ESM module loading.
jest.mock("react-markdown", () => ({
    __esModule: true,
    default: ({ children }: { children: string }) => children,
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => undefined }));

describe("CallsWorkspace", () => {
    it("renders a selected completed call's title, note, and transcript segments", async () => {
        const user = userEvent.setup();
        render(
            <CallsWorkspace
                calls={[northstarPricingReviewCall]}
                initialSelectedId={northstarPricingReviewCall.id}
            />
        );

        expect(
            screen.getByRole("heading", { name: /northstar pricing review/i })
        ).toBeInTheDocument();
        expect(screen.getByText(/enterprise tier draft in progress/i)).toBeInTheDocument();
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            /completed/i
        );

        await user.click(screen.getByRole("button", { name: /show transcript/i }));
        const transcript = screen.getByLabelText("Company transcript");
        expect(
            within(transcript).getByText(/finalize the pricing tiers before friday/i)
        ).toBeInTheDocument();
        expect(within(transcript).getByText("Me")).toBeInTheDocument();
        expect(within(transcript).getByText("Meeting")).toBeInTheDocument();

        await user.type(
            within(transcript).getByRole("textbox", { name: /search transcript/i }),
            "enterprise"
        );
        expect(
            within(transcript).getByText(northstarPricingReviewCall.transcript[1]!.text)
        ).toBeInTheDocument();
        expect(
            within(transcript).queryByText(northstarPricingReviewCall.transcript[0]!.text)
        ).toBeNull();

        await user.click(within(transcript).getByRole("button", { name: /close transcript/i }));
        expect(screen.queryByRole("complementary", { name: "Company transcript" })).toBeNull();
        expect(screen.getByRole("button", { name: "Show transcript" })).toHaveFocus();
        await user.click(screen.getByRole("button", { name: "Show transcript" }));
        expect(screen.getByRole("textbox", { name: "Search transcript" })).toHaveValue(
            "enterprise"
        );
    });

    it("shows Paused without an error alert for a user-paused capture", () => {
        const userPausedCall = {
            ...pausedCall,
            capture: { ...pausedCall.capture, pausedReason: "user" as const },
        };
        render(<CallsWorkspace calls={[userPausedCall]} initialSelectedId={userPausedCall.id} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            /^Paused$/
        );
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("explains a worker-error pause and offers Resume without losing the Transcript", async () => {
        const user = userEvent.setup();
        render(
            <CallsWorkspace
                calls={[workerErrorPausedCall]}
                initialSelectedId={workerErrorPausedCall.id}
            />
        );

        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            "Paused — capture error"
        );
        expect(screen.getByRole("alert")).toHaveTextContent(/local capture worker stopped/i);
        expect(screen.getByRole("alert")).toHaveTextContent(/transcript so far is kept/i);
        expect(screen.getByRole("alert")).toHaveTextContent(/resume continues this call/i);
        expect(screen.getByRole("alert")).toHaveTextContent(/worker must be running/i);
        expect(screen.getByRole("button", { name: "Resume capture" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Stop capture" })).toBeEnabled();

        await user.click(screen.getByRole("button", { name: "Show transcript" }));
        const transcript = screen.getByLabelText("Company transcript");
        for (const segment of workerErrorPausedCall.transcript) {
            expect(within(transcript).getByText(segment.text)).toBeInTheDocument();
        }
    });

    it("shows Failed status for a selected failed capture", () => {
        render(<CallsWorkspace calls={[failedCall]} initialSelectedId={failedCall.id} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            /failed/i
        );
        expect(screen.getByRole("alert")).toHaveTextContent(/capture did not finish successfully/i);
        expect(screen.queryByRole("button", { name: "Resume capture" })).not.toBeInTheDocument();
    });

    it("marks a partial call and renders the gap in the transcript timeline", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[partialCall]} initialSelectedId={partialCall.id} />);
        expect(screen.getByRole("status", { name: /capture status/i })).toHaveTextContent(
            /partial/i
        );

        await user.click(screen.getByRole("button", { name: /show transcript/i }));
        const transcript = screen.getByLabelText("Company transcript");
        expect(within(transcript).getByText(/capture paused/i)).toBeInTheDocument();
        expect(within(transcript).getByText(/45s not transcribed/i)).toBeInTheDocument();
    });

    it("redacts a private note for a non-owner", () => {
        render(<CallsWorkspace calls={[redactedCall]} initialSelectedId={redactedCall.id} />);
        expect(screen.getByText(/private to the owner/i)).toBeInTheDocument();
    });

    it("shows the AI-enhanced proposal when enrichment is ready", async () => {
        const user = userEvent.setup();
        render(
            <CallsWorkspace
                calls={[enrichmentReadyCall]}
                initialSelectedId={enrichmentReadyCall.id}
            />
        );

        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        expect(
            await screen.findByText(/finalize the pricing tiers by friday/i)
        ).toBeInTheDocument();
    });

    it("navigates from the home note list to a note and back home", async () => {
        const user = userEvent.setup();
        const onSelectCall = jest.fn();
        render(
            <CallsWorkspace
                calls={[northstarPricingReviewCall, failedCall]}
                onSelectCall={onSelectCall}
            />
        );

        expect(screen.getByRole("main", { name: /calls library/i })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /northstar pricing review/i }));
        expect(onSelectCall).toHaveBeenLastCalledWith(northstarPricingReviewCall.id);
        expect(
            screen.getByRole("heading", { name: /northstar pricing review/i })
        ).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /back to all notes/i }));
        expect(onSelectCall).toHaveBeenLastCalledWith(null);
        expect(screen.getByRole("main", { name: /calls library/i })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: /northstar pricing review/i })).toBeNull();
    });

    it("filters home notes after Search notes is opened", async () => {
        const user = userEvent.setup();
        render(<CallsWorkspace calls={[northstarPricingReviewCall, failedCall]} />);

        expect(screen.queryByRole("textbox", { name: /search calls/i })).toBeNull();
        await user.click(screen.getByRole("button", { name: /search notes/i }));
        const search = screen.getByRole("textbox", { name: /search calls/i });
        await user.type(search, "northstar");

        expect(
            screen.getByRole("button", { name: /northstar pricing review/i })
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /dropped investor call/i })).toBeNull();
    });

    it("follows browser selection changes through initialSelectedId", async () => {
        const { rerender } = render(
            <CallsWorkspace
                calls={[northstarPricingReviewCall, failedCall]}
                initialSelectedId={null}
            />
        );
        expect(screen.getByRole("main", { name: /calls library/i })).toBeInTheDocument();

        rerender(
            <CallsWorkspace
                calls={[northstarPricingReviewCall, failedCall]}
                initialSelectedId={failedCall.id}
            />
        );
        await waitFor(() =>
            expect(
                screen.getByRole("heading", { name: /dropped investor call/i })
            ).toBeInTheDocument()
        );

        rerender(
            <CallsWorkspace
                calls={[northstarPricingReviewCall, failedCall]}
                initialSelectedId={null}
            />
        );
        await waitFor(() =>
            expect(screen.getByRole("main", { name: /calls library/i })).toBeInTheDocument()
        );
    });

    it("renders the home state when there are no calls", () => {
        render(<CallsWorkspace calls={[]} />);
        expect(screen.getByRole("main", { name: /calls library/i })).toBeInTheDocument();
        expect(screen.getByText(/your next conversation starts here/i)).toBeInTheDocument();
    });

    it("offers an explicit Start capture action from an empty workspace", async () => {
        const user = userEvent.setup();
        const onStartCapture = jest.fn();
        render(<CallsWorkspace calls={[]} onStartCapture={onStartCapture} />);

        await user.click(screen.getByRole("button", { name: /start capture/i }));
        expect(onStartCapture).toHaveBeenCalledTimes(1);
    });

    it("disables Start while capturing and allows an owner to resume or stop", async () => {
        const user = userEvent.setup();
        const onStartCapture = jest.fn();
        const onResumeCapture = jest.fn();
        const onStopCapture = jest.fn();
        render(
            <CallsWorkspace
                calls={[pausedCall]}
                initialSelectedId={pausedCall.id}
                onStartCapture={onStartCapture}
                onResumeCapture={onResumeCapture}
                onStopCapture={onStopCapture}
            />
        );

        expect(screen.getByRole("button", { name: /start capture/i })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Resume capture" }));
        expect(onResumeCapture).toHaveBeenCalledWith(pausedCall.id);
        await user.click(screen.getByRole("button", { name: /stop capture/i }));
        expect(onStopCapture).toHaveBeenCalledWith(pausedCall.id);
    });

    it("does not expose Resume or Stop to a viewer without capture control", () => {
        const readOnlyActiveCall = {
            ...pausedCall,
            viewerCapabilities: { ...pausedCall.viewerCapabilities, canControlCapture: false },
        };
        render(
            <CallsWorkspace
                calls={[readOnlyActiveCall]}
                initialSelectedId={readOnlyActiveCall.id}
            />
        );

        expect(screen.queryByRole("button", { name: /stop capture/i })).toBeNull();
        expect(screen.queryByRole("button", { name: "Resume capture" })).not.toBeInTheDocument();
    });

    it("shows command errors with a retry action", async () => {
        const user = userEvent.setup();
        const onRetryCommand = jest.fn();
        render(
            <CallsWorkspace
                calls={[]}
                commandError="The capture worker is unavailable"
                onRetryCommand={onRetryCommand}
            />
        );

        expect(screen.getByRole("alert")).toHaveTextContent(/worker is unavailable/i);
        await user.click(screen.getByRole("button", { name: /retry/i }));
        expect(onRetryCommand).toHaveBeenCalledTimes(1);
    });
    it("exposes enrichment rejection", async () => {
        const user = userEvent.setup();
        const onRejectEnrichment = jest.fn();
        render(
            <CallsWorkspace
                calls={[enrichmentReadyCall]}
                initialSelectedId={enrichmentReadyCall.id}
                onRejectEnrichment={onRejectEnrichment}
            />
        );

        await user.click(screen.getByRole("tab", { name: /ai enhanced/i }));
        await user.click(screen.getByRole("button", { name: "Reject" }));
        expect(onRejectEnrichment).toHaveBeenCalledWith(
            enrichmentReadyCall.id,
            enrichmentReadyCall.enrichment!.id
        );
    });
});
