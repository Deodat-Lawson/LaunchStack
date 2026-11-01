/** @jest-environment jsdom */

/**
 * The Usage tab. What must not regress: an owner gets every screen across the
 * top and a member gets only their own (and never asks for anyone else's
 * numbers); the window carries from screen to screen and reaches the routes;
 * the leaderboard sorts, filters, opens a person and exports what it shows
 * (formula-looking names neutralised); Activity keeps its filters in the
 * query; and the Spending screen is the old Workspace › Usage section with
 * its deep-link row in the hash.
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type { ToolHost } from "~/components/tool-app/nav";
import { BUILTIN_ROLE_PERMISSIONS, ROLE_LABELS, type BuiltinRole } from "~/lib/authz/permissions";
import { presetWindow } from "~/lib/usage/range";
import type {
    UsageActivity,
    UsageCounts,
    UsageMe,
    UsagePeople,
    UsagePersonRow,
    UsageSummary,
} from "~/lib/usage/types";

jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
    usePathname: () => "/employer/documents",
}));

let mockPermissions: { roleName: string; permissions: ReadonlySet<string> | "all" } = {
    roleName: "Owner",
    permissions: "all",
};
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({
        loaded: true,
        error: null,
        roleName: mockPermissions.roleName,
        can: (p: string | undefined) =>
            p === undefined ||
            mockPermissions.permissions === "all" ||
            mockPermissions.permissions.has(p),
    }),
}));

// Charts are checked in the browser; here, which measures a chart offers.
jest.mock("~/app/employer/documents/_workspace/usage/DailyChart", () => ({
    DAILY_MEASURES: [],
    DailyChart: ({ title, measures }: { title: string; measures?: string[] }) => (
        <div data-testid="daily-chart" data-measures={(measures ?? ["all"]).join(",")}>
            {title}
        </div>
    ),
}));
jest.mock("~/app/employer/documents/_workspace/settings/AiAllowanceCard", () => ({
    AiAllowanceBody: () => <div data-testid="allowance-body" />,
}));
jest.mock("~/app/employer/documents/_workspace/settings/UsageSection", () => {
    const { useEffect, useState } = jest.requireActual<typeof React>("react");
    return {
        UsageSection: () => {
            const [seen, setSeen] = useState<string | null>(null);
            useEffect(() => setSeen(globalThis.location.hash), []);
            return <div data-testid="body-spending" data-hash={seen ?? ""} />;
        },
    };
});

const mockDownload = jest.fn();
jest.mock("~/lib/usage/csv", () => ({
    ...jest.requireActual<object>("~/lib/usage/csv"),
    downloadCsv: (name: string, csv: string) => mockDownload(name, csv),
}));

import { UsageTool } from "~/app/employer/documents/_workspace/usage/UsageTool";

global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const WINDOW = presetWindow(30);

function counts(overrides: Partial<UsageCounts> = {}): UsageCounts {
    return {
        questions: 0,
        filesAdded: 0,
        docsOpened: 0,
        aiCalls: 0,
        aiTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        ...overrides,
    };
}

function person(
    memberId: number,
    displayName: string,
    totals: Partial<UsageCounts>,
    extra: Partial<UsagePersonRow> = {}
): UsagePersonRow {
    return {
        memberId,
        authUserId: `u-${memberId}`,
        displayName,
        email: `${displayName.toLowerCase().replace(/\W/g, "")}@example.com`,
        avatarUrl: null,
        role: "member",
        roleName: "Member",
        status: "active",
        isSelf: false,
        groups: [],
        totals: counts(totals),
        activeDays: 3,
        lastActiveAt: null,
        topFeature: "ask",
        allowance: {
            used: 0,
            limit: null,
            percent: null,
            blocked: false,
            resetsAt: "2026-11-01T00:00:00.000Z",
        },
        ...extra,
    };
}

const PEOPLE: UsagePeople = {
    window: WINDOW,
    people: [
        person(
            1,
            "Ada Owner",
            { aiTokens: 90_000, questions: 4 },
            { isSelf: true, role: "owner", roleName: "Owner" }
        ),
        person(
            2,
            "Ben Busy",
            { aiTokens: 40_000, questions: 30 },
            {
                allowance: {
                    used: 40_000,
                    limit: 50_000,
                    percent: 80,
                    blocked: false,
                    resetsAt: "2026-11-01T00:00:00.000Z",
                },
            }
        ),
        person(3, '=HYPERLINK("x")', { aiTokens: 10, questions: 1 }),
    ],
    formerMembers: counts({ aiTokens: 500, questions: 2 }),
    unattributed: counts({ aiTokens: 7_000 }),
    groups: [{ id: 9, name: "Sales" }],
};

function summary(scope: UsageSummary["scope"] = { kind: "workspace" }): UsageSummary {
    const totals = {
        ...counts({ questions: 37, aiTokens: 137_500, aiCalls: 40, costUsd: 1.25 }),
        activePeople: 3,
        activeDays: 12,
    };
    return {
        window: WINDOW,
        scope,
        totals,
        previous: {
            ...counts({ questions: 20, aiTokens: 137_500 }),
            activePeople: 2,
            activeDays: 8,
        },
        daily: [],
        byFeature: [
            {
                feature: "ask",
                calls: 40,
                inputTokens: 120_000,
                outputTokens: 17_500,
                cachedInputTokens: 0,
                reasoningTokens: 0,
                costUsd: 1.25,
                people: 3,
            },
        ],
        byRoute: [],
        unattributedTokens: scope.kind === "workspace" ? 7_000 : 0,
        workspaceOwnedCalls: 0,
        members: 4,
    };
}

const ME: UsageMe = {
    summary: summary({ kind: "person", memberId: 4, displayName: "Mo Member" }),
    median: { questions: 10, filesAdded: 0, docsOpened: 2, aiTokens: 200_000, activeDays: 5 },
    members: 4,
    streak: { current: 4, longest: 6 },
};

const ACTIVITY: UsageActivity = {
    window: WINDOW,
    rows: [
        {
            date: WINDOW.to,
            memberId: 2,
            person: { displayName: "Ben Busy", avatarUrl: null },
            feature: "ask",
            route: "default",
            owner: "deployment",
            calls: 3,
            inputTokens: 9_000,
            outputTokens: 900,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costUsd: 0.04,
        },
        {
            date: WINDOW.to,
            memberId: null,
            person: null,
            feature: "ingestion",
            route: "auxiliary",
            owner: "deployment",
            calls: 1,
            inputTokens: 100,
            outputTokens: 10,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            costUsd: null,
        },
    ],
    total: 2,
    offset: 0,
    limit: 100,
};

let requests: string[] = [];
let me: UsageMe = ME;
const originalFetch = global.fetch;
const respond = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);

function serve() {
    global.fetch = jest.fn((url: string) => {
        requests.push(url);
        const { pathname, searchParams } = new URL(url, "http://x");
        if (pathname === "/api/usage/summary") {
            const id = searchParams.get("person");
            return respond(
                summary(
                    id
                        ? { kind: "person", memberId: Number(id), displayName: "Ben Busy" }
                        : undefined
                )
            );
        }
        if (pathname === "/api/usage/people") return respond(PEOPLE);
        if (pathname === "/api/usage/me") return respond(me);
        if (pathname === "/api/usage/activity") return respond(ACTIVITY);
        return respond({ error: `unexpected ${url}` }, 404);
    }) as unknown as typeof fetch;
}

let nonce = 0;
function open(at?: string) {
    const host: ToolHost = {
        active: true,
        request: at ? { at, nonce: ++nonce } : null,
        openHref: jest.fn(),
        openTool: jest.fn(),
    };
    return { ...render(<UsageTool host={host} />), host };
}

const as = (role: BuiltinRole) => {
    mockPermissions = { roleName: ROLE_LABELS[role], permissions: BUILTIN_ROLE_PERMISSIONS[role] };
};
const bar = () => screen.queryAllByRole("navigation", { name: "Usage screens" })[0];
const tabs = () =>
    within(bar()!)
        .getAllByRole("link")
        .map(link => link.textContent);

beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => {
    window.history.replaceState(null, "", "/employer/documents");
    mockPermissions = { roleName: "Owner", permissions: "all" };
    requests = [];
    me = ME;
    mockDownload.mockReset();
    serve();
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe("the Usage tab", () => {
    it("gives an owner every screen across the top and opens on the Overview", async () => {
        open();
        expect(tabs()).toEqual(["Overview", "People", "Activity", "Documents", "You", "Spending"]);
        const tile = await screen.findByTestId("usage-tile-questions");
        expect(tile).toHaveTextContent("37");
        // 37 against 20 the window before.
        expect(tile).toHaveTextContent("+85% · was 20");
        expect(screen.getByTestId("usage-tile-tokens")).toHaveTextContent("No change · was 137.5K");
        // The full comparison is there for a screen reader and on hover.
        expect(within(tile).getByText("Compared with the previous 30 days")).toBeInTheDocument();
        expect(screen.getByTestId("usage-tile-active")).toHaveTextContent("3 of 4");
        expect(screen.getByText(/came from work no one person started/)).toBeInTheDocument();
        // The most active, linked to their page.
        const top = await screen.findByTestId("usage-top-people");
        expect(within(top).getByRole("link", { name: /Ada Owner/ })).toBeInTheDocument();
        expect(requests.some(r => r.startsWith("/api/usage/summary?days=30"))).toBe(true);
    });

    it("gives a member one screen, their own, wherever a link points, and never asks for anyone else's", async () => {
        as("member");
        open("/people");

        const you = await screen.findByTestId("usage-you");
        expect(bar()).toBeUndefined();
        expect(within(you).getByRole("heading", { level: 1 })).toHaveTextContent("Your usage");
        // 37 questions against a median of 10; tokens below the median.
        expect(await screen.findByTestId("usage-you-questions-above")).toHaveTextContent("above");
        expect(screen.getByTestId("usage-you-aiTokens-below")).toBeInTheDocument();
        expect(screen.getByTestId("usage-you-streak")).toHaveTextContent("4 days");
        expect(screen.getByTestId("allowance-body")).toBeInTheDocument();
        // A person's chart has no Active people.
        expect(screen.getByTestId("daily-chart").dataset.measures).not.toContain("activePeople");
        expect(requests.length).toBeGreaterThan(0);
        for (const url of requests) expect(url).toMatch(/^\/api\/usage\/me\?/);
    });

    it("carries the window from screen to screen and asks the routes for it", async () => {
        const user = userEvent.setup();
        open();
        await screen.findByTestId("usage-tile-questions");
        await user.click(screen.getByTestId("usage-window-7"));
        await waitFor(() =>
            expect(requests.some(r => r.startsWith("/api/usage/summary?days=7"))).toBe(true)
        );
        await user.click(within(bar()!).getByRole("link", { name: "People" }));
        await screen.findByTestId("usage-people-table");
        expect(requests.filter(r => r.startsWith("/api/usage/people")).at(-1)).toMatch(/days=7/);
    });

    it("ranks people by AI tokens, re-sorts on a column, filters, and adds the rows that are nobody's", async () => {
        const user = userEvent.setup();
        open("/people");
        const table = await screen.findByTestId("usage-people-table");
        const names = () =>
            within(table)
                .getAllByTestId("usage-person-row")
                .map(row => within(row).getAllByRole("link")[0]!.textContent);
        expect(names()).toEqual(["Ada Owner", "Ben Busy", '=HYPERLINK("x")']);
        expect(within(table).getByTestId("usage-former-row")).toHaveTextContent(
            "People who have left"
        );
        expect(within(table).getByTestId("usage-unattributed-row")).toHaveTextContent("7K");
        expect(within(table).getAllByRole("progressbar")).toHaveLength(1);

        await user.click(screen.getByTestId("usage-sort-questions"));
        expect(names()).toEqual(["Ben Busy", "Ada Owner", '=HYPERLINK("x")']);

        await user.type(screen.getByPlaceholderText("Filter people"), "ben");
        expect(names()).toEqual(["Ben Busy"]);
        // The nobody rows belong to the totals, not to a search.
        expect(within(table).queryByTestId("usage-former-row")).not.toBeInTheDocument();
    });

    it("opens a person's numbers from their row", async () => {
        const user = userEvent.setup();
        open("/people");
        const table = await screen.findByTestId("usage-people-table");
        await user.click(within(table).getAllByTestId("usage-person-row")[1]!);
        const page = await screen.findByTestId("usage-person");
        expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent("Ben Busy");
        await waitFor(() =>
            expect(requests.some(r => /^\/api\/usage\/summary\?.*person=2/.test(r))).toBe(true)
        );
        expect(await within(page).findByText(/80% of 50K tokens/)).toBeInTheDocument();
        expect(within(page).getByRole("link", { name: /Their AI activity/ })).toHaveAttribute(
            "href",
            expect.stringContaining("person%3D2")
        );
    });

    it("exports the leaderboard as shown, with a formula-looking name made text", async () => {
        const user = userEvent.setup();
        open("/people");
        await screen.findByTestId("usage-people-table");
        await user.click(screen.getByTestId("usage-export"));
        expect(mockDownload).toHaveBeenCalledTimes(1);
        const [name, csv] = mockDownload.mock.calls[0] as [string, string];
        expect(name).toBe(`usage-people-${WINDOW.from}-to-${WINDOW.to}.csv`);
        const lines = csv.trim().split("\r\n");
        expect(lines[0]).toMatch(/^name,email,role,groups,active_days,questions/);
        expect(lines[1]).toMatch(/^Ada Owner,adaowner@example.com,Owner,,3,4,/);
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        expect(lines.at(-1)).toMatch(
            /^"No one person \(syncs, scheduled jobs\)",,,,,0,0,0,0,7000,/
        );
    });

    it("keeps Activity's filters in its query and names work no one started", async () => {
        open("/activity?person=2&feature=ask");
        const table = await screen.findByTestId("usage-activity-table");
        await waitFor(() =>
            expect(
                requests.some(r => /^\/api\/usage\/activity\?.*person=2.*feature=ask/.test(r))
            ).toBe(true)
        );
        const rows = within(table).getAllByTestId("usage-activity-row");
        expect(rows[0]).toHaveTextContent("Ben Busy");
        expect(rows[1]).toHaveTextContent("No one person");
        expect(screen.getByText("2 of 2 rows")).toBeInTheDocument();
    });

    it("draws the old Workspace › Usage section on Spending, with a link's row in the hash", async () => {
        open("/spending?focus=usage.pricePerMillionTokens");
        const body = await screen.findByTestId("body-spending");
        await waitFor(() =>
            expect(body).toHaveAttribute("data-hash", "#usage.pricePerMillionTokens")
        );
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "What the workspace is spending"
        );
        fireEvent.click(within(bar()!).getByRole("link", { name: "Overview" }));
        await screen.findByTestId("usage-overview");
        expect(window.location.hash).toBe("");
    });

    it("exports only the people a filter shows, without the rows that are nobody's", async () => {
        const user = userEvent.setup();
        open("/people");
        await screen.findByTestId("usage-people-table");
        await user.type(screen.getByPlaceholderText("Filter people"), "ben");
        await user.click(screen.getByTestId("usage-export"));
        const [, csv] = mockDownload.mock.calls[0] as [string, string];
        const lines = csv.trim().split("\r\n");
        expect(lines).toHaveLength(2);
        expect(lines[1]).toMatch(/^Ben Busy,/);
    });

    it("shows no median in a workspace too small to keep it anonymous", async () => {
        as("member");
        me = { ...ME, members: 2, median: null };
        open("/you");
        await screen.findByTestId("usage-you-questions");
        expect(screen.queryByText(/^Median /)).not.toBeInTheDocument();
        expect(screen.queryByText(/compared with the median/)).not.toBeInTheDocument();
    });

    it("shows a past window's longest run, not today's streak", async () => {
        as("member");
        me = {
            ...ME,
            summary: { ...ME.summary, window: { ...WINDOW, from: "2026-01-01", to: "2026-01-31" } },
            streak: { current: 3, longest: 5 },
        };
        open("/you");
        const tile = await screen.findByTestId("usage-you-streak");
        expect(tile).toHaveTextContent("Longest streak");
        expect(tile).toHaveTextContent("5 days");
        expect(screen.queryByText(/in a row/)).not.toBeInTheDocument();
    });
});
