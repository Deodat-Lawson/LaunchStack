/** @jest-environment jsdom */

/**
 * The unified settings surface.
 *
 * The point of the hub is that five sections share one header and one action
 * area. So the things worth asserting are structural: every section is
 * reachable, old deep links still land on the right one, exactly one primary
 * button exists at a time, and it belongs to the section currently on screen.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

// The chrome asks who is looking so it can mark a section read-only; an
// owner sees everything editable.
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({ loaded: true, can: () => true }),
}));

// Member-scoped sections are registry rows over the settings store; the
// chrome tests do not need a network.
jest.mock("~/app/employer/documents/_workspace/settings/AccountSection", () => ({
    AccountSection: () => <div data-testid="body-account">account body</div>,
}));

// Section bodies are exercised by their own tests and by the API tests. Here
// they are replaced with probes that publish known actions, so the assertions
// are about the chrome rather than about five unrelated data fetches.
jest.mock("~/app/employer/documents/_workspace/settings/ProcessingSettings", () => {
    const { usePublishedActions } = jest.requireActual<
        typeof import("~/app/employer/documents/_workspace/settings/contract")
    >("~/app/employer/documents/_workspace/settings/contract");
    return {
        ProcessingSettings: ({ onActions }: { onActions?: unknown }) => {
            usePublishedActions(
                onActions as never,
                { primaryLabel: "Save changes", onPrimary: () => undefined, disabled: false },
                []
            );
            return <div data-testid="body-processing">processing body</div>;
        },
    };
});

jest.mock("~/app/employer/documents/_workspace/collab/AgentsPanel", () => {
    const { usePublishedActions } = jest.requireActual<
        typeof import("~/app/employer/documents/_workspace/settings/contract")
    >("~/app/employer/documents/_workspace/settings/contract");
    return {
        AgentsPanel: ({ onActions }: { onActions?: unknown }) => {
            usePublishedActions(
                onActions as never,
                { primaryLabel: "New agent", onPrimary: () => undefined },
                []
            );
            return <div data-testid="body-agents">agents body</div>;
        },
    };
});

jest.mock("~/app/employer/documents/_workspace/settings/IntegrationsPanel", () => ({
    // Deliberately publishes nothing — a read-only section must not leave a
    // stale button behind from whichever section preceded it.
    IntegrationsPanel: () => <div data-testid="body-integrations">integrations body</div>,
}));

jest.mock("~/app/employer/metadata/MetadataView", () => ({
    MetadataView: ({ bare }: { bare?: boolean }) => (
        <div data-testid="body-company" data-bare={String(Boolean(bare))}>
            company body
        </div>
    ),
}));

import {
    SettingsHub,
    settingsSectionFromHash,
} from "~/app/employer/documents/_workspace/SettingsHub";

/** `next/dynamic` resolves on a microtask; wait for the real body to land. */
async function findBody(testId: string) {
    return waitFor(() => screen.getByTestId(testId));
}

function setHash(hash: string) {
    window.history.replaceState(null, "", `/employer/settings${hash}`);
}

describe("settingsSectionFromHash", () => {
    it("maps every documented alias, including the ones that used to be routes", () => {
        expect(settingsSectionFromHash("#byok")).toBe("processing");
        expect(settingsSectionFromHash("#embedding")).toBe("processing");
        expect(settingsSectionFromHash("#agents")).toBe("agents");
        expect(settingsSectionFromHash("#nodes")).toBe("agents");
        expect(settingsSectionFromHash("#slack")).toBe("integrations");
        expect(settingsSectionFromHash("#metadata")).toBe("company");
        expect(settingsSectionFromHash("#company")).toBe("company");
        expect(settingsSectionFromHash("#password")).toBe("account");
        expect(settingsSectionFromHash("#trash")).toBe("archive");
    });

    it("lands a registry key on its section", () => {
        expect(settingsSectionFromHash("#appearance.theme")).toBe("appearance");
        expect(settingsSectionFromHash("#retention.trashDays")).toBe("archive");
    });

    it("is case-insensitive and tolerates a missing #", () => {
        expect(settingsSectionFromHash("BYOK")).toBe("processing");
        expect(settingsSectionFromHash("#Agents")).toBe("agents");
    });

    it("returns null for an unknown hash rather than guessing", () => {
        expect(settingsSectionFromHash("#nope")).toBeNull();
        expect(settingsSectionFromHash("")).toBeNull();
    });
});

describe("SettingsHub", () => {
    beforeEach(() => {
        setHash("");
        mockReplace.mockReset();
    });

    it("lists every section in one grouped rail", () => {
        render(<SettingsHub />);
        const rail = screen.getByRole("navigation", { name: /settings sections/i });

        for (const label of [
            "Account",
            "Appearance",
            "Shortcuts",
            "People and access",
            "Company profile",
            "Processing",
            "Models and routes",
            "Agents and autonomy",
            "Document defaults",
            "Integrations",
            "Usage and costs",
            "Archive and retention",
            "Data and privacy",
            "Labs",
        ]) {
            expect(within(rail).getByText(label)).toBeInTheDocument();
        }
        for (const group of ["You", "Workspace", "Workspace data"]) {
            expect(within(rail).getByText(group)).toBeInTheDocument();
        }
        expect(within(rail).queryByText("Analytics")).not.toBeInTheDocument();
    });

    it("opens on Account and gives it the one page heading", async () => {
        render(<SettingsHub />);

        await findBody("body-account");
        const headings = screen.getAllByRole("heading", { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent("Who you are, and where you are signed in");
    });

    it("switches sections from the rail", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);
        await findBody("body-account");

        await user.click(screen.getByRole("button", { name: /Agents and autonomy/i }));

        await findBody("body-agents");
        expect(screen.queryByTestId("body-account")).not.toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "Who shows up to a meeting"
        );
    });

    it("renders exactly one primary action, owned by the visible section", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);
        await findBody("body-account");

        await user.click(screen.getByRole("button", { name: /^Processing/i }));
        await findBody("body-processing");
        expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New agent" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Agents and autonomy/i }));
        await findBody("body-agents");

        expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
        // The previous section's Save must not survive the switch.
        expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    });

    it("shows no primary action for a read-only section", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);
        await findBody("body-account");

        await user.click(screen.getByRole("button", { name: /Integrations/i }));
        await findBody("body-integrations");

        expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New agent" })).not.toBeInTheDocument();
    });

    it("opens the section named by the URL hash", async () => {
        setHash("#byok");
        render(<SettingsHub />);

        await findBody("body-processing");
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "How documents get indexed"
        );
    });

    it("sends the analytics hashes to the Studio, where the dashboard lives now", async () => {
        setHash("#statistics");
        render(<SettingsHub />);
        await waitFor(() =>
            expect(mockReplace).toHaveBeenCalledWith("/employer/documents?feature=analytics")
        );
    });

    it("honours a hash change after mount", async () => {
        render(<SettingsHub />);
        await findBody("body-account");

        setHash("#metadata");
        act(() => {
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });

        const body = await findBody("body-company");
        expect(body).toHaveAttribute("data-bare", "true");
    });

    it("lets an explicit initialSection win over the hash", async () => {
        setHash("#byok");
        render(<SettingsHub initialSection="agents" />);

        await findBody("body-agents");
    });

    it("marks the open section for assistive tech", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);

        const rail = screen.getByRole("navigation", { name: /settings sections/i });
        expect(within(rail).getByRole("button", { current: "page" })).toHaveTextContent("Account");

        await user.click(screen.getByRole("button", { name: /Company profile/i }));
        expect(within(rail).getByRole("button", { current: "page" })).toHaveTextContent(
            "Company profile"
        );
    });
});
