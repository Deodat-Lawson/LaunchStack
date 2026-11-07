import { localeOfRequest, replyLanguageInstruction } from "~/i18n/server";

describe("the model's reply language", () => {
    it("follows the request's cookie, then its languages", () => {
        const chosen = new Request("http://x/api", {
            headers: { cookie: "ls-locale=zh-CN.1", "accept-language": "en-US" },
        });
        const browser = new Request("http://x/api", { headers: { "accept-language": "zh-TW" } });
        expect(localeOfRequest(chosen)).toBe("zh-CN");
        expect(localeOfRequest(browser)).toBe("zh-CN");
        expect(localeOfRequest(new Request("http://x/api"))).toBe("en");
    });

    it("needs no instruction for English and names the language otherwise", () => {
        expect(replyLanguageInstruction("en")).toBeNull();
        expect(replyLanguageInstruction("zh-CN")).toContain("Simplified Chinese");
        expect(replyLanguageInstruction("zh-CN")).toContain("简体中文");
    });
});
