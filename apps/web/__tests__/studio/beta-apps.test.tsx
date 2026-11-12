/** @jest-environment jsdom */
/**
 * The workspace's beta switch (`labs.betaApps`, Workspace › Labs): the Studio
 * apps still being built — Growth and Vantage — are hidden everywhere while
 * it is off, and drawn with a Beta badge while it is on. The rule is one
 * function every surface asks (`canOpenStudioApp` / `useStudioAccess`); the
 * picker here stands for the rest. The APIs' half is pinned in the route
 * tests (`beta_apps_off`).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type * as UseSettings from "~/lib/settings/useSettings";

let mockBeta: { value: boolean; loaded: boolean; error: string | null } = {
    value: false,
    loaded: true,
    error: null,
};
jest.mock("~/lib/settings/useSettings", () => {
    const actual = jest.requireActual<typeof UseSettings>("~/lib/settings/useSettings");
    return {
        ...actual,
        useSetting: (key: string) => {
            if (key !== "labs.betaApps") throw new Error(`unexpected setting ${key}`);
            return { ...mockBeta, resolved: null };
        },
    };
});

let mockHeld = new Set<string>();
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        error: null,
        can: (permission?: string) => permission === undefined || mockHeld.has(permission),
    }),
}));

import { canOpenStudioApp, studioAppFor } from "~/app/employer/documents/_workspace/studioAccess";
import { StudioDrawer } from "~/app/employer/documents/_workspace/StudioDrawer";
import { STUDIO_GROUPS } from "~/app/employer/documents/_workspace/types";
import { BETA_APPS_SETTING, getSetting } from "~/lib/settings/registry";

const all = () => true;

beforeEach(() => {
    mockBeta = { value: false, loaded: true, error: null };
    mockHeld = new Set(["members.view"]);
});

describe("which apps are beta", () => {
    it("is Growth and Vantage, and nothing else", () => {
        const beta = STUDIO_GROUPS.flatMap(group => group.features)
            .filter(feature => feature.beta)
            .map(feature => feature.id);
        expect(beta.sort()).toEqual(["growth", "vantage"]);
    });

    it("is switched by a workspace setting only admins change, off by default", () => {
        const setting = getSetting(BETA_APPS_SETTING);
        expect(setting).toMatchObject({
            key: "labs.betaApps",
            section: "labs",
            scopes: ["workspace"],
            permission: "settings.manage",
            default: false,
            control: { kind: "switch" },
        });
    });
});

describe("canOpenStudioApp", () => {
    const growth = studioAppFor("growth");
    const team = studioAppFor("team");

    it("closes a beta app while the switch is off, whatever the role", () => {
        expect(canOpenStudioApp(growth, all, false)).toBe(false);
        expect(canOpenStudioApp(growth, all, true)).toBe(true);
    });

    it("leaves every other app to its permission", () => {
        expect(canOpenStudioApp(studioAppFor("proposals"), all, false)).toBe(true);
        expect(canOpenStudioApp(team, () => false, true)).toBe(false);
        expect(canOpenStudioApp(team, all, false)).toBe(true);
    });

    it("refuses what names no app", () => {
        expect(canOpenStudioApp(undefined, all, true)).toBe(false);
    });
});

describe("studioAppFor", () => {
    it("follows the ⌘K rows and old ids into Growth", () => {
        expect(studioAppFor("brand")?.id).toBe("growth");
        expect(studioAppFor("prospects")?.id).toBe("growth");
        expect(studioAppFor("marketing")?.id).toBe("growth");
    });

    it("reads the app out of a workspace link", () => {
        expect(studioAppFor("/employer/documents?feature=growth&at=/brand/accounts")?.id).toBe(
            "growth"
        );
        expect(studioAppFor("/employer/documents?feature=vantage")?.id).toBe("vantage");
        expect(studioAppFor("/employer/documents?add=1&tab=gmail")).toBeUndefined();
        expect(studioAppFor("/employer/settings?x=1#people")).toBeUndefined();
    });
});

describe("the Studio picker", () => {
    function open() {
        render(<StudioDrawer open onClose={() => undefined} onPickFeature={() => undefined} />);
    }

    it("lists neither app while the workspace has beta apps off", () => {
        open();
        expect(screen.getByText("Proposals")).toBeInTheDocument();
        expect(screen.queryByText("Growth")).not.toBeInTheDocument();
        expect(screen.queryByText("Vantage")).not.toBeInTheDocument();
        expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });

    it("lists both, each marked Beta, once they are on", () => {
        mockBeta = { value: true, loaded: true, error: null };
        open();
        expect(screen.getByText("Growth")).toBeInTheDocument();
        expect(screen.getByText("Vantage")).toBeInTheDocument();
        expect(screen.getAllByText("Beta")).toHaveLength(2);
    });

    it("keeps them out until the settings have answered", () => {
        mockBeta = { value: false, loaded: false, error: null };
        open();
        expect(screen.queryByText("Growth")).not.toBeInTheDocument();
    });
});
