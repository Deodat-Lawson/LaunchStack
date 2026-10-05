import type * as SharedClient from "~/server/db/shared-client";

/**
 * `next dev` re-evaluates route and middleware bundles on every recompile. A
 * postgres.js client opened per evaluation keeps its sockets open and pins the
 * superseded module graph (~30 MB per recompile). Re-evaluating the module
 * must reuse the process's client instead of opening another pool.
 */

const openedPools: Array<{ url: string; max: number }> = [];

jest.mock("postgres", () => ({
    __esModule: true,
    default: (url: string, options: { max: number }) => {
        openedPools.push({ url, max: options.max });
        return { url, max: options.max };
    },
}));

type SharedClientModule = typeof SharedClient;

// The module keeps its pools on this process-wide slot; tests reset it.
const processGlobals = globalThis as { __launchstackPostgresClients?: unknown };

function freshModule(): SharedClientModule {
    let loaded: SharedClientModule | undefined;
    jest.isolateModules(() => {
        loaded = jest.requireActual<SharedClientModule>("~/server/db/shared-client");
    });
    return loaded!;
}

afterEach(() => {
    openedPools.length = 0;
    delete processGlobals.__launchstackPostgresClients;
});

describe("sharedPostgresClient", () => {
    it("opens one pool per name across module re-evaluations", () => {
        const first = freshModule().sharedPostgresClient("auth", "postgres://db/app", 5);
        const second = freshModule().sharedPostgresClient("auth", "postgres://db/app", 5);

        expect(second).toBe(first);
        expect(openedPools).toEqual([{ url: "postgres://db/app", max: 5 }]);
    });

    it("keeps differently named pools separate", () => {
        const shared = freshModule();
        const auth = shared.sharedPostgresClient("auth", "postgres://db/app", 5);
        const middleware = shared.sharedPostgresClient("middleware", "postgres://db/app", 5);

        expect(middleware).not.toBe(auth);
        expect(openedPools).toHaveLength(2);
    });
});
