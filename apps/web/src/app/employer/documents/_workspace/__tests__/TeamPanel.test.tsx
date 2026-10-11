/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { Permission } from "~/lib/authz/permissions";
import { resetPeopleCache } from "~/lib/profile/use-people";

import { TeamPanel } from "../team/TeamPanel";
import type { TeamRailProps } from "../team/types";

/**
 * The Team tab (ADR-014 §7): People with a page per person showing what you
 * share with each other, Groups that members can start, the Activity feed, and
 * a one-line explanation for Guests.
 */

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

function setup(over: Partial<TeamRailProps> = {}) {
    const props: TeamRailProps = {
        query: "",
        onOpenTarget: jest.fn(),
        onShare: jest.fn(),
        ...over,
    };
    const utils = render(<TeamPanel {...props} />);
    return { ...utils, props };
}

describe("TeamPanel", () => {
    it("tells a Guest why there is no team list", () => {
        mockPerms = new Set<Permission>(["documents.read"]);
        mockRole = "guest";
        setup();

        expect(screen.getByTestId("team-panel")).toHaveTextContent(
            /sees only what is shared with you/
        );
        expect(calledWith("/api/workspace/members")).toEqual([]);
    });

    it("lists active people with title, role and groups", async () => {
        setup();

        const list = await screen.findByTestId("team-people");
        const rows = within(list).getAllByTestId("team-person-row");
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent("Mo (you)");
        expect(rows[1]).toHaveTextContent("Ben Ng");
        expect(rows[1]).toHaveTextContent("Designer · Admin · Design");
        expect(screen.queryByText("Cy Park")).not.toBeInTheDocument();
    });

    it("filters people by the rail's filter text", async () => {
        setup({ query: "design" });

        const list = await screen.findByTestId("team-people");
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

    it("opens a person's page with what you share, and goes back with ‹ Team", async () => {
        const { props } = setup();

        fireEvent.click(await screen.findByText("Ben Ng"));

        const page = await screen.findByTestId("team-person");
        expect(within(page).getByTestId("team-back")).toHaveTextContent("Team");
        expect(page).toHaveTextContent("Shared with you by Ben");
        expect(page).toHaveTextContent("You shared with Ben");
        const shared = await within(page).findByTestId("team-shared-list");
        expect(shared).toHaveTextContent("Finance / Board");
        expect(shared).toHaveTextContent("Can edit · via Sales");
        expect(page).toHaveTextContent("You haven't shared anything with Ben yet.");
        await waitFor(() =>
            expect(calledWith("/api/workspace/activity")).toContain(
                "/api/workspace/activity?limit=10&actor=user-ben"
            )
        );

        fireEvent.click(within(shared).getByRole("button"));
        expect(props.onOpenTarget).toHaveBeenCalledWith({ type: "folder", path: "Finance/Board" });

        fireEvent.click(within(page).getByTestId("team-back"));
        expect(await screen.findByTestId("team-people")).toBeInTheDocument();
    });

    it("lets a Member start a group but not manage someone else's", async () => {
        setup();
        fireEvent.click(await screen.findByTestId("team-view-groups"));

        expect(await screen.findByTestId("team-new-group")).toBeInTheDocument();
        fireEvent.click(await screen.findByText("Design"));

        const page = await screen.findByTestId("team-group");
        expect(within(page).getByTestId("team-back")).toHaveTextContent("Groups");
        expect(page).toHaveTextContent("Ben Ng");
        expect(within(page).queryByText("Add people")).not.toBeInTheDocument();
        expect(
            within(page).queryByRole("button", { name: /Actions for Design/ })
        ).not.toBeInTheDocument();
    });

    it("shows the activity feed, linking what can still be opened", async () => {
        const { props } = setup();
        fireEvent.click(await screen.findByTestId("team-view-activity"));

        const feed = await screen.findByTestId("team-activity");
        await waitFor(() =>
            expect(feed).toHaveTextContent("Ben Ng shared Finance with Sales team")
        );
        expect(feed).toHaveTextContent("Ben Ng deleted Old.pdf");
        expect(within(feed).queryByRole("button", { name: "Old.pdf" })).not.toBeInTheDocument();

        fireEvent.click(within(feed).getByRole("button", { name: "Finance" }));
        expect(props.onOpenTarget).toHaveBeenCalledWith({ type: "folder", path: "Finance" });
    });
});
