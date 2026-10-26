/**
 * The signup form pre-fills the workspace name it is given, so the
 * suggestion is in the reader's language — English without the cookie.
 */

jest.mock("~/lib/require-workspace-context", () => ({
    requireAuthIdentity: jest.fn().mockResolvedValue({
        success: true,
        data: { authUserId: "user-a" },
    }),
}));
const mockSession = jest.fn();
jest.mock("~/server/auth", () => ({ getServerSession: () => mockSession() }));
jest.mock("~/lib/workspace-slug", () => ({
    suggestAvailableCompanyName: (preferred: string) => Promise.resolve(preferred),
}));

import { GET } from "~/app/api/signup/workspace-name-suggestion/route";

const url = "http://localhost/api/signup/workspace-name-suggestion";
const english = () => new Request(url);
const chinese = () => new Request(url, { headers: { cookie: "ls-locale=zh-CN.1" } });

async function suggestion(request: Request): Promise<string> {
    return ((await (await GET(request)).json()) as { name: string }).name;
}

describe("GET /api/signup/workspace-name-suggestion", () => {
    it("names the workspace after the person", async () => {
        mockSession.mockResolvedValue({ user: { name: "Ada Lovelace" } });
        expect(await suggestion(english())).toBe("Ada's workspace");
        expect(await suggestion(chinese())).toBe("Ada 的工作区");
    });

    it("falls back to a plain name when the account has none", async () => {
        mockSession.mockResolvedValue({ user: { name: "" } });
        expect(await suggestion(english())).toBe("My workspace");
        expect(await suggestion(chinese())).toBe("我的工作区");
    });
});
