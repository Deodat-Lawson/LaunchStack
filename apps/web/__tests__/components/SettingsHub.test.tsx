/** @jest-environment jsdom */

/**
 * Settings — yours alone.
 *
 * Settings used to hold the workspace too; those sections are the Workspace
 * tab now. So the things worth asserting here: the rail is the four personal
 * sections and one way to the Workspace tab, every old deep link lands where
 * it belongs now (here, or forwarded to the Workspace tab), and the shared
 * section chrome still gives exactly one primary button, owned by the
 * section on screen.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type * as SettingsContract from "~/app/employer/documents/_workspace/settings/contract";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mockReplace, push: jest.fn(), refresh: jest.fn() }),
    usePathname: () => "/employer/settings",
}));

// The chrome asks who is looking. Unless a test says otherwise, an owner.
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
    setWorkspaceNameLocally: jest.fn(),
}));

jest.mock("~/app/employer/documents/_workspace/settings/AccountSection", () => ({
    AccountSection: () => <div data-testid="body-account">account body</div>,
}));

// Shortcuts publishes whatever a test sets; unless it says otherwise, a Save
// with nothing in its way. Privacy publishes nothing — a section with no
// action must not leave the previous section's button behind.
const SAVE: SettingsContract.SettingsSectionActions = {
    primaryLabel: "Save changes",
    onPrimary: () => undefined,
    disabled: false,
};
let mockShortcutActions: SettingsContract.SettingsSectionActions = SAVE;
jest.mock("~/app/employer/documents/_workspace/settings/ShortcutsSection", () => {
    const { usePublishedActions } = jest.requireActual<typeof SettingsContract>(
        "~/app/employer/documents/_workspace/settings/contract"
    );
    return {
        ShortcutsSection: ({ onActions }: { onActions?: unknown }) => {
            usePublishedActions(onActions as never, mockShortcutActions, []);
            return <div data-testid="body-shortcuts">shortcuts body</div>;
        },
    };
});
jest.mock("~/app/employer/documents/_workspace/settings/PrivacySection", () => ({
    PrivacySection: () => <div data-testid="body-privacy">privacy body</div>,
}));

import {
    SettingsHub,
    WORKSPACE_TAB_HREF,
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

function setUrl(hash: string, search = "") {
    window.history.replaceState(null, "", `/employer/settings${search}${hash}`);
}

const rail = () => screen.getByRole("navigation", { name: /settings sections/i });
const railLabels = () =>
    within(rail())
        .getAllByRole("button")
        .map(button => button.querySelector("span > span")?.textContent);

describe("settingsSectionFromHash", () => {
    it("maps every documented alias, including the ones that used to be routes", () => {
        // Processing became Bring your own keys; the embedding key it held is
        // gone, and its links land there too.
        expect(settingsSectionFromHash("#byok")).toBe("byok");
        expect(settingsSectionFromHash("#embedding")).toBe("byok");
        expect(settingsSectionFromHash("#processing")).toBe("byok");
        expect(settingsSectionFromHash("#openrouter")).toBe("byok");
        expect(settingsSectionFromHash("#keys")).toBe("byok");
        expect(settingsSectionFromHash("#models")).toBe("models");
        expect(settingsSectionFromHash("#agents")).toBe("agents");
        expect(settingsSectionFromHash("#nodes")).toBe("agents");
        expect(settingsSectionFromHash("#slack")).toBe("integrations");
        expect(settingsSectionFromHash("#metadata")).toBe("company");
        expect(settingsSectionFromHash("#company")).toBe("company");
        expect(settingsSectionFromHash("#password")).toBe("account");
        expect(settingsSectionFromHash("#trash")).toBe("archive");
        expect(settingsSectionFromHash("#general")).toBe("general");
    });

    it("lands a registry key on its section", () => {
        expect(settingsSectionFromHash("#appearance.theme")).toBe("appearance");
        expect(settingsSectionFromHash("#retention.trashDays")).toBe("archive");
        // The personal row, which every role can reach; not the admins' one.
        expect(settingsSectionFromHash("#chat.responseStyle")).toBe("appearance");
    });

    it("is case-insensitive and tolerates a missing #", () => {
        expect(settingsSectionFromHash("BYOK")).toBe("byok");
        expect(settingsSectionFromHash("#Agents")).toBe("agents");
    });

    it("returns null for an unknown hash rather than guessing", () => {
        expect(settingsSectionFromHash("#nope")).toBeNull();
        expect(settingsSectionFromHash("")).toBeNull();
    });
});

describe("SettingsHub", () => {
    beforeEach(() => {
        setUrl("");
        mockReplace.mockReset();
        mockPermissions = OWNER;
        mockShortcutActions = SAVE;
    });

    it("lists only what is yours, and one way to the workspace's settings", () => {
        render(<SettingsHub />);

        expect(railLabels()).toEqual(["Account", "Appearance", "Shortcuts", "Data and privacy"]);
        for (const gone of [
            "People and access",
            "Company profile",
            "Processing",
            "Bring your own keys",
            "Models and routes",
            "Agents and autonomy",
            "Document defaults",
            "Integrations",
            "Usage and costs",
            "Archive and retention",
            "Labs",
            "Analytics",
        ]) {
            expect(within(rail()).queryByText(gone)).not.toBeInTheDocument();
        }
        const pointer = within(rail()).getByTestId("settings-open-workspace");
        expect(pointer).toHaveTextContent("Workspace settings");
        expect(pointer).toHaveAttribute("href", "/employer/documents?feature=workspace");
        expect(WORKSPACE_TAB_HREF).toBe("/employer/documents?feature=workspace");
        // The compact picker, for a tab under 640px, carries the same way out.
        expect(screen.getByTestId("settings-open-workspace-compact")).toHaveAttribute(
            "href",
            WORKSPACE_TAB_HREF
        );
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

        await user.click(within(rail()).getByRole("button", { name: /Shortcuts/i }));

        await findBody("body-shortcuts");
        expect(screen.queryByTestId("body-account")).not.toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "What the keyboard does"
        );
    });

    it("renders exactly one primary action, owned by the visible section", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);
        await findBody("body-account");

        await user.click(within(rail()).getByRole("button", { name: /Shortcuts/i }));
        await findBody("body-shortcuts");
        expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(1);

        await user.click(within(rail()).getByRole("button", { name: /Data and privacy/i }));
        await findBody("body-privacy");
        // The previous section's Save must not survive the switch.
        expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    });

    it("disables the primary button a section disables, even when it is not busy", async () => {
        const onPrimary = jest.fn();
        mockShortcutActions = { ...SAVE, onPrimary, busy: false, disabled: true };
        setUrl("#shortcuts");
        const user = userEvent.setup();
        render(<SettingsHub />);
        await findBody("body-shortcuts");

        const save = screen.getByRole("button", { name: "Save changes" });
        expect(save).toBeDisabled();
        await user.click(save);
        expect(onPrimary).not.toHaveBeenCalled();
    });

    it("disables the primary button while the section is busy, whatever it says about disabled", async () => {
        mockShortcutActions = { ...SAVE, primaryBusyLabel: "Saving…", busy: true, disabled: false };
        setUrl("#keybindings");
        render(<SettingsHub />);
        await findBody("body-shortcuts");

        expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    });

    it("opens the section named by the URL hash", async () => {
        setUrl("#privacy");
        render(<SettingsHub />);

        await findBody("body-privacy");
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "What leaves this deployment, and what stays"
        );
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it.each([
        ["#people", "/employer/documents?feature=workspace&at=%2Fpeople"],
        ["#company", "/employer/documents?feature=workspace&at=%2Fcompany"],
        ["#metadata", "/employer/documents?feature=workspace&at=%2Fcompany"],
        ["#byok", "/employer/documents?feature=workspace&at=%2Fbyok"],
        ["#processing", "/employer/documents?feature=workspace&at=%2Fbyok"],
        ["#embedding", "/employer/documents?feature=workspace&at=%2Fbyok"],
        ["#openrouter", "/employer/documents?feature=workspace&at=%2Fbyok"],
        ["#models", "/employer/documents?feature=workspace&at=%2Fmodels"],
        // Document defaults is gone; its links open the Workspace tab.
        ["#documents", "/employer/documents?feature=workspace&at=%2Fgeneral"],
        ["#documents.defaultFolder", "/employer/documents?feature=workspace&at=%2Fgeneral"],
        ["#agents", "/employer/documents?feature=workspace&at=%2Fagents"],
        [
            "#audit",
            // People opens on its audit tab.
            "/employer/documents?feature=workspace&at=%2Fpeople%3Ffocus%3Daudit",
        ],
        [
            "#usage.pricePerMillionTokens",
            // The row scrolls itself into view on its screen.
            "/employer/documents?feature=workspace&at=%2Fusage%3Ffocus%3Dusage.pricePerMillionTokens",
        ],
        ["#statistics", "/employer/documents?feature=analytics"],
    ])("forwards %s to where it lives now", async (hash, href) => {
        setUrl(hash);
        render(<SettingsHub />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(href));
    });

    it("sends the old OpenRouter return leg to Workspace › Bring your own keys with its outcome", async () => {
        setUrl("", "?openrouter=connected");
        render(<SettingsHub />);
        await waitFor(() =>
            expect(mockReplace).toHaveBeenCalledWith(
                "/employer/documents?feature=workspace&at=%2Fbyok&openrouter=connected"
            )
        );
    });

    it("inside the workspace, leaves a hash the Workspace tab put there alone, and follows a link", async () => {
        // The shell has already opened the Workspace tab for this one.
        setUrl("#audit");
        render(<SettingsHub embedded />);
        await findBody("body-account");
        expect(mockReplace).not.toHaveBeenCalled();

        // A link followed from a Settings section (Privacy links to the trash
        // retention row) is a hash change: that one is forwarded.
        setUrl("#retention.trashDays");
        act(() => {
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        expect(mockReplace).toHaveBeenCalledWith(
            "/employer/documents?feature=workspace&at=%2Farchive%3Ffocus%3Dretention.trashDays"
        );
    });

    it("honours a hash change after mount", async () => {
        render(<SettingsHub />);
        await findBody("body-account");

        setUrl("#hotkeys");
        act(() => {
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });

        await findBody("body-shortcuts");
    });

    it("lets an explicit initialSection win over the hash", async () => {
        setUrl("#privacy");
        render(<SettingsHub initialSection="shortcuts" />);

        await findBody("body-shortcuts");
    });

    it("marks the open section for assistive tech", async () => {
        const user = userEvent.setup();
        render(<SettingsHub />);

        expect(within(rail()).getByRole("button", { current: "page" })).toHaveTextContent(
            "Account"
        );

        await user.click(within(rail()).getByRole("button", { name: /Data and privacy/i }));
        expect(within(rail()).getByRole("button", { current: "page" })).toHaveTextContent(
            "Data and privacy"
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

/** Settings is everyone's, whatever their role, and nothing in it is read-only. */
describe("SettingsHub by role", () => {
    const as = (role: BuiltinRole) => {
        mockPermissions = {
            loaded: true,
            error: null,
            roleName: ROLE_LABELS[role],
            permissions: BUILTIN_ROLE_PERMISSIONS[role],
        };
    };

    beforeEach(() => {
        setUrl("");
        mockReplace.mockReset();
    });
    afterAll(() => {
        mockPermissions = OWNER;
    });

    it.each(["member", "viewer", "guest"] as const)(
        "gives a %s the same four sections, none of them read-only",
        async role => {
            as(role);
            const user = userEvent.setup();
            render(<SettingsHub embedded />);

            expect(railLabels()).toEqual([
                "Account",
                "Appearance",
                "Shortcuts",
                "Data and privacy",
            ]);
            await findBody("body-account");
            for (const label of ["Shortcuts", "Data and privacy"]) {
                await user.click(within(rail()).getByRole("button", { name: new RegExp(label) }));
                expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
            }
        }
    );

    it("shows the personal sections while the roles are still loading", async () => {
        mockPermissions = { loaded: false, error: null, roleName: null, permissions: new Set() };
        render(<SettingsHub embedded />);

        expect(railLabels()).toHaveLength(4);
        await findBody("body-account");
    });
});

/**
 * The default assistant's answer style has a workspace default and a
 * personal override. The override is under Settings › Appearance, where every
 * role can change it; the default is under Workspace › Agents, written at
 * workspace scope. Each row pins its scope, and links to the other tab.
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
        setUrl("");
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
            setUrl(`#${KEY}`);
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
            expect(row.queryByRole("link", { name: /Workspace › Agents/ })).toBeNull();
            expect(mockReplace).not.toHaveBeenCalled();

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
        setUrl(`#${KEY}`);
        render(<SettingsHub embedded />);

        expect(await screen.findByText("The workspace default is Organized.")).toBeInTheDocument();
        const row = within(answerRow());
        expect(row.getByText("Your choice")).toBeInTheDocument();
        expect(row.getByRole("button", { name: "Reset to the workspace" })).toBeInTheDocument();
    });

    it("points an admin on their own row to the workspace default, in the Workspace tab", async () => {
        style = resolved({
            value: "organized",
            source: "workspace",
            stored: { workspace: "organized" },
        });
        setUrl(`#${KEY}`);
        render(<SettingsHub embedded />);

        expect(
            await screen.findByText(/gets the workspace default, Organized\./)
        ).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Change it under Workspace › Agents" })
        ).toHaveAttribute("href", "/employer/documents?feature=workspace&at=%2Fagents");
    });

    it("writes the workspace default from Workspace › Agents, showing the workspace's value", async () => {
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
        expect(
            screen.getByRole("link", { name: "Change it under Settings › Appearance" })
        ).toHaveAttribute("href", `/employer/settings#${KEY}`);

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
