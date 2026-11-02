/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { Permission } from "~/lib/authz/permissions";
import { resetPeopleCache } from "~/lib/profile/use-people";

import type { ToolHost } from "~/components/tool-app/nav";

import { MANAGE_ACCESS_HREF, TeamTool, type TeamToolProps } from "../team/TeamTool";
import { teamScreenFor } from "../team/screens";

/**
 * The Team tab (ADR-014 §7), a Studio tab of its own rather than a tab of
 * the sidebar: People with a page per person showing what you share with each
 * other, Groups that members can start, the Activity feed by day and kind, a
 * way into Settings for admins, and a one-line explanation for Guests.
 */

// Radix measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

let mockPerms = new Set<Permission>();
let mockRole = "member";
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        role: mockRole,
        can: (p: Permission | undefined) => p === undefined || mockPerms.has(p),
    }),
}));

const MEMBER_PERMS: Permission[] = ["documents.read", "documents.upload", "members.view"];

function member(over: Record<string, unknown>) {
    return {
        name: "",
        email: "",
        title: null,
        pronouns: null,
        avatarUrl: null,
        role: "member",
        roleName: "Member",
        status: "active",
        groups: [],
        joinedAt: "2026-01-01T00:00:00Z",
        lastActiveAt: null,
        isSelf: false,
        ...over,
    };
}

const MEMBERS = [
    member({
        id: 7,
        authUserId: "user-me",
        name: "Mo Self",
        displayName: "Mo",
        email: "mo@example.com",
        isSelf: true,
    }),
    member({
        id: 8,
        authUserId: "user-ben",
        name: "Ben Ng",
        displayName: "Ben Ng",
        email: "ben@example.com",
        title: "Designer",
        role: "admin",
        roleName: "Admin",
        groups: [{ id: 4, name: "Design" }],
    }),
    member({
        id: 9,
        authUserId: "user-cy",
        name: "Cy Park",
        displayName: "Cy Park",
        email: "cy@example.com",
        status: "pending",
    }),
];

const GROUPS = [
    {
        id: 4,
        name: "Design",
        slug: "design",
        description: null,
        memberCount: 1,
        members: [{ id: 8, name: "Ben Ng", email: "ben@example.com" }],
        createdBy: "user-ben",
        canManage: false,
    },
];

const SHARED = {
    sharedWithMe: [
        {
            type: "folder",
            id: 11,
            name: "Finance/Board",
            path: "Finance/Board",
            level: "edit",
            at: new Date().toISOString(),
            viaGroup: "Sales",
        },
    ],
    iShared: [],
};

const ACTIVITY = {
    entries: [
        {
            id: 5,
            actorUserId: "user-ben",
            verb: "shared",
            targetType: "folder",
            targetId: "11",
            targetLabel: "Finance",
            targetPath: "Finance",
            detail: { added: ["Sales team"] },
            at: new Date().toISOString(),
            openable: true,
        },
        {
            id: 4,
            actorUserId: "user-ben",
            verb: "deleted",
            targetType: "document",
            targetId: "43",
            targetLabel: "Old.pdf",
            targetPath: "Finance",
            detail: { wasWorkspace: true },
            at: new Date().toISOString(),
            openable: false,
        },
    ],
    nextBefore: null,
};

const fetchMock = jest.fn();

function urlOf(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function json(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
    });
}

function calledWith(prefix: string): string[] {
    return fetchMock.mock.calls
        .map(([input]) => urlOf(input as RequestInfo))
        .filter(url => url.startsWith(prefix));
}

beforeEach(() => {
    mockPerms = new Set(MEMBER_PERMS);
    mockRole = "member";
    resetPeopleCache();
    try {
        localStorage.clear();
    } catch {
        // jsdom always has it.
    }
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url === "/api/workspace/members") {
            return json({ members: MEMBERS, counts: { active: 2, pending: 1, suspended: 0 } });
        }
        if (url === "/api/workspace/groups") return json({ groups: GROUPS });
        if (url === "/api/workspace/team/people/8/shared") return json(SHARED);
        if (url.startsWith("/api/workspace/activity")) return json(ACTIVITY);
        if (url.startsWith("/api/profile/people")) {
            return json({
                people: {
                    "user-ben": { authUserId: "user-ben", displayName: "Ben Ng", avatarUrl: null },
                },
            });
        }
        return json({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

let nonce = 0;

function setup(at?: string, over: Partial<TeamToolProps> = {}) {
    const host: ToolHost = {
        active: true,
        request: at ? { at, nonce: ++nonce } : null,
        openHref: jest.fn(),
        openTool: jest.fn(),
    };
    const props = { onOpenTarget: jest.fn(), onShare: jest.fn(), ...over };
    const utils = render(<TeamTool host={host} {...props} />);
    return { ...utils, props, host };
}

function screenTab(name: string): HTMLElement {
    const nav = screen.getByRole("navigation", { name: "Team screens" });
    return within(nav).getByRole("link", { name });
}

describe("teamScreenFor", () => {
    it("reads every screen and refuses what isn't one", () => {
        expect(teamScreenFor("/")).toEqual({ kind: "people" });
        expect(teamScreenFor("/people")).toEqual({ kind: "people" });
        expect(teamScreenFor("/people/8")).toEqual({ kind: "person", id: 8 });
        expect(teamScreenFor("/groups")).toEqual({ kind: "groups" });
        expect(teamScreenFor("/groups/4")).toEqual({ kind: "group", id: 4 });
        expect(teamScreenFor("/activity")).toEqual({ kind: "activity" });
        for (const path of ["/people/ben", "/groups/4/edit", "/activity/3", "/inbox"]) {
            expect(teamScreenFor(path)).toEqual({ kind: "not-found" });
        }
    });
});

describe("TeamTool", () => {
    it("tells a Guest why there is no team list, with no screens to switch to", () => {
        mockPerms = new Set<Permission>(["documents.read"]);
        mockRole = "guest";
        setup();

        expect(screen.getByTestId("team-tool")).toHaveTextContent(/isn't part of your role/);
        expect(screen.queryByRole("navigation", { name: "Team screens" })).toBeNull();
        expect(calledWith("/api/workspace/members")).toEqual([]);
    });

    it("opens on People: active people with title, role and groups, as links to their pages", async () => {
        setup();

        const list = await screen.findByTestId("team-people");
        const cards = within(list).getAllByTestId("team-person-row");
        expect(cards).toHaveLength(2);
        expect(cards[0]).toHaveTextContent("Mo (you)");
        expect(cards[1]).toHaveTextContent("Ben Ng");
        expect(cards[1]).toHaveTextContent("Designer");
        expect(cards[1]).toHaveTextContent("Admin");
        expect(cards[1]).toHaveTextContent("Design");
        // A real link: ⌘-click opens the person in a browser tab.
        expect(cards[1]).toHaveAttribute(
            "href",
            "/employer/documents?feature=team&at=%2Fpeople%2F8"
        );
        expect(screen.queryByText("Cy Park")).not.toBeInTheDocument();
        expect(screenTab("People")).toHaveAttribute("aria-current", "page");
    });

    it("filters people with the screen's own filter box", async () => {
        setup();
        await screen.findByTestId("team-people");

        fireEvent.change(screen.getByTestId("team-filter"), { target: { value: "design" } });

        const list = screen.getByTestId("team-people");
        expect(within(list).getAllByTestId("team-person-row")).toHaveLength(1);
        expect(list).toHaveTextContent("Ben Ng");
    });

    it("offers Invite people only to those who may invite", async () => {
        const { unmount } = setup();
        await screen.findByTestId("team-people");
        expect(screen.queryByTestId("team-invite")).not.toBeInTheDocument();
        unmount();

        mockPerms = new Set<Permission>([...MEMBER_PERMS, "members.invite"]);
        setup();
        expect(await screen.findByTestId("team-invite")).toHaveTextContent("Invite people");
    });

    it("sends admins to Workspace › People and access for roles, invitations and the audit log; members don't see it", async () => {
        const { unmount } = setup();
        await screen.findByTestId("team-people");
        expect(screen.queryByTestId("team-manage-access")).not.toBeInTheDocument();
        unmount();

        mockPerms = new Set<Permission>([...MEMBER_PERMS, "settings.manage"]);
        const { host } = setup();
        const link = await screen.findByTestId("team-manage-access");
        expect(link).toHaveTextContent("Manage access");
        expect(MANAGE_ACCESS_HREF).toBe("/employer/documents?feature=workspace&at=%2Fpeople");
        expect(link).toHaveAttribute("href", MANAGE_ACCESS_HREF);
        fireEvent.click(link);
        // Another tool's tab, opened in place: no page leave.
        expect(host.openTool).toHaveBeenCalledWith("workspace", "/people");
        expect(host.openHref).not.toHaveBeenCalled();
    });

    it("opens a person's page with what you share, and goes back with ‹ People", async () => {
        const { props } = setup();

        fireEvent.click(await screen.findByText("Ben Ng"));

        const page = await screen.findByTestId("team-person");
        expect(within(page).getByTestId("team-back")).toHaveTextContent("People");
        expect(page).toHaveTextContent("Shared with you by Ben Ng");
        expect(page).toHaveTextContent("You shared with Ben Ng");
        const shared = await within(page).findByTestId("team-shared-list");
        expect(shared).toHaveTextContent("Finance / Board");
        expect(shared).toHaveTextContent("Can edit · via Sales");
        expect(page).toHaveTextContent("You haven't shared anything with Ben Ng yet.");
        await waitFor(() =>
            expect(calledWith("/api/workspace/activity")).toContain(
                "/api/workspace/activity?limit=15&actor=user-ben"
            )
        );

        fireEvent.click(within(shared).getByRole("button"));
        expect(props.onOpenTarget).toHaveBeenCalledWith({ type: "folder", path: "Finance/Board" });

        fireEvent.click(within(page).getByTestId("team-back"));
        expect(await screen.findByTestId("team-people")).toBeInTheDocument();
    });

    it("opens a person's page straight from a link, and says so when they've gone", async () => {
        const { unmount } = setup("/people/8");
        expect(await screen.findByTestId("team-person")).toHaveTextContent("Ben Ng");
        expect(screenTab("People")).toHaveAttribute("aria-current", "page");
        unmount();

        setup("/people/99");
        expect(await screen.findByText("This person is no longer here")).toBeInTheDocument();
    });

    it("lets a Member start a group but not manage someone else's", async () => {
        setup();
        await screen.findByTestId("team-people");
        fireEvent.click(screenTab("Groups"));

        expect(await screen.findByTestId("team-new-group")).toBeInTheDocument();
        fireEvent.click(await screen.findByText("Design"));

        const page = await screen.findByTestId("team-group");
        expect(within(page).getByTestId("team-back")).toHaveTextContent("Groups");
        expect(page).toHaveTextContent("Ben Ng");
        expect(within(page).queryByTestId("team-group-add")).not.toBeInTheDocument();
        expect(
            within(page).queryByRole("button", { name: /Actions for Design/ })
        ).not.toBeInTheDocument();
        expect(screenTab("Groups")).toHaveAttribute("aria-current", "page");
    });

    it("shows the activity feed by day, linking what can still be opened", async () => {
        const { props } = setup("/activity");

        const feed = await screen.findByTestId("team-activity");
        await waitFor(() =>
            expect(feed).toHaveTextContent("Ben Ng shared Finance with Sales team")
        );
        expect(within(feed).getAllByTestId("team-activity-day")[0]).toHaveAccessibleName("Today");
        expect(feed).toHaveTextContent("Ben Ng deleted Old.pdf");
        expect(within(feed).queryByRole("button", { name: /Old\.pdf/ })).not.toBeInTheDocument();

        fireEvent.click(
            within(feed).getByRole("button", { name: /shared Finance with Sales team/ })
        );
        expect(props.onOpenTarget).toHaveBeenCalledWith({ type: "folder", path: "Finance" });
    });

    it("narrows the feed by person and kind from the link, asking the server for just those", async () => {
        setup("/activity?person=8&kind=shared");

        await screen.findByTestId("team-activity");
        await waitFor(() =>
            expect(calledWith("/api/workspace/activity")).toContain(
                "/api/workspace/activity?limit=40&actor=user-ben&kind=shared"
            )
        );
        expect(screen.getByTestId("team-activity-person")).toHaveTextContent("Ben Ng");
        expect(screen.getByTestId("team-activity-kind")).toHaveTextContent("Sharing");
    });

    it("waits for the member list before reading ?person=, so it never shows everyone's rows first", async () => {
        let release: () => void = () => undefined;
        const membersReady = new Promise<void>(resolve => {
            release = resolve;
        });
        const base = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((input: RequestInfo | URL) =>
            urlOf(input) === "/api/workspace/members"
                ? membersReady.then(() => base(input))
                : base(input)
        );

        setup("/activity?person=8&kind=shared");
        await screen.findByTestId("team-activity-person");
        expect(calledWith("/api/workspace/activity")).toEqual([]);

        release();
        await waitFor(() =>
            expect(calledWith("/api/workspace/activity")).toEqual([
                "/api/workspace/activity?limit=40&actor=user-ben&kind=shared",
            ])
        );
    });

    it("says what went wrong when the team can't load, and retries", async () => {
        const base = fetchMock.getMockImplementation()!;
        let fail = true;
        fetchMock.mockImplementation((input: RequestInfo | URL) =>
            urlOf(input) === "/api/workspace/members" && fail
                ? json({ error: "The team is unavailable" }, 500)
                : base(input)
        );
        setup();

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("The team is unavailable");
        fail = false;
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
        expect(await screen.findByTestId("team-people")).toBeInTheDocument();
    });
});
