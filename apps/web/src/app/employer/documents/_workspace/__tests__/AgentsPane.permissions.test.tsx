/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AGENT_CONTENT_FIELDS, AGENT_POLICY_FIELDS } from "~/lib/agents/roster-access";
import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";

import { AgentsPane } from "../collab/AgentsPane";
import type { AgentPersonaRecord, AgentsResponse } from "../collab/types";

/**
 * The Agents app draws a button only when the route behind it would accept
 * the click (`lib/agents/roster-access.ts`): roster managers add, import,
 * duplicate, retire, bring back and restore; anyone who edits documents
 * changes what an agent says, with the policy fields locked; everyone else
 * reads, tries and exports.
 */

// Radix measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

let mockPerms: ReadonlySet<Permission> = new Set();
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        companyId: 5,
        can: (p: Permission | undefined) => p === undefined || mockPerms.has(p),
    }),
}));

function agent(over: Partial<AgentPersonaRecord>): AgentPersonaRecord {
    return {
        dbId: "p_finance",
        id: "finance",
        displayName: "Dana",
        role: "Finance partner",
        description: "Guards margin and cash.",
        systemPrompt: "Guard the margin.",
        mode: "all",
        tools: ["rag_search"],
        style: null,
        route: "reasoning",
        nodeId: "gpu-box-1",
        autonomy: "propose",
        builtin: false,
        archived: false,
        ...over,
    };
}

const mockRoster: AgentsResponse = {
    personas: [
        agent({}),
        agent({
            dbId: "seed_1",
            id: "facilitator",
            displayName: "Ada",
            role: "Facilitator",
            builtin: true,
        }),
        agent({ dbId: "p_old", id: "old", displayName: "Olde", role: "Retired", archived: true }),
    ],
    nodes: [],
    defaults: { autonomy: "full" },
    network: { enabled: false, hubId: null, hubPath: "/api/collab/hub" },
    slack: { canPost: false, canReceive: false, missing: [] },
};

const mockRefresh = jest.fn();
jest.mock("../collab/useMeetings", () => ({
    useAgents: () => ({ data: mockRoster, loading: false, error: null, refresh: mockRefresh }),
}));

const fetchMock = jest.fn();

function renderAs(role: "owner" | "admin" | "member" | "viewer" | "guest") {
    mockPerms = BUILTIN_ROLE_PERMISSIONS[role];
    return render(<AgentsPane />);
}

const button = (name: RegExp | string) => screen.queryByRole("button", { name });

beforeEach(() => {
    jest.clearAllMocks();
    // jsdom has no Response; the editor reads `ok` and `json()` only.
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ persona: mockRoster.personas[0] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("AgentsPane by role", () => {
    it.each(["owner", "admin"] as const)("gives an %s every roster action", role => {
        renderAs(role);
        expect(button("New agent")).toBeInTheDocument();
        expect(button("Import a definition file")).toBeInTheDocument();
        expect(button("Edit")).toBeInTheDocument();
        expect(button("Duplicate")).toBeInTheDocument();
        expect(button("Retire")).toBeInTheDocument();
    });

    it("lets a member edit but not add, import, duplicate, retire or restore", () => {
        renderAs("member");
        expect(button("Edit")).toBeInTheDocument();
        for (const name of [
            "New agent",
            "Import a definition file",
            "Duplicate",
            "Retire",
            "Restore the shipped definition",
        ]) {
            expect(button(name)).not.toBeInTheDocument();
        }
    });

    it.each(["viewer", "guest"] as const)("leaves a %s reading and trying only", role => {
        renderAs(role);
        for (const name of [
            "New agent",
            "Import a definition file",
            "Edit",
            "Duplicate",
            "Retire",
        ]) {
            expect(button(name)).not.toBeInTheDocument();
        }
        expect(screen.getByRole("tab", { name: /Try it/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Definition file/ })).toBeInTheDocument();
    });

    it("offers restore on a starter only to a roster manager", () => {
        renderAs("admin");
        fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
        expect(button("Restore the shipped definition")).toBeInTheDocument();
    });

    it("offers a retired agent back only to a roster manager", () => {
        const { unmount } = renderAs("admin");
        fireEvent.click(screen.getByRole("button", { name: /Olde/ }));
        expect(button(/Bring back/)).toBeInTheDocument();
        unmount();

        renderAs("member");
        fireEvent.click(screen.getByRole("button", { name: /Olde/ }));
        expect(button(/Bring back/)).not.toBeInTheDocument();
    });
});

describe("the editor for someone who may change only what an agent says", () => {
    async function openEditor(role: "member" | "admin") {
        renderAs(role);
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        return within(await screen.findByRole("dialog"));
    }

    it("locks the handle, autonomy, tools, model route and node, and leaves the rest open", async () => {
        const dialog = await openEditor("member");

        expect(dialog.getByPlaceholderText("finance")).toBeDisabled(); // handle
        expect(dialog.getByPlaceholderText("gpu-box-1")).toBeDisabled(); // node
        expect(dialog.getByDisplayValue("Propose")).toBeDisabled(); // autonomy
        expect(dialog.getByDisplayValue("Reasoning")).toBeDisabled(); // model route
        for (const box of dialog.getAllByRole("checkbox")) expect(box).toBeDisabled();

        expect(dialog.getByDisplayValue("Dana")).toBeEnabled();
        expect(dialog.getByDisplayValue("Guard the margin.")).toBeEnabled();
        expect(dialog.queryByRole("button", { name: /Import file/ })).not.toBeInTheDocument();
        expect(
            dialog.getByText(/set by people who can manage workspace settings/i, {
                selector: "span",
            })
        ).toBeInTheDocument();
    });

    it("saves only the content fields", async () => {
        const dialog = await openEditor("member");
        fireEvent.change(dialog.getByDisplayValue("Guard the margin."), {
            target: { value: "Quote the cash runway." },
        });
        fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/collab/agents/p_finance");
        expect(init.method).toBe("PATCH");
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.systemPrompt).toBe("Quote the cash runway.");
        for (const field of AGENT_POLICY_FIELDS) expect(body).not.toHaveProperty(field);
        for (const field of Object.keys(body)) {
            expect(AGENT_CONTENT_FIELDS as readonly string[]).toContain(field);
        }
    });

    it("keeps the File tab read-only, since a file would rewrite the policy fields", async () => {
        const dialog = await openEditor("member");
        fireEvent.mouseDown(dialog.getByRole("tab", { name: /File/ }));
        fireEvent.click(dialog.getByRole("tab", { name: /File/ }));

        await waitFor(() => expect(dialog.getByText(/Read-only for you/)).toBeInTheDocument());
        expect(dialog.queryByRole("button", { name: /Apply to form/ })).not.toBeInTheDocument();
    });

    it("leaves every field open to a roster manager, and saves them all", async () => {
        const dialog = await openEditor("admin");
        expect(dialog.getByPlaceholderText("finance")).toBeEnabled();
        expect(dialog.getByDisplayValue("Propose")).toBeEnabled();
        expect(dialog.getByRole("button", { name: /Import file/ })).toBeInTheDocument();

        fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const body = JSON.parse(
            (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
        ) as Record<string, unknown>;
        expect(body).toMatchObject({ key: "finance", autonomy: "propose", nodeId: "gpu-box-1" });
    });
});
