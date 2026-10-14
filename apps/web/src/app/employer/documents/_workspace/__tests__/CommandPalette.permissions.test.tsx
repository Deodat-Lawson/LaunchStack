/** @jest-environment jsdom */

/**
 * ⌘K offers only apps the person may open. A row for a gated app — Team, for
 * a Guest who can't see the member list — would do nothing when picked, so it
 * isn't offered; the Settings section row ("People and access") is a link, not
 * an app, and stays.
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

    it("doesn't offer Team to a Guest, but keeps the Settings link", () => {
        mockPerms = new Set<Permission>(["documents.read"]);
        search("people");
        expect(screen.queryByText("Team")).not.toBeInTheDocument();
        expect(screen.getByText("People and access")).toBeInTheDocument();
    });
});
