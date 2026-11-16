const mockPostgres = jest.fn((..._args: unknown[]) => ({}));
jest.mock("postgres", () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockPostgres(...args),
}));
import { getPostgresClient } from "~/server/dev-postgres";

describe("development pool cache identity", () => {
    beforeEach(() => {
        mockPostgres.mockClear();
        jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
    });
    afterEach(() => jest.restoreAllMocks());
    it("keeps database URL, consumer and pool configuration separate", () => {
        const configuration = {
            consumer: "auth" as const,
            url: "postgres://synthetic:one@localhost/helper-first",
            max: 5,
        };
        const first = getPostgresClient(configuration);
        expect(getPostgresClient(configuration)).toBe(first);
        expect(
            getPostgresClient({
                ...configuration,
                url: "postgres://synthetic:two@localhost/helper-first",
            })
        ).not.toBe(first);
        expect(
            getPostgresClient({
                ...configuration,
                url: "postgres://synthetic:one@localhost/helper-second",
            })
        ).not.toBe(first);
        expect(getPostgresClient({ ...configuration, consumer: "middleware" })).not.toBe(first);
        expect(getPostgresClient({ ...configuration, max: 4 })).not.toBe(first);
        expect(mockPostgres).toHaveBeenCalledTimes(5);
    });
    it.each(["production", "test"] as const)("leaves pool lifetime with callers in %s", mode => {
        jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: mode });
        const config = {
            consumer: "auth" as const,
            url: "postgres://synthetic:synthetic@localhost/helper-prod",
            max: 5,
        };
        expect(getPostgresClient(config)).not.toBe(getPostgresClient(config));
        expect(mockPostgres).toHaveBeenCalledTimes(2);
    });
});
