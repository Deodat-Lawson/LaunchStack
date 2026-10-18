/** @jest-environment jsdom */

/**
 * The Workspace tab: everything about the workspace, its screens across the
 * top. What must not regress: each screen keeps the gate it had in Settings
 * (left out for a role that may not see it, read-only for one that may only
 * read it), the shared chrome gives one primary action owned by the screen on
 * show, a deep link's row or People tab reaches the section through the hash
 * before the section reads it, and General edits the workspace's own details
 * with one Save that is off until something changed.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type * as SettingsContract from "~/app/employer/documents/_workspace/settings/contract";
import type { ToolHost } from "~/components/tool-app/nav";
import { BUILTIN_ROLE_PERMISSIONS, ROLE_LABELS, type BuiltinRole } from "~/lib/authz/permissions";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: mockRefresh }),
    usePathname: () => "/employer/documents",
}));

let mockPermissions: { roleName: string; permissions: ReadonlySet<string> | "all" } = {
    roleName: "Owner",
    permissions: "all",
};
const mockSetName = jest.fn();
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        error: null,
        roleName: mockPermissions.roleName,
        can: (p: string | undefined) =>
            p === undefined ||
            mockPermissions.permissions === "all" ||
            mockPermissions.permissions.has(p),
    }),
    setWorkspaceNameLocally: (name: string) => mockSetName(name),
}));

const mockToast = jest.fn();
jest.mock("sonner", () => ({ toast: { success: (m: string) => mockToast(m), error: jest.fn() } }));

/** A section body that publishes a known action and says what hash it found when it mounted. */
function mockBody(name: string, testId: string, primaryLabel?: string) {
    const { usePublishedActions } = jest.requireActual<typeof SettingsContract>(
        "~/app/employer/documents/_workspace/settings/contract"
    );
    const { useEffect, useState } = jest.requireActual<typeof React>("react");
    return {
        [name]: ({ onActions }: { onActions?: unknown }) => {
            usePublishedActions(
                onActions as never,
                primaryLabel ? { primaryLabel, onPrimary: () => undefined } : {},
                []
            );
            const [seen, setSeen] = useState<string | null>(null);
            // As `SettingRow` and People do: read the hash once mounted.
            useEffect(() => setSeen(window.location.hash), []);
            return <div data-testid={testId} data-hash={seen ?? ""} />;
        },
    };
}

jest.mock("~/app/employer/documents/_workspace/settings/PeopleAccessSection", () =>
    mockBody("PeopleAccessSection", "body-people", "Invite people")
);
jest.mock("~/app/employer/documents/_workspace/settings/ModelsSection", () =>
    mockBody("ModelsSection", "body-models", "Connect a model")
);
jest.mock("~/app/employer/documents/_workspace/collab/AgentsPanel", () =>
    mockBody("AgentsPanel", "body-agents", "New agent")
);
jest.mock("~/app/employer/documents/_workspace/settings/DocumentDefaultsSection", () =>
    mockBody("DocumentDefaultsSection", "body-documents")
);
jest.mock("~/app/employer/documents/_workspace/settings/IntegrationsPanel", () =>
    mockBody("IntegrationsPanel", "body-integrations")
);
jest.mock("~/app/employer/documents/_workspace/settings/UsageSection", () =>
    mockBody("UsageSection", "body-usage")
);
jest.mock("~/app/employer/documents/_workspace/settings/ArchiveSection", () =>
    mockBody("ArchiveSection", "body-archive")
);
jest.mock("~/app/employer/documents/_workspace/settings/LabsSection", () =>
    mockBody("LabsSection", "body-labs")
);
jest.mock("~/components/company-profile/CompanyProfileView", () =>
    mockBody("CompanyProfileView", "body-company")
);

import { WorkspaceTool } from "~/app/employer/documents/_workspace/WorkspaceTool";

const DETAILS = {
    id: 5,
    name: "Northwind",
    slug: "northwind",
    description: null,
    industry: null,
    teamSize: "2–5 people",
    swatch: 1,
};

let details = { ...DETAILS };
let canEdit = true;
let patches: Record<string, unknown>[] = [];
let patchAnswer: { status: number; body: unknown } | null = null;
let taken: Set<string>;
const originalFetch = global.fetch;

const respond = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);

function serve() {
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
        if (url === "/api/workspace/details" && (init?.method ?? "GET") === "GET") {
            return respond({ workspace: details, canEdit });
        }
        if (url === "/api/workspace/details" && init?.method === "PATCH") {
            const body = JSON.parse(init.body as string) as Record<string, unknown>;
            patches.push(body);
            if (patchAnswer) return respond(patchAnswer.body, patchAnswer.status);
            details = { ...details, ...body };
            return respond({ workspace: details });
        }
        if (url.startsWith("/api/workspaces/slug-available")) {
            const slug = new URL(url, "http://x").searchParams.get("slug")!;
            return respond({ valid: true, available: !taken.has(slug) });
        }
        return respond({ error: `unexpected ${url}` }, 404);
    }) as unknown as typeof fetch;
}

let nonce = 0;
function open(at?: string) {
    const host: ToolHost = {
        active: true,
        request: at ? { at, nonce: ++nonce } : null,
        openHref: jest.fn(),
        openTool: jest.fn(),
    };
    return { ...render(<WorkspaceTool host={host} />), host };
}

const as = (role: BuiltinRole) => {
    mockPermissions = { roleName: ROLE_LABELS[role], permissions: BUILTIN_ROLE_PERMISSIONS[role] };
};

const bar = () => screen.getAllByRole("navigation", { name: "Workspace screens" })[0]!;
const tabs = () =>
    within(bar())
        .getAllByRole("link")
        .map(link => link.textContent);
const heading = () => screen.getByRole("heading", { level: 1 });

beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => {
    window.history.replaceState(null, "", "/employer/documents");
    mockPermissions = { roleName: "Owner", permissions: "all" };
    details = { ...DETAILS };
    canEdit = true;
    patches = [];
    patchAnswer = null;
    taken = new Set(["acme"]);
    mockRefresh.mockReset();
    mockSetName.mockReset();
    mockToast.mockReset();
    serve();
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe("the Workspace tab", () => {
    it("opens on General, with ten screens in three groups for an owner", async () => {
        open();

        await waitFor(() =>
            expect(heading()).toHaveTextContent("What the workspace is called, and how it is known")
        );
        // Ten screens are more than a row holds: the bar switches by group.
        const area = screen.getByRole("radiogroup", { name: "Area" });
        expect(
            within(area)
                .getAllByRole("radio")
                .map(r => r.textContent)
        ).toEqual(["Basics", "Setup", "Data"]);
        expect(tabs()).toEqual(["General", "People and access", "Company profile"]);

        fireEvent.click(within(area).getByRole("radio", { name: "Setup" }));
        await waitFor(() =>
            expect(tabs()).toEqual(["Models", "Agents", "Document defaults", "Integrations"])
        );
        fireEvent.click(within(area).getByRole("radio", { name: "Data" }));
        await waitFor(() => expect(tabs()).toEqual(["Usage", "Archive", "Labs"]));
    });

    it("shows a Member only the screens their role can read, in one row, read-only where they may only read", async () => {
        as("member");
        canEdit = false;
        open();

        expect(screen.queryByRole("radiogroup", { name: "Area" })).not.toBeInTheDocument();
        expect(tabs()).toEqual([
            "General",
            "People and access",
            "Company profile",
            "Document defaults",
            "Labs",
        ]);
        await screen.findByTestId("workspace-general");
        expect(screen.getByText("Read-only")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
        expect(screen.getByLabelText("Name")).toBeDisabled();
    });

    it("tells a Member who follows a link to an admins' screen why it is empty", async () => {
        as("member");
        open("/models");

        expect(heading()).toHaveTextContent("Which model serves each kind of request");
        expect(
            screen.getByText(
                "Models isn't part of your role (Member). Ask an admin if you need it."
            )
        ).toBeInTheDocument();
        expect(screen.queryByTestId("body-models")).not.toBeInTheDocument();
    });

    it("gives the one primary action to the screen on show", async () => {
        const user = userEvent.setup();
        open("/models");
        await screen.findByTestId("body-models");
        expect(screen.getByRole("button", { name: "Connect a model" })).toBeInTheDocument();

        await user.click(within(bar()).getByRole("link", { name: "Agents" }));
        await screen.findByTestId("body-agents");
        expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Connect a model" })).not.toBeInTheDocument();

        await user.click(within(bar()).getByRole("link", { name: "Integrations" }));
        await screen.findByTestId("body-integrations");
        expect(screen.queryByRole("button", { name: "New agent" })).not.toBeInTheDocument();
    });

    it("puts a deep link's row in the hash before the section reads it, and takes it away after", async () => {
        const user = userEvent.setup();
        open("/usage?focus=usage.pricePerMillionTokens");

        const usage = await screen.findByTestId("body-usage");
        await waitFor(() =>
            expect(usage).toHaveAttribute("data-hash", "#usage.pricePerMillionTokens")
        );

        fireEvent.click(screen.getByRole("radio", { name: "Basics" }));
        await user.click(within(bar()).getByRole("link", { name: "People and access" }));
        const people = await screen.findByTestId("body-people");
        // People would otherwise open on whatever tab the last hash named.
        await waitFor(() => expect(people).toHaveAttribute("data-hash", ""));
        expect(window.location.hash).toBe("");
    });

    it("opens People on the tab a link names", async () => {
        open("/people?focus=audit");
        const people = await screen.findByTestId("body-people");
        await waitFor(() => expect(people).toHaveAttribute("data-hash", "#audit"));
    });

    it("leaves a hash it did not put there alone", async () => {
        window.history.replaceState(null, "", "/employer/documents#appearance.theme");
        open("/labs");
        await screen.findByTestId("body-labs");
        expect(window.location.hash).toBe("#appearance.theme");
    });

    it("says so for a screen it doesn't have — the retired Processing one included", async () => {
        open("/processing");
        expect(await screen.findByText("This screen does not exist")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Go to General" })).toBeInTheDocument();
    });
});

describe("Workspace › General", () => {
    async function openGeneral() {
        const utils = open("/general");
        await screen.findByTestId("workspace-general");
        await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Northwind"));
        return utils;
    }
    const save = () => screen.getByRole("button", { name: "Save changes" });

    it("shows the workspace's details, with Save off until something changes", async () => {
        await openGeneral();

        expect(screen.getByLabelText("URL")).toHaveValue("northwind");
        expect(screen.getByLabelText("Description")).toHaveValue("");
        expect(screen.getByLabelText("Industry")).toHaveValue("");
        expect(screen.getByRole("combobox")).toHaveTextContent("2–5 people");
        expect(screen.getByRole("radio", { name: "Colour 1" })).toHaveAttribute(
            "aria-checked",
            "true"
        );
        expect(save()).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    });

    it("saves only what changed, and shows the new name everywhere without a reload", async () => {
        const user = userEvent.setup();
        await openGeneral();

        await user.clear(screen.getByLabelText("Name"));
        await user.type(screen.getByLabelText("Name"), "Northwind Labs");
        await user.click(screen.getByRole("radio", { name: "Colour 4" }));
        await user.type(screen.getByLabelText("Industry"), "Logistics");
        expect(save()).toBeEnabled();
        await user.click(save());

        await waitFor(() =>
            expect(patches).toEqual([{ name: "Northwind Labs", industry: "Logistics", swatch: 4 }])
        );
        await waitFor(() => expect(save()).toBeDisabled());
        expect(mockToast).toHaveBeenCalledWith("Workspace details saved");
        expect(mockSetName).toHaveBeenCalledWith("Northwind Labs");
        // The workspace card and account menu come from the server layout.
        expect(mockRefresh).toHaveBeenCalled();
    });

    it("refuses an empty name before asking the server", async () => {
        const user = userEvent.setup();
        await openGeneral();

        await user.clear(screen.getByLabelText("Name"));
        expect(screen.getByText("Give the workspace a name.")).toBeInTheDocument();
        expect(save()).toBeDisabled();
    });

    it("checks a new URL as it is typed, and won't save one that is taken", async () => {
        const user = userEvent.setup();
        await openGeneral();

        const slug = screen.getByLabelText("URL");
        await user.clear(slug);
        await user.type(slug, "acme");
        expect(await screen.findByText("Taken — try a different URL.")).toBeInTheDocument();
        expect(save()).toBeDisabled();

        await user.type(slug, "-labs");
        expect(await screen.findByText("Available")).toBeInTheDocument();
        expect(save()).toBeEnabled();

        await user.clear(slug);
        await user.type(slug, "No Spaces");
        expect(
            await screen.findByText(
                "At least two characters: lowercase letters, numbers and dashes."
            )
        ).toBeInTheDocument();
        expect(save()).toBeDisabled();
    });

    it("says nothing about the workspace's own URL", async () => {
        const user = userEvent.setup();
        await openGeneral();
        const slug = screen.getByLabelText("URL");
        await user.type(slug, "x");
        await user.type(slug, "{Backspace}");
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 400));
        });
        expect(screen.queryByText("Taken — try a different URL.")).not.toBeInTheDocument();
        expect(screen.queryByText("Available")).not.toBeInTheDocument();
    });

    it("shows the server's refusal of a URL someone took in the meantime", async () => {
        const user = userEvent.setup();
        await openGeneral();
        patchAnswer = {
            status: 409,
            body: {
                error: "Another workspace already uses that URL. Try a different one.",
                field: "slug",
            },
        };

        const slug = screen.getByLabelText("URL");
        await user.clear(slug);
        await user.type(slug, "fresh");
        await screen.findByText("Available");
        await user.click(save());

        expect(
            await screen.findByText("Another workspace already uses that URL. Try a different one.")
        ).toBeInTheDocument();
        expect(screen.getByText("Taken — try a different URL.")).toBeInTheDocument();
        expect(mockSetName).not.toHaveBeenCalled();
    });

    it("puts the saved details back on Discard", async () => {
        const user = userEvent.setup();
        await openGeneral();

        await user.type(screen.getByLabelText("Description"), "We make maps.");
        await user.click(screen.getByRole("button", { name: "Discard" }));
        expect(screen.getByLabelText("Description")).toHaveValue("");
        expect(save()).toBeDisabled();
    });

    it("reads an old team size from sign-up as a count, not a code", async () => {
        details = { ...DETAILS, teamSize: "1" };
        await openGeneral();
        expect(screen.getByRole("combobox")).toHaveTextContent("Just one person");
    });
});
