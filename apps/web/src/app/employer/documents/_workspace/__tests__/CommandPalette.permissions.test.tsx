/** @jest-environment jsdom */

/**
 * ⌘K offers only what the person may open. A row for a gated app — Team, for
 * a Guest who can't see the member list — would do nothing when picked, so it
 * isn't offered. Anyone may open Settings, so a row for one of its sections
 * ("Self-host / BYOK", or a setting such as the theme) is offered to whoever
 * may see that section, and to no one else.
 */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("~/lib/settings/useSettings", () => ({ useSettingValue: () => false }));
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

const MEMBER = BUILTIN_ROLE_PERMISSIONS.member;
const GUEST = BUILTIN_ROLE_PERMISSIONS.guest;
const ADMIN = BUILTIN_ROLE_PERMISSIONS.admin;

function search(text: string, onPickFeature = jest.fn(), onPickSetting = jest.fn()) {
    render(
        <CommandPalette
            open
            onClose={jest.fn()}
            sources={[]}
            onPickSource={jest.fn()}
            onPickFeature={onPickFeature}
            onPickSetting={onPickSetting}
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

    it("offers People and access to a Member, who sees the member list there", () => {
        mockPerms = new Set(MEMBER);
        const onPickFeature = search("people and access");
        fireEvent.click(screen.getByText("People and access"));
        expect(onPickFeature).toHaveBeenCalledWith("people-access");
    });

    it("doesn't offer People and access to a Guest", () => {
        mockPerms = new Set(GUEST);
        search("people and access");
        expect(screen.queryByText("People and access")).not.toBeInTheDocument();
    });

    it("offers the Company profile, which everyone reads, to a Guest", () => {
        mockPerms = new Set(GUEST);
        search("company profile");
        expect(screen.getByText("Company profile")).toBeInTheDocument();
    });

    it("keeps the admins' sections — BYOK, Agents & nodes — from a Member", () => {
        mockPerms = new Set(MEMBER);
        search("byok");
        expect(screen.queryByText("Self-host / BYOK")).not.toBeInTheDocument();
        cleanup();
        search("nodes");
        expect(screen.queryByText("Agents & nodes")).not.toBeInTheDocument();
    });

    it("offers the admins' sections to an admin", () => {
        mockPerms = new Set(ADMIN);
        const onPickFeature = search("byok");
        fireEvent.click(screen.getByText("Self-host / BYOK"));
        expect(onPickFeature).toHaveBeenCalledWith("deploy");
    });

    it("finds the theme for a Guest by what people call it, and opens it", () => {
        mockPerms = new Set(GUEST);
        const onPickSetting = jest.fn();
        search("dark mode", jest.fn(), onPickSetting);
        fireEvent.click(screen.getByText("Theme"));
        expect(onPickSetting).toHaveBeenCalledWith("appearance.theme");
    });

    it("doesn't offer a setting from a section the person may not see", () => {
        // Trash retention lives in Archive, whose read the server refuses a
        // Member; picked, it would land on a section that only says so.
        mockPerms = new Set(MEMBER);
        search("trash");
        expect(screen.queryByText("Empty the trash after")).not.toBeInTheDocument();
    });

    it("offers that setting to an admin", () => {
        mockPerms = new Set(ADMIN);
        search("trash");
        expect(screen.getByText("Empty the trash after")).toBeInTheDocument();
    });
});
