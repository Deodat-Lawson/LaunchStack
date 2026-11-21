/** @jest-environment jsdom */

/**
 * Workspace › People and access draws the public-links switch (ADR-016) as a
 * registry row beside audit retention: an admin turns it off and on here,
 * and the "public links are off" note in the Share dialog points here.
 */

import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { Permission } from "~/lib/authz/permissions";
import { resetPeopleCache } from "~/lib/profile/use-people";
import { PUBLIC_LINKS_SETTING } from "~/lib/settings/registry";
import type { SettingsPayload } from "~/lib/settings/types";
import { resetSettingsForTests } from "~/lib/settings/useSettings";

import { WorkspaceSettingsCard } from "../WorkspaceSettingsCard";

// Radix measures the switch; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

function payload(publicLinks: boolean, permissions: Permission[]): SettingsPayload {
    return {
        settings: {
            [PUBLIC_LINKS_SETTING]: {
                key: PUBLIC_LINKS_SETTING,
                value: publicLinks,
                source: publicLinks ? "default" : "workspace",
                sourceId: null,
                updatedBy: null,
                updatedAt: null,
                canEdit: {
                    workspace: permissions.includes("settings.manage"),
                    folder: false,
                    member: false,
                },
                stored: publicLinks ? {} : { workspace: false },
            },
        },
        viewer: { authUserId: "viewer", permissions },
        folder: null,
    };
}

const fetchMock = jest.fn();

function serve(body: SettingsPayload) {
    fetchMock.mockImplementation(async (input: string) => {
        if (String(input).startsWith("/api/settings")) return json(body);
        throw new Error(`unexpected fetch ${String(input)}`);
    });
}

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    resetSettingsForTests();
    act(() => resetPeopleCache());
});

describe("WorkspaceSettingsCard", () => {
    it("draws the public-links switch as a row an admin can flip", async () => {
        serve(payload(true, ["settings.manage"]));
        render(<WorkspaceSettingsCard />);

        const row = await screen.findByText("Public links");
        const setting = row.closest(`[data-setting-key="${PUBLIC_LINKS_SETTING}"]`);
        expect(setting).not.toBeNull();
        expect(
            within(setting as HTMLElement).getByText(
                "Turning it off stops every public link from opening at once. Turning it back on makes the links that were live open again."
            )
        ).toBeInTheDocument();
        const toggle = within(setting as HTMLElement).getByRole("switch");
        expect(toggle).toBeChecked();
        expect(toggle).toBeEnabled();
        // Audit retention stays where it was.
        expect(
            document.querySelector('[data-setting-key="workspace.auditRetentionDays"]')
        ).not.toBeNull();
    });

    it("shows the switch, off and read-only, to someone who cannot manage settings", async () => {
        serve(payload(false, []));
        render(<WorkspaceSettingsCard />);

        await screen.findByText("Public links");
        const setting = document.querySelector<HTMLElement>(
            `[data-setting-key="${PUBLIC_LINKS_SETTING}"]`
        )!;
        const toggle = within(setting).getByRole("switch");
        expect(toggle).not.toBeChecked();
        expect(toggle).toBeDisabled();
    });
});
