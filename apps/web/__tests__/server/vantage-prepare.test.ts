/**
 * Vantage drafts a week when someone opens it, so the server must turn a
 * reload, a second tab or a teammate opening the same empty week mid-draft
 * into one model call: same workspace and week share the draft in flight;
 * another week or workspace does not; a finished draft is forgotten.
 */

const mockPrepareAgenda = jest.fn();
jest.mock("@launchstack/pipelines/vantage", () => ({
    prepareAgenda: (...args: unknown[]) => mockPrepareAgenda(...args),
}));
jest.mock("~/lib/models", () => ({
    resolveConfiguredChatModel: jest.fn(),
}));

import { prepareWeek } from "~/server/vantage/service";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const args = (companyId: bigint, weekStart: string) => ({ companyId, userId: "u1", weekStart });

beforeEach(() => mockPrepareAgenda.mockReset());

describe("prepareWeek", () => {
    it("shares one draft between requests for the same workspace and week", async () => {
        const pending = deferred<{ id: string }>();
        mockPrepareAgenda.mockReturnValue(pending.promise);

        const first = prepareWeek(args(50n, "2026-10-05"));
        const second = prepareWeek(args(50n, "2026-10-05"));
        pending.resolve({ id: "a1" });

        await expect(first).resolves.toEqual({ id: "a1" });
        await expect(second).resolves.toEqual({ id: "a1" });
        expect(mockPrepareAgenda).toHaveBeenCalledTimes(1);
    });

    it("does not share across weeks or workspaces", async () => {
        mockPrepareAgenda.mockImplementation(() => new Promise(() => undefined));

        void prepareWeek(args(51n, "2026-10-05"));
        void prepareWeek(args(51n, "2026-10-12"));
        void prepareWeek(args(52n, "2026-10-05"));

        expect(mockPrepareAgenda).toHaveBeenCalledTimes(3);
    });

    it("forgets a finished draft, so asking again drafts again", async () => {
        mockPrepareAgenda.mockResolvedValueOnce({ id: "a1" }).mockResolvedValueOnce({ id: "a2" });

        await expect(prepareWeek(args(53n, "2026-10-05"))).resolves.toEqual({ id: "a1" });
        await expect(prepareWeek(args(53n, "2026-10-05"))).resolves.toEqual({ id: "a2" });
        expect(mockPrepareAgenda).toHaveBeenCalledTimes(2);
    });

    it("forgets a failed draft too, and every waiter hears the failure", async () => {
        const pending = deferred<{ id: string }>();
        mockPrepareAgenda.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ id: "a2" });

        const first = prepareWeek(args(54n, "2026-10-05"));
        const second = prepareWeek(args(54n, "2026-10-05"));
        pending.reject(new Error("database down"));

        await expect(first).rejects.toThrow("database down");
        await expect(second).rejects.toThrow("database down");
        await expect(prepareWeek(args(54n, "2026-10-05"))).resolves.toEqual({ id: "a2" });
    });
});
