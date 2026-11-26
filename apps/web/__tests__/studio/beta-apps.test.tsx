/** @jest-environment jsdom */
/**
 * The workspace's beta switch (`labs.betaApps`, Workspace › Labs): what is
 * still being built — the Vantage app, and Brand's screens inside Growth —
 * is hidden everywhere while it is off, and Vantage is drawn with a Beta
 * badge while it is on. Growth itself, with Prospects, is for every
 * workspace. The rule is one pair of functions every surface asks
 * (`canOpenStudioApp`, `canOpenStudioPlace` / `useStudioAccess`); the picker
 * here stands for the rest. The APIs' half is pinned in the route tests
 * (`beta_apps_off`).
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

import {
    canOpenStudioApp,
    canOpenStudioPlace,
    studioAppFor,
} from "~/app/employer/documents/_workspace/studioAccess";
import { StudioDrawer } from "~/app/employer/documents/_workspace/StudioDrawer";
import { STUDIO_GROUPS } from "~/app/employer/documents/_workspace/types";
import { BETA_APPS_SETTING, getSetting } from "~/lib/settings/registry";
import { isBetaPlace, opensBetaPlace } from "~/lib/tool-app/beta-places";

const all = () => true;

beforeEach(() => {
    mockBeta = { value: false, loaded: true, error: null };
    mockHeld = new Set(["members.view"]);
});

describe("which apps are beta", () => {
    it("is Vantage, and nothing else, as a whole app", () => {
        const beta = STUDIO_GROUPS.flatMap(group => group.features)
            .filter(feature => feature.beta)
            .map(feature => feature.id);
        expect(beta).toEqual(["vantage"]);
    });

    it("is Brand inside Growth, and not Prospects", () => {
        expect(isBetaPlace("growth", "/brand")).toBe(true);
        expect(isBetaPlace("growth", "/brand/accounts?connected=linkedin")).toBe(true);
        expect(isBetaPlace("growth", "/brand/")).toBe(true);
        expect(isBetaPlace("growth", "/prospects/companies/42")).toBe(false);
        expect(isBetaPlace("growth", "/")).toBe(false);
        expect(isBetaPlace("growth", "/brandnew")).toBe(false);
        expect(isBetaPlace("proposals", "/brand")).toBe(false);
        expect(isBetaPlace("constructor", "/brand")).toBe(false);
        expect(opensBetaPlace("brand")).toBe(true);
        expect(opensBetaPlace("marketing")).toBe(true);
        expect(opensBetaPlace("prospects")).toBe(false);
        expect(opensBetaPlace("/employer/documents?feature=growth&at=/brand/accounts")).toBe(true);
        expect(opensBetaPlace("/employer/tools/marketing-pipeline")).toBe(true);
        expect(opensBetaPlace("/employer/documents?feature=growth&at=%2Fprospects")).toBe(false);
        expect(opensBetaPlace("/employer/documents?feature=growth")).toBe(false);
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
    const vantage = studioAppFor("vantage");
    const team = studioAppFor("team");

    it("closes a beta app while the switch is off, whatever the role", () => {
        expect(canOpenStudioApp(vantage, all, false)).toBe(false);
        expect(canOpenStudioApp(vantage, all, true)).toBe(true);
    });

    it("leaves every other app to its permission, Growth included", () => {
        expect(canOpenStudioApp(studioAppFor("growth"), all, false)).toBe(true);
        expect(canOpenStudioApp(studioAppFor("proposals"), all, false)).toBe(true);
        expect(canOpenStudioApp(team, () => false, true)).toBe(false);
        expect(canOpenStudioApp(team, all, false)).toBe(true);
    });

    it("refuses what names no app", () => {
        expect(canOpenStudioApp(undefined, all, true)).toBe(false);
    });
});

describe("canOpenStudioPlace", () => {
    it("opens Prospects with the switch off, and Brand only with it on", () => {
        for (const link of ["prospects", "/employer/documents?feature=growth&at=%2Fprospects"]) {
            expect(canOpenStudioPlace(link, all, false)).toBe(true);
        }
        for (const link of [
            "brand",
            "marketing",
            "/employer/documents?feature=growth&at=/brand/accounts",
        ]) {
            expect(canOpenStudioPlace(link, all, false)).toBe(false);
            expect(canOpenStudioPlace(link, all, true)).toBe(true);
        }
    });

    it("holds a place to its app's own gates", () => {
        expect(canOpenStudioPlace("/employer/documents?feature=vantage", all, false)).toBe(false);
        expect(canOpenStudioPlace("people-access", all, false)).toBe(true);
        expect(canOpenStudioPlace("nothing-here", all, true)).toBe(false);
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

    it("lists Growth but not Vantage while the workspace has beta apps off", () => {
        open();
        expect(screen.getByText("Proposals")).toBeInTheDocument();
        expect(screen.getByText("Growth")).toBeInTheDocument();
        expect(screen.queryByText("Vantage")).not.toBeInTheDocument();
        expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });

    it("lists Vantage, marked Beta, once they are on", () => {
        mockBeta = { value: true, loaded: true, error: null };
        open();
        expect(screen.getByText("Growth")).toBeInTheDocument();
        expect(screen.getByText("Vantage")).toBeInTheDocument();
        expect(screen.getAllByText("Beta")).toHaveLength(1);
    });

    it("keeps Vantage out until the settings have answered, and Growth in", () => {
        mockBeta = { value: false, loaded: false, error: null };
        open();
        expect(screen.getByText("Growth")).toBeInTheDocument();
        expect(screen.queryByText("Vantage")).not.toBeInTheDocument();
    });
});
