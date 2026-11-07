/**
 * The operator's channel hears one line per report — the right shape for
 * Slack or Discord, never the body, the context or a screenshot, and never a
 * failure of the report itself.
 */

jest.mock("server-only", () => ({}), { virtual: true });

import {
    WEBHOOK_TIMEOUT_MS,
    feedbackWebhookLine,
    feedbackWebhookPayload,
    feedbackWebhookUrl,
    isDiscordWebhook,
    sendFeedbackWebhook,
    type WebhookReport,
} from "~/server/feedback/webhook";

const ORIGIN = "https://app.example.com";
const LINK = "https://app.example.com/employer/documents?feature=feedback&at=%2Ftriage%2F42";

const BUG: WebhookReport = { id: 42, kind: "bug", title: "Upload fails", severity: "blocking" };
const IDEA: WebhookReport = { id: 42, kind: "idea", title: "Dark mode", severity: null };

const SLACK = new URL("https://hooks.slack.com/services/T000/B000/secret-token");
const DISCORD = new URL("https://discord.com/api/webhooks/123/secret-token");

function okFetch() {
    return jest.fn(async () => new Response(null, { status: 204 }));
}

describe("feedbackWebhookUrl", () => {
    it("accepts http(s) URLs and nothing else", () => {
        expect(feedbackWebhookUrl("https://hooks.slack.com/x")?.hostname).toBe("hooks.slack.com");
        expect(feedbackWebhookUrl("  ")).toBeNull();
        expect(feedbackWebhookUrl(undefined)).toBeNull();
        expect(feedbackWebhookUrl("not a url")).toBeNull();
        expect(feedbackWebhookUrl("ftp://example.com/hook")).toBeNull();
    });

    it("recognises Discord's hosts, including its subdomains", () => {
        expect(isDiscordWebhook(DISCORD)).toBe(true);
        expect(isDiscordWebhook(new URL("https://ptb.discord.com/api/webhooks/1/x"))).toBe(true);
        expect(isDiscordWebhook(new URL("https://discordapp.com/api/webhooks/1/x"))).toBe(true);
        expect(isDiscordWebhook(new URL("https://evil-discord.com/api/webhooks/1/x"))).toBe(false);
        expect(isDiscordWebhook(SLACK)).toBe(false);
    });
});

describe("the line", () => {
    it("names a bug's severity and links to it in Triage", () => {
        expect(feedbackWebhookLine(BUG, ORIGIN, false)).toBe(
            `New bug (Blocking): Upload fails — ${LINK}`
        );
        expect(feedbackWebhookLine({ ...BUG, severity: null }, ORIGIN, false)).toBe(
            `New bug: Upload fails — ${LINK}`
        );
        expect(feedbackWebhookLine(IDEA, `${ORIGIN}/`, false)).toBe(
            `New feature request: Dark mode — ${LINK}`
        );
    });

    it("keeps a title on one line and defuses Slack's mentions", () => {
        const line = feedbackWebhookLine(
            { ...BUG, title: "Broken\n\n<!channel> & <https://x.test|click>" },
            ORIGIN,
            false
        );
        expect(line).not.toContain("\n");
        expect(line).not.toContain("<!channel>");
        expect(line).toContain("&lt;!channel&gt; &amp; &lt;https://x.test|click&gt;");
    });
});

describe("feedbackWebhookPayload", () => {
    it("sends Slack `{ text }`", () => {
        expect(feedbackWebhookPayload(SLACK, BUG, ORIGIN)).toEqual({
            text: `New bug (Blocking): Upload fails — ${LINK}`,
        });
    });

    it("sends Discord `{ content }` with every mention switched off", () => {
        expect(
            feedbackWebhookPayload(DISCORD, { ...IDEA, title: "@everyone look" }, ORIGIN)
        ).toEqual({
            content: `New feature request: @everyone look — ${LINK}`,
            allowed_mentions: { parse: [] },
        });
    });
});

describe("sendFeedbackWebhook", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it("posts JSON with a 5 second timeout and no redirects", async () => {
        const fetchImpl = okFetch();
        await expect(
            sendFeedbackWebhook(BUG, ORIGIN, { url: SLACK, fetchImpl: fetchImpl as typeof fetch })
        ).resolves.toBe(true);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [target, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
        expect(String(target)).toBe(String(SLACK));
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ "Content-Type": "application/json" });
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(WEBHOOK_TIMEOUT_MS).toBe(5_000);
        expect(JSON.parse(init.body as string)).toEqual({
            text: `New bug (Blocking): Upload fails — ${LINK}`,
        });
    });

    it("sends nothing but the kind, severity, title and link", async () => {
        const fetchImpl = okFetch();
        // A caller handing over a whole report still sends only the line.
        const everything = {
            ...BUG,
            body: "SECRET BODY",
            context: { url: "https://app.example.com/secret-path", userAgent: "UA" },
            attachments: [{ data: "AAAA" }],
        } as unknown as WebhookReport;
        await sendFeedbackWebhook(everything, ORIGIN, {
            url: DISCORD,
            fetchImpl: fetchImpl as typeof fetch,
        });

        const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
        const sent = init.body as string;
        expect(Object.keys(JSON.parse(sent) as object).sort()).toEqual([
            "allowed_mentions",
            "content",
        ]);
        expect(sent).not.toContain("SECRET BODY");
        expect(sent).not.toContain("secret-path");
        expect(sent).not.toContain("AAAA");
    });

    it("does nothing when no webhook is configured", async () => {
        const fetchImpl = okFetch();
        await expect(
            sendFeedbackWebhook(BUG, ORIGIN, { url: null, fetchImpl: fetchImpl as typeof fetch })
        ).resolves.toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("never throws, and never logs the secret URL", async () => {
        const rejecting = jest.fn(async () => {
            throw Object.assign(new Error(`connect ECONNREFUSED ${String(SLACK)}`), {
                name: "TypeError",
            });
        });
        await expect(
            sendFeedbackWebhook(BUG, ORIGIN, { url: SLACK, fetchImpl: rejecting as typeof fetch })
        ).resolves.toBe(false);

        const refusing = jest.fn(async () => new Response("no", { status: 403 }));
        await expect(
            sendFeedbackWebhook(BUG, ORIGIN, { url: SLACK, fetchImpl: refusing as typeof fetch })
        ).resolves.toBe(false);

        const logged = warn.mock.calls.flat().join(" ");
        expect(warn).toHaveBeenCalledTimes(2);
        expect(logged).toContain("403");
        expect(logged).not.toContain("secret-token");
        expect(logged).not.toContain("hooks.slack.com");
    });

    it("reads FEEDBACK_WEBHOOK_URL when no URL is passed", async () => {
        const original = process.env.FEEDBACK_WEBHOOK_URL;
        process.env.FEEDBACK_WEBHOOK_URL = String(DISCORD);
        try {
            const fetchImpl = okFetch();
            await sendFeedbackWebhook(IDEA, ORIGIN, { fetchImpl: fetchImpl as typeof fetch });
            const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
            expect(JSON.parse(init.body as string)).toHaveProperty("content");
        } finally {
            if (original === undefined) delete process.env.FEEDBACK_WEBHOOK_URL;
            else process.env.FEEDBACK_WEBHOOK_URL = original;
        }
    });
});
