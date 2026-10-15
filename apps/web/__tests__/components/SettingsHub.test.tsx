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
    usePathname: () => "/employer/settings",
}));

// The chrome asks who is looking: which sections to list, and which to mark
// read-only. Unless a test says otherwise, an owner, who sees everything
// editable.
type MockPermissions = {
    loaded: boolean;
    error: string | null;
    roleName: string | null;
    permissions: ReadonlySet<string> | "all";
};
const OWNER: MockPermissions = { loaded: true, error: null, roleName: "Owner", permissions: "all" };
let mockPermissions: MockPermissions = OWNER;
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: mockPermissions.loaded,
        error: mockPermissions.error,
        roleName: mockPermissions.roleName,
        can: (p: string | undefined) => {
            if (p === undefined) return true;
            if (!mockPermissions.loaded) return false;
            return mockPermissions.permissions === "all" || mockPermissions.permissions.has(p);
        },
    }),
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

// The company section is the shared company profile, drawn as a section body
// (the hub owns the title); its own test covers what it shows.
jest.mock("~/components/company-profile/CompanyProfileView", () => ({
    CompanyProfileView: ({ variant }: { variant: string }) => (
        <div data-testid="body-company" data-variant={variant}>
            company body
        </div>
    ),
}));

import {
    SettingsHub,
    settingsSectionFromHash,
} from "~/app/employer/documents/_workspace/SettingsHub";
import { WorkspaceAnswerStyleRow } from "~/app/employer/documents/_workspace/settings/AnswerStyle";
import { BUILTIN_ROLE_PERMISSIONS, ROLE_LABELS, type BuiltinRole } from "~/lib/authz/permissions";
import type { ResolvedSetting, SettingWriteRequest } from "~/lib/settings/types";
import { resetSettingsForTests } from "~/lib/settings/useSettings";

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
        // The personal row, which every role can reach; not the admins' one.
        expect(settingsSectionFromHash("#chat.responseStyle")).toBe("appearance");
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
        mockPermissions = OWNER;
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
        expect(body).toHaveAttribute("data-variant", "settings");
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

    /**
     * The way back lives in the rail's header now rather than in a strip
     * across the page. Standalone, Settings is one level under the Studio;
     * embedded as a Studio tab it has nowhere to go back to.
     */
    it("leads the rail with the way back when it is a page of its own", () => {
        render(<SettingsHub />);
        const back = screen.getByTestId("rail-back-link");
        expect(back).toHaveAttribute("href", "/employer/documents");
        expect(back).toHaveAccessibleName("Back to Studio");
    });

    it("offers no way back when it is a tab inside the Studio", () => {
        render(<SettingsHub embedded />);
        expect(screen.queryByTestId("rail-back-link")).not.toBeInTheDocument();
    });
});

/**
 * Settings is open to every role. The You sections are everyone's; each
 * workspace section is listed for whoever may see it, read-only for whoever
 * may only read it, and a link to one someone may not see says why.
 */
describe("SettingsHub by role", () => {
    const as = (role: BuiltinRole) => {
        mockPermissions = {
            loaded: true,
            error: null,
            roleName: ROLE_LABELS[role],
            permissions: BUILTIN_ROLE_PERMISSIONS[role],
        };
    };
    const railLabels = () =>
        within(screen.getByRole("navigation", { name: /settings sections/i }))
            .getAllByRole("button")
            .map(button => button.querySelector("span > span")?.textContent);

    beforeEach(() => {
        setHash("");
        mockReplace.mockReset();
    });
    afterAll(() => {
        mockPermissions = OWNER;
    });

    it("opens on Account for a Member, with the You sections first", async () => {
        as("member");
        render(<SettingsHub embedded />);

        await findBody("body-account");
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "Who you are, and where you are signed in"
        );
        expect(railLabels().slice(0, 3)).toEqual(["Account", "Appearance", "Shortcuts"]);
    });

    it("lists for a Member only the sections their role can read", () => {
        as("member");
        render(<SettingsHub embedded />);

        expect(railLabels()).toEqual([
            "Account",
            "Appearance",
            "Shortcuts",
            "People and access",
            "Company profile",
            "Document defaults",
            "Data and privacy",
            "Labs",
        ]);
    });

    it("gives a Viewer the same, and a Guest no member list", () => {
        as("viewer");
        const { unmount } = render(<SettingsHub embedded />);
        expect(railLabels()).toContain("People and access");
        unmount();

        as("guest");
        render(<SettingsHub embedded />);
        expect(railLabels()).not.toContain("People and access");
        expect(railLabels()).toEqual(
            expect.arrayContaining(["Account", "Appearance", "Shortcuts", "Data and privacy"])
        );
    });

    it("marks a section a Member may only read, and keeps its body", async () => {
        as("member");
        const user = userEvent.setup();
        render(<SettingsHub embedded />);
        await findBody("body-account");
        expect(screen.queryByText("Read-only")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Company profile/i }));
        await findBody("body-company");
        expect(screen.getByText("Read-only")).toBeInTheDocument();
    });

    it("tells a Member who follows a link to an admins' section why it is empty", async () => {
        as("member");
        setHash("#byok");
        render(<SettingsHub embedded />);

        await waitFor(() =>
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
                "How documents get indexed"
            )
        );
        expect(
            screen.getByText(
                "Processing isn't part of your role (Member). Ask an admin if you need it."
            )
        ).toBeInTheDocument();
        expect(screen.queryByTestId("body-processing")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    });

    it("waits for the roles before saying anything about a gated section", () => {
        mockPermissions = { loaded: false, error: null, roleName: null, permissions: new Set() };
        setHash("#byok");
        render(<SettingsHub embedded />);

        expect(screen.getByText("Loading…")).toBeInTheDocument();
        expect(screen.queryByText(/isn't part of your role/)).not.toBeInTheDocument();
        // Fails closed: only the ungated sections are listed meanwhile.
        expect(railLabels()).not.toContain("Processing");
    });

    it("says the roles failed to load, not that the section isn't theirs", () => {
        mockPermissions = {
            loaded: true,
            error: "Could not load your permissions (500).",
            roleName: null,
            permissions: new Set(),
        };
        setHash("#byok");
        render(<SettingsHub embedded />);

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Could not load your permissions (500)."
        );
        expect(screen.queryByText(/isn't part of your role/)).not.toBeInTheDocument();
        expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    });
});

/**
 * The default assistant's answer style has a workspace default and a
 * personal override. The override is under Appearance, where every role can
 * change it; the default is under Agents and autonomy, written at workspace
 * scope. Each row pins its scope: a plain row writes the member value, so an
 * admin's "workspace" change used to be only their own.
 */
describe("The answer style", () => {
    const KEY = "chat.responseStyle";
    const LABEL = "Answer style of the default assistant";
    let style: ResolvedSetting<string>;
    let puts: SettingWriteRequest[];
    const originalFetch = global.fetch;

    const respond = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

    const resolved = (partial: Partial<ResolvedSetting<string>>): ResolvedSetting<string> => ({
        key: KEY,
        value: "concise",
        source: "default",
        sourceId: null,
        updatedBy: null,
        updatedAt: null,
        canEdit: { workspace: true, folder: false, member: true },
        stored: {},
        ...partial,
    });

    const as = (role: BuiltinRole) => {
        mockPermissions = {
            loaded: true,
            error: null,
            roleName: ROLE_LABELS[role],
            permissions: BUILTIN_ROLE_PERMISSIONS[role],
        };
    };

    beforeAll(() => {
        // Radix Select and the deep-link scroll reach for layout APIs jsdom lacks.
        Element.prototype.scrollIntoView = jest.fn();
        Element.prototype.hasPointerCapture = jest.fn(() => false);
        Element.prototype.releasePointerCapture = jest.fn();
    });

    beforeEach(() => {
        setHash("");
        mockReplace.mockReset();
        mockPermissions = OWNER;
        resetSettingsForTests();
        puts = [];
        style = resolved({});
        global.fetch = jest.fn((_url: string, init?: RequestInit) => {
            if (init?.method === "PUT") {
                const request = JSON.parse(init.body as string) as SettingWriteRequest;
                puts.push(request);
                return respond({ setting: { ...style, value: request.value } });
            }
            return respond({
                settings: { [KEY]: style },
                viewer: { authUserId: "u1", permissions: [] },
                folder: null,
            });
        }) as unknown as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
        mockPermissions = OWNER;
    });

    /** The answer-style row. The mock answers for this key alone, so its neighbours read as read-only. */
    function answerRow(): HTMLElement {
        const row = document.getElementById(`setting-${KEY}`);
        if (!row) throw new Error("no answer-style row");
        return row;
    }

    async function pick(optionLabel: string) {
        const user = userEvent.setup();
        await user.click(screen.getByRole("combobox", { name: LABEL }));
        await user.click(await screen.findByRole("option", { name: optionLabel }));
    }

    it.each(["member", "viewer", "guest"] as const)(
        "lands a %s's link on their own row under Appearance, editable",
        async role => {
            as(role);
            style = resolved({
                value: "organized",
                source: "workspace",
                stored: { workspace: "organized" },
                canEdit: { workspace: false, folder: false, member: true },
            });
            setHash(`#${KEY}`);
            render(<SettingsHub embedded />);

            await waitFor(() =>
                expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
                    "How the app looks, and how it answers you"
                )
            );
            const combobox = await screen.findByRole("combobox", { name: LABEL });
            await waitFor(() => expect(combobox).toBeEnabled());
            expect(combobox).toHaveTextContent("Organized");
            const row = within(answerRow());
            expect(answerRow()).toHaveAttribute("data-highlight", "true");
            expect(row.getByText("Inherited from workspace")).toBeInTheDocument();
            expect(row.queryByText("Read-only")).not.toBeInTheDocument();
            // Nothing to say until they pick their own; nowhere to send them.
            expect(row.queryByText(/workspace default/)).not.toBeInTheDocument();
            expect(row.queryByRole("link", { name: /Agents and autonomy/ })).toBeNull();

            await pick("Detailed");
            await waitFor(() =>
                expect(puts).toEqual([
                    { key: KEY, scope: "member", scopeId: null, value: "detailed" },
                ])
            );
        }
    );

    it("tells a Member with their own choice what the workspace default is", async () => {
        as("member");
        style = resolved({
            value: "detailed",
            source: "member",
            sourceId: "u1",
            stored: { workspace: "organized", member: "detailed" },
            canEdit: { workspace: false, folder: false, member: true },
        });
        setHash(`#${KEY}`);
        render(<SettingsHub embedded />);

        expect(await screen.findByText("The workspace default is Organized.")).toBeInTheDocument();
        const row = within(answerRow());
        expect(row.getByText("Your choice")).toBeInTheDocument();
        expect(row.getByRole("button", { name: "Reset to the workspace" })).toBeInTheDocument();
    });

    it("points an admin on their own row to the workspace default", async () => {
        style = resolved({
            value: "organized",
            source: "workspace",
            stored: { workspace: "organized" },
        });
        setHash(`#${KEY}`);
        render(<SettingsHub embedded />);

        expect(
            await screen.findByText(/gets the workspace default, Organized\./)
        ).toBeInTheDocument();
        await userEvent
            .setup()
            .click(screen.getByRole("link", { name: "Change it under Agents and autonomy" }));

        await findBody("body-agents");
    });

    it("writes the workspace default from Agents and autonomy, showing the workspace's value", async () => {
        // The admin has picked their own style too. The workspace row must
        // show, and write, the workspace's.
        style = resolved({
            value: "detailed",
            source: "member",
            sourceId: "u1",
            updatedBy: "u1",
            stored: { workspace: "organized", member: "detailed" },
        });
        render(<WorkspaceAnswerStyleRow />);

        const combobox = await screen.findByRole("combobox", { name: LABEL });
        await waitFor(() => expect(combobox).toBeEnabled());
        expect(combobox).toHaveTextContent("Organized");
        expect(screen.getByText("Set at workspace level")).toBeInTheDocument();
        expect(screen.queryByText(/Inherited from you/)).not.toBeInTheDocument();
        expect(
            screen.getByText(/Your own choice, Detailed, still applies to your chats\./)
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Change it under Appearance" })).toHaveAttribute(
            "href",
            `#${KEY}`
        );

        await pick("Academic");
        await waitFor(() =>
            expect(puts).toEqual([
                { key: KEY, scope: "workspace", scopeId: null, value: "academic" },
            ])
        );
    });

    it("says nothing about a personal choice the admin has not made", async () => {
        style = resolved({ value: "concise", source: "default" });
        render(<WorkspaceAnswerStyleRow />);

        await waitFor(() => expect(screen.getByRole("combobox", { name: LABEL })).toBeEnabled());
        expect(screen.getByText("Default · nothing set")).toBeInTheDocument();
        expect(screen.queryByText(/Your own choice/)).not.toBeInTheDocument();
    });
});
