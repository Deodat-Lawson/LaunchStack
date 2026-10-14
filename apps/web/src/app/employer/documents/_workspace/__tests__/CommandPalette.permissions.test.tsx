/** @jest-environment jsdom */

/**
 * ⌘K offers only what the person may open. A row for a gated app — Team, for
 * a Guest who can't see the member list — would do nothing when picked, so it
 * isn't offered. A Settings section row ("People and access") opens the
 * Settings app, so it is offered only to those who may open Settings.
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { Permission } from "~/lib/authz/permissions";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("~/lib/settings/useSettings", () => ({ useSettingValue: () => false }));
jest.mock("~/lib/settings/registry", () => ({ searchSettings: () => [] }));
jest.mock("~/lib/context-menu", () => ({
    APP_TARGET_KIND: "app",
    actionItems: () => [],
    listActions: () => [],
}));
jest.mock("~/lib/profile/use-people", () => ({ usePeople: () => ({}) }));

let mockPerms = new Set<Permission>();
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        can: (p: Permission | undefined) => p === undefined || mockPerms.has(p),
    }),
}));

import { CommandPalette } from "../CommandPalette";

function search(text: string, onPickFeature = jest.fn()) {
    render(
        <CommandPalette
            open
            onClose={jest.fn()}
            sources={[]}
            onPickSource={jest.fn()}
            onPickFeature={onPickFeature}
        />
    );
    fireEvent.change(screen.getByPlaceholderText(/Jump to anything/), {
        target: { value: text },
    });
    return onPickFeature;
}

describe("CommandPalette permissions", () => {
    it("offers Team to someone who can see the members, and opens it", () => {
        mockPerms = new Set<Permission>(["members.view"]);
        const onPickFeature = search("team");
        fireEvent.click(screen.getByText("Team"));
        expect(onPickFeature).toHaveBeenCalledWith("team");
    });

    it("doesn't offer Team to a Guest", () => {
        mockPerms = new Set<Permission>(["documents.read"]);
        search("team");
        expect(screen.queryByText("Team")).not.toBeInTheDocument();
    });

    it("offers People and access only to those who may open Settings", () => {
        mockPerms = new Set<Permission>(["documents.read", "members.view"]);
        search("people and access");
        expect(screen.queryByText("People and access")).not.toBeInTheDocument();
    });

    it("offers People and access to an admin, and picks it by id", () => {
        mockPerms = new Set<Permission>(["members.view", "settings.manage"]);
        const onPickFeature = search("people and access");
        fireEvent.click(screen.getByText("People and access"));
        expect(onPickFeature).toHaveBeenCalledWith("people-access");
    });
});
