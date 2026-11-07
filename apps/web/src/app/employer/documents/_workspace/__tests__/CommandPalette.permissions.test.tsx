/** @jest-environment jsdom */

/**
 * ⌘K offers only what the person may open. A row for a gated app — Team, for
 * a Guest who can't see the member list — would do nothing when picked, so it
 * isn't offered. Anyone may open Settings and the Workspace tab, so a row for
 * one of their screens ("Agents & nodes", or a setting such as the theme) is
 * offered to whoever may see that screen, and to no one else.
 */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";

import type * as Registry from "~/lib/settings/registry";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("~/lib/settings/useSettings", () => ({
    useSettingValue: () => false,
    // The real registry search, in English: what a Member may find is what is under test.
    useSettingsSearch: () => (query: string, limit?: number) => {
        const registry: typeof Registry = jest.requireActual("~/lib/settings/registry");
        return registry.searchSettings(query, limit);
    },
    useSettingCopier: () => (definition: { label: string; description: string }) => definition,
}));
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

    it("keeps the admins' screens — Agents & nodes — from a Member", () => {
        mockPerms = new Set(MEMBER);
        search("nodes");
        expect(screen.queryByText("Agents & nodes")).not.toBeInTheDocument();
    });

    it("offers the admins' screens to an admin, and opens them by id", () => {
        mockPerms = new Set(ADMIN);
        const onPickFeature = search("nodes");
        fireEvent.click(screen.getByText("Agents & nodes"));
        expect(onPickFeature).toHaveBeenCalledWith("agents-nodes");
    });

    it("offers a rename only to someone who may change the workspace's details", () => {
        mockPerms = new Set(ADMIN);
        const onPickFeature = search("rename");
        fireEvent.click(screen.getByText("Rename the workspace"));
        expect(onPickFeature).toHaveBeenCalledWith("workspace-general");
        cleanup();

        mockPerms = new Set(MEMBER);
        search("rename");
        expect(screen.queryByText("Rename the workspace")).not.toBeInTheDocument();
        cleanup();
        // The tab itself is for everyone: a Member reads General there.
        search("workspace");
        expect(screen.getByText("Workspace")).toBeInTheDocument();
    });

    it("offers Bring your own keys to an admin, found by BYOK, and opens it by id", () => {
        mockPerms = new Set(ADMIN);
        const onPickFeature = search("byok");
        expect(screen.queryByText("Self-host / BYOK")).not.toBeInTheDocument();
        fireEvent.click(screen.getByText("Bring your own keys"));
        expect(onPickFeature).toHaveBeenCalledWith("byok");
        cleanup();
        search("vercel");
        expect(screen.queryByText(/Vercel, Docker/)).not.toBeInTheDocument();
    });

    it("keeps Bring your own keys from a Member", () => {
        mockPerms = new Set(MEMBER);
        search("own keys");
        expect(screen.queryByText("Bring your own keys")).not.toBeInTheDocument();
    });

    it("finds the theme for a Guest by what people call it, and opens it", () => {
        mockPerms = new Set(GUEST);
        const onPickSetting = jest.fn();
        search("dark mode", jest.fn(), onPickSetting);
        fireEvent.click(screen.getByText("Theme"));
        expect(onPickSetting).toHaveBeenCalledWith("appearance.theme");
    });

    it("finds a Guest's own answer style, which lives under Appearance", () => {
        mockPerms = new Set(GUEST);
        const onPickSetting = jest.fn();
        search("response style", jest.fn(), onPickSetting);
        fireEvent.click(screen.getByText("Answer style of the default assistant"));
        expect(onPickSetting).toHaveBeenCalledWith("chat.responseStyle");
    });

    it("doesn't offer a setting from a section the person may not see", () => {
        // Trash retention lives in Archive, whose read the server refuses a
        // Member; picked, it would land on a section that only says so.
        mockPerms = new Set(MEMBER);
        search("trash");
        expect(screen.queryByText("Empty the trash after")).not.toBeInTheDocument();
    });

    it("offers that setting to an admin, saying it lives in the Workspace tab", () => {
        mockPerms = new Set(ADMIN);
        const onPickSetting = jest.fn();
        search("trash", jest.fn(), onPickSetting);
        const row = screen.getByText("Empty the trash after");
        expect(row.closest("button") ?? row.parentElement).toHaveTextContent(/Workspace ·/);
        fireEvent.click(row);
        expect(onPickSetting).toHaveBeenCalledWith("retention.trashDays");
    });

    it("says a personal setting lives in Settings", () => {
        mockPerms = new Set(GUEST);
        search("dark mode");
        const row = screen.getByText("Theme");
        expect(row.closest("button") ?? row.parentElement).toHaveTextContent(/Settings ·/);
    });
});
