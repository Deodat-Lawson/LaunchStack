/** @jest-environment jsdom */

/**
 * Vantage's Program › Triage screen is the program's side of the table. Its
 * API refuses anyone without settings.manage; the screen must not ask, and
 * no list on it may say "nothing here" without an answer to say it from —
 * not to a member, not while permissions or the first response are on their
 * way, and not under an error.
 *
 * The fixture has no help requests on purpose: their rows link to the agenda,
 * and which link component does that differs between branches. Everything
 * asserted here is about the gate and the empty states, not the links.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import type * as UseResource from "~/lib/tools/useResource";

const mockPerms = { loaded: true, allowed: false, error: null as string | null };
const mockRefresh = jest.fn();
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: mockPerms.loaded,
        error: mockPerms.error,
        refresh: () => mockRefresh(),
        can: (permission: string) => mockPerms.allowed && permission === "settings.manage",
    }),
}));

const mockTriage = jest.fn();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    vantageApi: {
        triage: () => mockTriage(),
        addDeadline: jest.fn(),
        deleteDeadline: jest.fn(),
    },
}));

/**
 * The real hook by default. A test can pin the state it returns to the one
 * render that sits between "the key just became non-null" and "the fetch
 * effect has run" — no data, no error, not loading — which act() otherwise
 * flushes past before an assertion can see it.
 */
const mockResourceState: { pinned: unknown } = { pinned: null };
jest.mock("~/lib/tools/useResource", () => {
    const actual = jest.requireActual<typeof UseResource>("~/lib/tools/useResource");
    return {
        useResource: (...args: Parameters<typeof actual.useResource>) =>
            mockResourceState.pinned ?? actual.useResource(...args),
    };
});

import { TriageScreen } from "~/app/employer/tools/vantage/_screens/TriageScreen";

const triage = {
    today: "2026-10-03",
    helpRequests: [],
    missedCommitments: [],
    dueSoon: [
        {
            id: "c1",
            title: "Finish two design-partner interviews",
            owner: "Dev Member",
            dueOn: "2026-10-09",
        },
    ],
    deadlines: [{ id: "d1", title: "Demo day", dueOn: "2026-10-22", note: null }],
    lastEntryAt: null,
    daysSinceLastEntry: null,
    quiet: true,
};

const EMPTY_CLAIMS = ["No open requests", "Nothing shared has slipped.", "No program deadlines"];

function expectNoEmptyClaims() {
    for (const text of EMPTY_CLAIMS) {
        expect(screen.queryByText(text, { exact: false })).not.toBeInTheDocument();
    }
}

beforeEach(() => {
    mockTriage.mockReset().mockResolvedValue(triage);
    mockRefresh.mockReset();
    mockPerms.loaded = true;
    mockPerms.allowed = false;
    mockPerms.error = null;
    mockResourceState.pinned = null;
});

describe("TriageScreen", () => {
    it("tells a member whose screen it is, without asking the API or showing empty lists", () => {
        render(<TriageScreen />);

        expect(screen.getByText("Triage is the program's view")).toBeInTheDocument();
        expectNoEmptyClaims();
        expect(screen.queryByRole("button", { name: /deadline/i })).not.toBeInTheDocument();
        expect(mockTriage).not.toHaveBeenCalled();
    });

    it("shows an admin what is due and the program deadlines", async () => {
        mockPerms.allowed = true;

        render(<TriageScreen />);

        expect(await screen.findByText("Demo day")).toBeInTheDocument();
        expect(screen.getByText("Finish two design-partner interviews")).toBeInTheDocument();
        expect(screen.queryByText("Triage is the program's view")).not.toBeInTheDocument();
        expect(mockTriage).toHaveBeenCalledTimes(1);
    });

    it("claims nothing while permissions are still loading", async () => {
        mockPerms.loaded = false;

        render(<TriageScreen />);

        await waitFor(() => expect(mockTriage).not.toHaveBeenCalled());
        expect(screen.queryByText("Triage is the program's view")).not.toBeInTheDocument();
        expectNoEmptyClaims();
    });

    it("claims nothing in the render before an admin's first response is requested", () => {
        mockPerms.allowed = true;
        mockResourceState.pinned = {
            data: null,
            loading: false,
            error: null,
            reload: jest.fn(),
            mutate: jest.fn(),
        };

        render(<TriageScreen />);

        expectNoEmptyClaims();
    });

    it("shows only the error when an admin's first response fails", async () => {
        mockPerms.allowed = true;
        mockTriage.mockRejectedValue(new Error("Internal server error"));

        render(<TriageScreen />);

        expect(await screen.findByText("Internal server error")).toBeInTheDocument();
        expectNoEmptyClaims();
    });

    it("does not tell an admin they lack access when their permissions failed to load", () => {
        mockPerms.error = "Could not load your permissions.";

        render(<TriageScreen />);

        expect(screen.getByText("Could not load your permissions.")).toBeInTheDocument();
        expect(screen.queryByText("Triage is the program's view")).not.toBeInTheDocument();
        screen.getByRole("button", { name: "Retry" }).click();
        expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
});
