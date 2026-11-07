/** @jest-environment jsdom */

import { collectFeedbackContext, describeBrowser } from "~/lib/feedback/context";
import { feedbackContextSchema } from "~/lib/feedback/contract";
import { clearRecentErrors, installRecentErrors, recentErrors } from "~/lib/feedback/recent-errors";

// Silence what the tests log on purpose: the buffer wraps whatever
// console.error is when it installs, so this is what it passes through to.
jest.spyOn(console, "error").mockImplementation(() => undefined);

describe("describeBrowser", () => {
    it.each([
        [
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
            "Chrome 141 on macOS",
        ],
        [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
            "Edge 140 on Windows",
        ],
        [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            "Safari 18 on iOS",
        ],
        ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox 131 on Linux"],
        ["curl/8.0", undefined],
    ])("reads %s", (ua, expected) => {
        expect(describeBrowser(ua)).toBe(expected);
    });
});

describe("collectFeedbackContext", () => {
    beforeEach(() => {
        clearRecentErrors();
        window.history.replaceState({}, "", "/employer/documents?feature=knowledge");
        document.documentElement.dataset.theme = "dark";
        document.documentElement.lang = "zh-CN";
    });

    it("sends only the page when technical details are off", () => {
        expect(collectFeedbackContext({ technical: false })).toEqual({
            path: "/employer/documents?feature=knowledge",
        });
        expect(collectFeedbackContext({ technical: false, origin: { jobId: "j1" } })).toEqual({
            path: "/employer/documents?feature=knowledge",
            origin: { jobId: "j1" },
        });
    });

    it("describes the page, window and theme, in a shape the server accepts", () => {
        const context = collectFeedbackContext({ technical: true });
        expect(context).toMatchObject({
            path: "/employer/documents?feature=knowledge",
            theme: "dark",
            locale: "zh-CN",
            viewport: { width: window.innerWidth, height: window.innerHeight },
        });
        expect(context.url).toContain("/employer/documents?feature=knowledge");
        expect(feedbackContextSchema.safeParse(context).success).toBe(true);
    });

    it("includes recent errors only when there were some", () => {
        expect(collectFeedbackContext({ technical: true }).recentErrors).toBeUndefined();
        installRecentErrors();
        // eslint-disable-next-line no-console -- the thing under test
        console.error("Something failed:", new Error("boom"));
        expect(collectFeedbackContext({ technical: true }).recentErrors).toEqual([
            expect.objectContaining({ message: "Something failed: Error: boom", source: "console" }),
        ]);
    });
});

describe("recent errors", () => {
    beforeAll(() => installRecentErrors());
    beforeEach(() => clearRecentErrors());

    it("keeps the last ten, newest last, and drops repeats", () => {
        for (let i = 0; i < 14; i += 1) {
            // eslint-disable-next-line no-console -- the thing under test
            console.error(`failure ${i}`);
            // eslint-disable-next-line no-console -- a render loop repeating itself
            console.error(`failure ${i}`);
        }
        const kept = recentErrors().map(e => e.message);
        expect(kept).toHaveLength(10);
        expect(kept[0]).toBe("failure 4");
        expect(kept.at(-1)).toBe("failure 13");
    });

    it("hears uncaught errors and rejections", () => {
        window.dispatchEvent(new ErrorEvent("error", { message: "x is not a function", error: new TypeError("x is not a function") }));
        const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
        rejection.reason = new Error("fetch failed");
        window.dispatchEvent(rejection);
        expect(recentErrors()).toEqual([
            expect.objectContaining({ message: "TypeError: x is not a function", source: "error" }),
            expect.objectContaining({ message: "Error: fetch failed", source: "unhandledrejection" }),
        ]);
    });

    it("trims long messages", () => {
        // eslint-disable-next-line no-console -- the thing under test
        console.error("y".repeat(2000));
        expect(recentErrors()[0]!.message).toHaveLength(500);
    });
});
