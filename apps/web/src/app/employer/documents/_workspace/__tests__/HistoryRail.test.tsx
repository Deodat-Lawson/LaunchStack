/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { HistoryEntry } from "~/lib/workspace-history";

import { ContextMenuProvider } from "~/components/context-menu";
import { HistoryRail, type HistoryRailProps } from "../HistoryRail";

/**
 * The History tab. Two kinds of row live in one list and behave differently on
 * click — a chat reopens, a run navigates, and a run with nowhere to go stays
 * put rather than pretending to be a link.
 */

function entry(over: Partial<HistoryEntry> & Pick<HistoryEntry, "id">): HistoryEntry {
    return {
        kind: "chat",
        refId: over.refId ?? over.id,
        title: over.title ?? over.id,
        status: "done",
        at: new Date().toISOString(),
        ...over,
    };
}

const CHAT = entry({
    id: "chat:s1",
    refId: "s1",
    title: "Indemnity cap",
    messageCount: 4,
    href: "/employer/documents?session=s1",
});

const RUN = entry({
    id: "distribution:r1",
    refId: "r1",
    kind: "distribution",
    title: "Q3 partners",
    subtitle: "Partner discovery",
    status: "running",
    href: "/employer/tools/distribution",
});

/** A vertical with no surface yet: it lists, but it is not a link. */
const HEADLESS_RUN = entry({
    id: "trend-search:t1",
    refId: "t1",
    kind: "trend-search",
    title: "AI tooling in fintech",
    status: "failed",
});

function setup(over: Partial<HistoryRailProps> = {}) {
    const props: HistoryRailProps = {
        entries: [CHAT, RUN, HEADLESS_RUN],
        loading: false,
        error: null,
        degraded: [],
        activeSessionId: null,
        query: "",
        onNewChat: jest.fn(),
        onResumeSession: jest.fn(),
        onOpenRun: jest.fn(),
        onRenameSession: jest.fn(),
        onDeleteSession: jest.fn(),
        onRefresh: jest.fn(),
        ...over,
    };
    render(
        <ContextMenuProvider>
            <HistoryRail {...props} />
        </ContextMenuProvider>
    );
    return props;
}

describe("HistoryRail", () => {
    it("lists chats and runs together under a date heading", () => {
        setup();
        expect(screen.getByText("Today")).toBeInTheDocument();
        expect(screen.getByText("Indemnity cap")).toBeInTheDocument();
        expect(screen.getByText("Q3 partners")).toBeInTheDocument();
        expect(screen.getByText("AI tooling in fintech")).toBeInTheDocument();
    });

    it("shows a chat's turn count, and a run's own subtitle", () => {
        setup();
        expect(screen.getByText("Chat · 4 turns")).toBeInTheDocument();
        expect(screen.getByText("Partner discovery")).toBeInTheDocument();
    });

    it("resumes a chat by its session id, not by its feed id", () => {
        const props = setup();
        fireEvent.click(screen.getByTestId("history-row-chat:s1"));
        expect(props.onResumeSession).toHaveBeenCalledWith("s1");
        expect(props.onOpenRun).not.toHaveBeenCalled();
    });

    it("opens a run through its own surface", () => {
        const props = setup();
        fireEvent.click(screen.getByTestId("history-row-distribution:r1"));
        expect(props.onOpenRun).toHaveBeenCalledWith(RUN);
        expect(props.onResumeSession).not.toHaveBeenCalled();
    });

    it("does nothing when a run has no surface to open", () => {
        const props = setup();
        const row = screen.getByTestId("history-row-trend-search:t1");
        expect(row).toHaveAttribute("tabindex", "-1");
        fireEvent.click(row);
        expect(props.onOpenRun).not.toHaveBeenCalled();
    });

    it("badges a run that is still going, and one that failed", () => {
        setup();
        expect(
            within(screen.getByTestId("history-row-distribution:r1")).getByLabelText("Running")
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("history-row-trend-search:t1")).getByLabelText("Failed")
        ).toBeInTheDocument();
        // A finished chat carries no badge — the dot is for news, not decoration.
        expect(
            within(screen.getByTestId("history-row-chat:s1")).queryByLabelText("Done")
        ).not.toBeInTheDocument();
    });

    it("marks the open chat as current", () => {
        setup({ activeSessionId: "s1" });
        expect(screen.getByTestId("history-row-chat:s1")).toHaveAttribute("aria-current", "true");
        expect(screen.getByTestId("history-row-distribution:r1")).not.toHaveAttribute(
            "aria-current"
        );
    });

    it("filters on the rail's shared search box", () => {
        setup({ query: "partner" });
        expect(screen.getByText("Q3 partners")).toBeInTheDocument();
        expect(screen.queryByText("Indemnity cap")).not.toBeInTheDocument();
    });

    it("says so when a search matches nothing, without offering an empty-state pitch", () => {
        setup({ query: "zzz" });
        expect(screen.getByText("Nothing in history matches that.")).toBeInTheDocument();
    });

    it("invites a first question when there is genuinely nothing", () => {
        setup({ entries: [] });
        expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    });

    it("names the verticals it could not load instead of quietly shortening the list", () => {
        setup({ degraded: ["distribution", "email"] });
        expect(
            screen.getByText(/Distribution, Email campaign/, { exact: false })
        ).toBeInTheDocument();
    });

    it("offers a retry when the whole feed failed", () => {
        const props = setup({ error: "Couldn't load history", entries: [] });
        fireEvent.click(screen.getByText("Retry"));
        expect(props.onRefresh).toHaveBeenCalled();
    });

    it("renames a chat in place, sending the session id and the new title", () => {
        const props = setup();
        fireEvent.click(screen.getByLabelText("Actions for Indemnity cap"));
        fireEvent.click(screen.getByText("Rename…"));

        const input = screen.getByTestId("history-rename-input");
        fireEvent.change(input, { target: { value: "Vendor review" } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(props.onRenameSession).toHaveBeenCalledWith("s1", "Vendor review");
    });

    it("does not fire a rename that changes nothing", () => {
        const props = setup();
        fireEvent.click(screen.getByLabelText("Actions for Indemnity cap"));
        fireEvent.click(screen.getByText("Rename…"));

        const input = screen.getByTestId("history-rename-input");
        fireEvent.change(input, { target: { value: "  Indemnity cap  " } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(props.onRenameSession).not.toHaveBeenCalled();
    });

    it("abandons a rename on Escape", () => {
        const props = setup();
        fireEvent.click(screen.getByLabelText("Actions for Indemnity cap"));
        fireEvent.click(screen.getByText("Rename…"));

        const input = screen.getByTestId("history-rename-input");
        fireEvent.change(input, { target: { value: "Never mind" } });
        fireEvent.keyDown(input, { key: "Escape" });

        expect(props.onRenameSession).not.toHaveBeenCalled();
        expect(screen.queryByTestId("history-rename-input")).not.toBeInTheDocument();
    });

    it("deletes a chat by session id", () => {
        const props = setup();
        fireEvent.click(screen.getByLabelText("Actions for Indemnity cap"));
        fireEvent.click(screen.getByText("Delete chat"));
        expect(props.onDeleteSession).toHaveBeenCalledWith("s1");
    });

    it("starts a new chat from the list header", () => {
        const props = setup();
        fireEvent.click(screen.getByTestId("history-new-chat"));
        expect(props.onNewChat).toHaveBeenCalled();
    });
});
