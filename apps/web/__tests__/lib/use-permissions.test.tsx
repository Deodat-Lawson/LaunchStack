/** @jest-environment jsdom */

/**
 * The permissions hook fails closed, shares one request, and forgets on
 * demand. Those three properties are what every gated menu relies on.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    Can,
    invalidatePermissions,
    parseUserInfo,
    resetPermissionsForTests,
    usePermissions,
} from "~/lib/use-permissions";

type Deferred = { resolve: (value: Response) => void; promise: Promise<Response> };

function deferred(): Deferred {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(r => {
        resolve = r;
    });
    return { resolve, promise };
}

function jsonResponse(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as unknown as Response;
}

function Probe({ id = "probe" }: { id?: string }) {
    const { loaded, can, role, status } = usePermissions();
    return (
        <div
            data-testid={id}
            data-loaded={String(loaded)}
            data-can={String(can("members.manage"))}
            data-open={String(can(undefined))}
            data-role={role ?? ""}
            data-status={status ?? ""}
        />
    );
}

const ADMIN = {
    role: "admin",
    roleName: "Admin",
    membershipStatus: "active",
    companyId: 4,
    company: "Northwind",
    permissions: ["members.view", "members.manage", "settings.manage"],
};

let fetchMock: jest.Mock;

beforeEach(() => {
    resetPermissionsForTests();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("parseUserInfo", () => {
    it("keeps only catalogue permissions and reads the membership fields", () => {
        const snap = parseUserInfo({ ...ADMIN, permissions: ["members.view", "not.a.thing"] });
        expect([...snap.permissions]).toEqual(["members.view"]);
        expect(snap.role).toBe("admin");
        expect(snap.roleName).toBe("Admin");
        expect(snap.status).toBe("active");
        expect(snap.companyId).toBe(4);
        expect(snap.workspaceName).toBe("Northwind");
    });

    it("gives a suspended or pending member nothing, whatever the server sent", () => {
        expect(parseUserInfo({ ...ADMIN, membershipStatus: "suspended" }).permissions.size).toBe(0);
        expect(parseUserInfo({ ...ADMIN, membershipStatus: "pending" }).permissions.size).toBe(0);
    });

    it("tolerates a malformed payload", () => {
        const snap = parseUserInfo(null);
        expect(snap.permissions.size).toBe(0);
        expect(snap.role).toBeNull();
        expect(snap.companyId).toBeNull();
    });
});

describe("usePermissions", () => {
    it("answers false until the server has spoken, then true", async () => {
        const pending = deferred();
        fetchMock.mockReturnValue(pending.promise);

        render(<Probe />);
        const probe = screen.getByTestId("probe");
        expect(probe).toHaveAttribute("data-loaded", "false");
        expect(probe).toHaveAttribute("data-can", "false");
        // No requirement is not a gate.
        expect(probe).toHaveAttribute("data-open", "true");

        await act(async () => {
            pending.resolve(jsonResponse(ADMIN));
            await pending.promise;
        });

        await waitFor(() => expect(probe).toHaveAttribute("data-loaded", "true"));
        expect(probe).toHaveAttribute("data-can", "true");
        expect(probe).toHaveAttribute("data-role", "admin");
        expect(probe).toHaveAttribute("data-status", "active");
    });

    it("shares one request across every subscriber", async () => {
        fetchMock.mockResolvedValue(jsonResponse(ADMIN));

        render(
            <>
                <Probe id="a" />
                <Probe id="b" />
                <Probe id="c" />
            </>
        );

        await waitFor(() => expect(screen.getByTestId("c")).toHaveAttribute("data-loaded", "true"));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("a")).toHaveAttribute("data-can", "true");
        expect(screen.getByTestId("b")).toHaveAttribute("data-can", "true");
    });

    it("treats a failed response as no permissions at all", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: "No active workspace" }, 403));

        render(<Probe />);
        const probe = screen.getByTestId("probe");
        await waitFor(() => expect(probe).toHaveAttribute("data-loaded", "true"));
        expect(probe).toHaveAttribute("data-can", "false");
    });

    it("refetches after invalidatePermissions and reflects the new role", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(ADMIN));
        render(<Probe />);
        const probe = screen.getByTestId("probe");
        await waitFor(() => expect(probe).toHaveAttribute("data-can", "true"));

        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                ...ADMIN,
                role: "viewer",
                roleName: "Viewer",
                permissions: ["members.view"],
            })
        );
        await act(async () => {
            await invalidatePermissions();
        });

        await waitFor(() => expect(probe).toHaveAttribute("data-role", "viewer"));
        expect(probe).toHaveAttribute("data-can", "false");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("<Can>", () => {
    it("renders children only once the permission is confirmed", async () => {
        const pending = deferred();
        fetchMock.mockReturnValue(pending.promise);

        render(
            <Can permission="settings.manage" fallback={<span>nope</span>}>
                <span>settings</span>
            </Can>
        );
        expect(screen.getByText("nope")).toBeInTheDocument();
        expect(screen.queryByText("settings")).not.toBeInTheDocument();

        await act(async () => {
            pending.resolve(jsonResponse(ADMIN));
            await pending.promise;
        });

        await waitFor(() => expect(screen.getByText("settings")).toBeInTheDocument());
    });
});
