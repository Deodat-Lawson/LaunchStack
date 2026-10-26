/** @jest-environment jsdom */

/**
 * Settings › Usage › AI limits per person: one row per member with what they
 * used, the limit that binds them and where it comes from; the server's cap
 * read-only; and, for an admin, a dialog that sets one person's limit and
 * sends exactly the choice made.
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import type { AiAllowance, MemberAllowanceRow, MemberAllowancesResponse } from "../aiAllowance";
import { MemberAllowancesBlock } from "../MemberAllowancesBlock";

// Radix's radio measures itself; jsdom has no ResizeObserver.
global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// The workspace default is a registry row with its own tests; here it is a stand-in.
jest.mock("../SettingRow", () => ({
    SettingRow: ({ settingKey }: { settingKey: string }) => (
        <div data-testid={`setting-row-${settingKey}`} />
    ),
}));
jest.mock("~/lib/settings/useSettings", () => ({
    useSetting: () => ({ loaded: false, value: 0 }),
}));

const PERIOD = { start: "2026-10-01", resetsAt: "2026-11-01T00:00:00.000Z" };

function allowance(over: Partial<AiAllowance> = {}): AiAllowance {
    return {
        ...PERIOD,
        used: 0,
        workspace: { limit: 1_000_000, source: "default" },
        server: null,
        binding: "workspace",
        percent: 0,
        blocked: false,
        ...over,
    };
}

function row(over: Partial<MemberAllowanceRow> & { authUserId: string }): MemberAllowanceRow {
    return {
        displayName: over.authUserId,
        email: `${over.authUserId}@acme.test`,
        avatarUrl: null,
        roleName: "Member",
        status: "active",
        isSelf: false,
        allowance: allowance(),
        choice: { mode: "default" },
        ...over,
    } as MemberAllowanceRow;
}

const ADA = row({
    authUserId: "ada",
    displayName: "Ada Lovelace",
    isSelf: true,
    allowance: allowance({ used: 850_000, percent: 85 }),
});
const GRACE = row({
    authUserId: "grace",
    displayName: "Grace Hopper",
    allowance: allowance({
        used: 2_100_000,
        workspace: { limit: 2_000_000, source: "member" },
        percent: 105,
        blocked: true,
    }),
    choice: { mode: "custom", monthlyTokens: 2_000_000 },
});
const LIN = row({
    authUserId: "lin",
    displayName: "Lin Wei",
    allowance: allowance({
        used: 1_200,
        workspace: { limit: null, source: "member" },
        binding: null,
        percent: null,
    }),
    choice: { mode: "none" },
});

function payload(over: Partial<MemberAllowancesResponse> = {}): MemberAllowancesResponse {
    return {
        period: PERIOD,
        workspaceDefault: 1_000_000,
        serverCap: null,
        members: [GRACE, ADA, LIN],
        unattributed: 0,
        canEdit: true,
        ...over,
    };
}

const fetchMock = jest.fn();
type Reply = { status: number; body: unknown };
let listReply: Reply;
let putReply: Reply;

function respond({ status, body }: Reply) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
    jest.mocked(toast.success).mockClear();
    listReply = { status: 200, body: payload() };
    putReply = { status: 200, body: { member: ADA } };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/settings/usage/members") return respond(listReply);
        if (url.startsWith("/api/settings/usage/members/") && init?.method === "PUT") {
            return respond(putReply);
        }
        throw new Error(`unexpected fetch ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

const putCalls = () =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");

async function openEditor(name: string) {
    await userEvent.click(
        await screen.findByRole("button", { name: `Edit the AI limit for ${name}` })
    );
    return screen.findByRole("dialog");
}

describe("MemberAllowancesBlock", () => {
    it("lists each member with use, limit, where it comes from and how far along", async () => {
        render(<MemberAllowancesBlock />);

        expect(screen.getByText("AI limits per person")).toBeInTheDocument();
        expect(screen.getByTestId("setting-row-usage.memberMonthlyTokenLimit")).toBeInTheDocument();

        const ada = await screen.findByTestId("member-allowance-ada");
        expect(ada).toHaveTextContent("Ada Lovelace (you)");
        expect(ada).toHaveTextContent("850K");
        expect(ada).toHaveTextContent("1M");
        expect(ada).toHaveTextContent("Workspace default");
        expect(ada).toHaveTextContent("85%");
        expect(within(ada).getByRole("progressbar")).toHaveAttribute("data-tone", "warn");

        const grace = screen.getByTestId("member-allowance-grace");
        expect(grace).toHaveTextContent("Set for them");
        expect(grace).toHaveTextContent("105%");
        expect(within(grace).getByRole("progressbar")).toHaveAttribute("data-tone", "danger");

        const lin = screen.getByTestId("member-allowance-lin");
        expect(lin).toHaveTextContent("No limit");
        expect(within(lin).queryByRole("progressbar")).not.toBeInTheDocument();

        // Heaviest first, as the server sent them.
        const rows = screen.getAllByTestId(/^member-allowance-/);
        expect(rows.map(r => r.dataset.testid)).toEqual([
            "member-allowance-grace",
            "member-allowance-ada",
            "member-allowance-lin",
        ]);
        expect(
            screen.getByText("Counted since October 1, 2026. Limits reset on November 1, 2026.")
        ).toBeInTheDocument();
        expect(screen.queryByTestId("unattributed-usage")).not.toBeInTheDocument();
    });

    it("shows the server's cap read-only, and when it does not apply here", async () => {
        listReply = {
            status: 200,
            body: payload({
                serverCap: { limit: 5_000_000, appliesHere: false },
                unattributed: 4_200,
            }),
        };
        render(<MemberAllowancesBlock />);
        expect(
            await screen.findByText(
                "This server caps each person at 5,000,000 tokens a month on its own models. It doesn't apply here: this workspace runs on its own model."
            )
        ).toBeInTheDocument();
        expect(screen.getByTestId("unattributed-usage")).toHaveTextContent(
            "Not tied to a person: 4,200 tokens this month"
        );
    });

    it("names the server cap as the source when it binds", async () => {
        listReply = {
            status: 200,
            body: payload({
                serverCap: { limit: 3_000_000, appliesHere: true },
                members: [
                    row({
                        authUserId: "sam",
                        displayName: "Sam",
                        allowance: allowance({
                            used: 400_000,
                            server: { limit: 3_000_000, used: 2_700_000 },
                            binding: "server",
                            percent: 90,
                        }),
                    }),
                ],
            }),
        };
        render(<MemberAllowancesBlock />);
        const sam = await screen.findByTestId("member-allowance-sam");
        expect(sam).toHaveTextContent("3M");
        expect(sam).toHaveTextContent("Server cap · 2.7M used across workspaces");
        expect(
            screen.getByText(/This server caps each person at 3,000,000 tokens a month across all/)
        ).toBeInTheDocument();
    });

    it("offers no edit action without settings.manage", async () => {
        listReply = { status: 200, body: payload({ canEdit: false }) };
        render(<MemberAllowancesBlock />);
        await screen.findByTestId("member-allowance-ada");
        expect(screen.queryByRole("button", { name: /Edit the AI limit/ })).not.toBeInTheDocument();
    });

    it("says why the table could not load", async () => {
        listReply = { status: 403, body: { error: "You need the analytics permission." } };
        render(<MemberAllowancesBlock />);
        expect(await screen.findByText("You need the analytics permission.")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("sends a custom number and updates the row", async () => {
        const updated = row({
            ...ADA,
            authUserId: "ada",
            allowance: allowance({
                used: 850_000,
                workspace: { limit: 5_000_000, source: "member" },
                percent: 17,
            }),
            choice: { mode: "custom", monthlyTokens: 5_000_000 },
        });
        putReply = { status: 200, body: { member: updated } };
        render(<MemberAllowancesBlock />);

        const dialog = await openEditor("Ada Lovelace");
        expect(within(dialog).getByText("AI limit for Ada Lovelace")).toBeInTheDocument();
        expect(
            within(dialog).getByRole("radio", { name: "Workspace default (1,000,000 tokens)" })
        ).toBeChecked();
        await userEvent.click(within(dialog).getByRole("radio", { name: "Custom" }));
        const input = within(dialog).getByLabelText("Tokens a month");
        fireEvent.change(input, { target: { value: "5000000" } });
        await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        const [url, init] = putCalls()[0]!;
        expect(url).toBe("/api/settings/usage/members/ada");
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            mode: "custom",
            monthlyTokens: 5_000_000,
        });
        const ada = screen.getByTestId("member-allowance-ada");
        expect(ada).toHaveTextContent("5M");
        expect(ada).toHaveTextContent("Set for them");
        expect(toast.success).toHaveBeenCalledWith("AI limit saved for Ada Lovelace.");
    });

    it.each([
        ["No limit", { mode: "none" }],
        ["Workspace default (1,000,000 tokens)", { mode: "default" }],
    ] as const)("sends %s as %j", async (label, body) => {
        render(<MemberAllowancesBlock />);
        // Grace has a custom limit, so either choice is a change.
        const dialog = await openEditor("Grace Hopper");
        expect(within(dialog).getByRole("radio", { name: "Custom" })).toBeChecked();
        expect(within(dialog).getByLabelText("Tokens a month")).toHaveValue(2_000_000);
        await userEvent.click(within(dialog).getByRole("radio", { name: label }));
        await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

        await waitFor(() => expect(putCalls()).toHaveLength(1));
        const [url, init] = putCalls()[0]!;
        expect(url).toBe("/api/settings/usage/members/grace");
        expect(JSON.parse((init as RequestInit).body as string)).toEqual(body);
    });

    it("refuses a custom limit that isn't a whole number of tokens, without sending", async () => {
        render(<MemberAllowancesBlock />);
        const dialog = await openEditor("Lin Wei");
        expect(within(dialog).getByRole("radio", { name: "No limit" })).toBeChecked();
        await userEvent.click(within(dialog).getByRole("radio", { name: "Custom" }));
        fireEvent.change(within(dialog).getByLabelText("Tokens a month"), {
            target: { value: "0" },
        });
        await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
        expect(
            within(dialog).getByText("Enter a whole number of tokens, 1 or more.")
        ).toBeInTheDocument();
        expect(putCalls()).toHaveLength(0);
    });

    it("keeps the dialog open with the server's sentence when saving fails", async () => {
        putReply = { status: 403, body: { error: "Only workspace admins can change limits." } };
        render(<MemberAllowancesBlock />);
        const dialog = await openEditor("Ada Lovelace");
        await userEvent.click(within(dialog).getByRole("radio", { name: "No limit" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

        expect(
            await within(dialog).findByText("Only workspace admins can change limits.")
        ).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(toast.success).not.toHaveBeenCalled();
        // The row is unchanged.
        expect(screen.getByTestId("member-allowance-ada")).toHaveTextContent("Workspace default");
    });

    it("reloads when the section's Refresh bumps its token", async () => {
        const { rerender } = render(<MemberAllowancesBlock refreshToken={0} />);
        await screen.findByTestId("member-allowance-ada");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        rerender(<MemberAllowancesBlock refreshToken={1} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
});
