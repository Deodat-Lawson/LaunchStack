import { NextRequest } from "next/server";
import type * as MiddlewareModule from "~/middleware";

const mockPostgres = jest.fn((..._args: unknown[]) => ({}));
jest.mock("postgres", () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockPostgres(...args),
}));
jest.mock("drizzle-orm/postgres-js", () => ({
    drizzle: () => ({
        select: () => {
            throw new Error("synthetic lookup stopped");
        },
    }),
}));
jest.mock("~/server/auth", () => ({
    getSessionFromHeaders: async () => ({ user: { id: "synthetic-user" } }),
}));

function reloadedMiddleware() {
    let handler: typeof MiddlewareModule.default;
    jest.isolateModules(() => {
        handler = jest.requireActual<typeof MiddlewareModule>("~/middleware").default;
    });
    return handler!;
}
const request = () =>
    new NextRequest("http://localhost/", {
        headers: { cookie: "better-auth.session_token=synthetic" },
    });

describe("middleware development pool lifetime", () => {
    beforeEach(() => {
        mockPostgres.mockClear();
        jest.replaceProperty(process, "env", {
            ...process.env,
            NODE_ENV: "development",
            DATABASE_URL: "postgres://synthetic:synthetic@localhost/hmr-middleware",
        });
        jest.spyOn(console, "error").mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it("does not construct another pool after module re-evaluation", async () => {
        await reloadedMiddleware()(request());
        await reloadedMiddleware()(request());
        expect(mockPostgres).toHaveBeenCalledTimes(1);
        expect(mockPostgres).toHaveBeenCalledWith(process.env.DATABASE_URL, { max: 5 });
    });
    it("does not share pools across different database URLs", async () => {
        process.env.DATABASE_URL = "postgres://synthetic:synthetic@localhost/hmr-first";
        await reloadedMiddleware()(request());
        process.env.DATABASE_URL = "postgres://synthetic:synthetic@localhost/hmr-second";
        await reloadedMiddleware()(request());
        expect(mockPostgres).toHaveBeenCalledTimes(2);
    });
});
