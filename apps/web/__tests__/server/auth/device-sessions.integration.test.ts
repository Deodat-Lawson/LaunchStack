/**
 * Several accounts in one browser, end to end through the app's own Better
 * Auth instance against a migrated throwaway database: adding an account
 * keeps the first, switching changes who every session read sees, signing
 * out of one leaves the other active, and a plain sign-out ends them all.
 * Also the one endpoint of ours: a session from before multi-session was on
 * is remembered, so adding an account doesn't silently drop it.
 *
 * See ~/server/auth/device-sessions.
 */
import { eq } from "drizzle-orm";

import { authSession } from "~/server/db/schema";
import type { auth as Auth } from "~/server/auth";
import { isAtAccountLimit, MAX_DEVICE_ACCOUNTS } from "~/lib/auth/device-accounts";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const BASE = "http://localhost:3998";
const PASSWORD = "correct horse battery";
const MULTI = "better-auth.session_token_multi-";

/** A cookie jar in front of the auth handler: one browser. */
class Browser {
    readonly jar = new Map<string, string>();

    constructor(private readonly auth: typeof Auth) {}

    async send(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
        const headers = new Headers({ origin: BASE });
        if (init.body !== undefined) headers.set("content-type", "application/json");
        const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
        if (cookie) headers.set("cookie", cookie);
        const response = await this.auth.handler(
            new Request(`${BASE}/api/auth${path}`, {
                method: init.method ?? (init.body === undefined ? "GET" : "POST"),
                headers,
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            })
        );
        for (const line of response.headers.getSetCookie()) {
            const [pair = ""] = line.split(";");
            const split = pair.indexOf("=");
            const name = pair.slice(0, split);
            const value = pair.slice(split + 1);
            if (!value || /max-age=0/i.test(line)) this.jar.delete(name);
            else this.jar.set(name, value);
        }
        return response;
    }

    async who(): Promise<string | null> {
        const response = await this.send("/get-session");
        const body = (await response.json()) as { user: { email: string } } | null;
        return body?.user.email ?? null;
    }

    async token(): Promise<string> {
        const response = await this.send("/get-session");
        const body = (await response.json()) as { session: { token: string } };
        return body.session.token;
    }

    async accounts(): Promise<{ email: string; token: string }[]> {
        const response = await this.send("/multi-session/list-device-sessions");
        expect(response.status).toBe(200);
        const rows = (await response.json()) as {
            session: { token: string };
            user: { email: string };
        }[];
        return rows
            .map(r => ({ email: r.user.email, token: r.session.token }))
            .sort((a, b) => a.email.localeCompare(b.email));
    }

    multiCookies(): string[] {
        return [...this.jar.keys()].filter(name => name.startsWith(MULTI));
    }

    async signIn(email: string): Promise<void> {
        const response = await this.send("/sign-in/email", {
            body: { email, password: PASSWORD },
        });
        expect(response.status).toBe(200);
    }
}

describeIfDatabase("several accounts in one browser", () => {
    jest.setTimeout(120_000);

    let testDb: FounderWeeklyReviewTestDatabase;
    let auth: typeof Auth;
    const quiet: jest.SpyInstance[] = [];
    let counter = 0;

    async function newAccount(): Promise<string> {
        const email = `person${++counter}-${Date.now()}@example.com`;
        const response = await new Browser(auth).send("/sign-up/email", {
            body: { email, password: PASSWORD, name: `Person ${counter}` },
        });
        expect(response.status).toBe(200);
        return email;
    }

    async function sessionExists(token: string): Promise<boolean> {
        const rows = await testDb.db
            .select({ id: authSession.id })
            .from(authSession)
            .where(eq(authSession.token, token));
        return rows.length > 0;
    }

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(
            (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)!
        );
        url.pathname = `/${testDb.databaseName}`;
        process.env.DATABASE_URL = url.toString();
        process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
        process.env.BETTER_AUTH_URL = BASE;
        quiet.push(jest.spyOn(console, "warn").mockImplementation(() => undefined));
        quiet.push(jest.spyOn(console, "error").mockImplementation(() => undefined));
        ({ auth } = await import("~/server/auth"));
    });

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await testDb?.close();
    });

    it("adds an account without dropping the first, and switches between them", async () => {
        const ann = await newAccount();
        const bob = await newAccount();
        const browser = new Browser(auth);

        await browser.signIn(ann);
        await browser.signIn(bob);

        // The newest sign-in is the active one; both are remembered.
        expect(await browser.who()).toBe(bob);
        expect((await browser.accounts()).map(a => a.email)).toEqual([ann, bob].sort());

        const annToken = (await browser.accounts()).find(a => a.email === ann)!.token;
        const switched = await browser.send("/multi-session/set-active", {
            body: { sessionToken: annToken },
        });
        expect(switched.status).toBe(200);
        expect(await browser.who()).toBe(ann);

        // Switching only changes which one is active.
        expect((await browser.accounts()).map(a => a.email)).toEqual([ann, bob].sort());
    });

    it("refuses to switch to a session this browser doesn't hold", async () => {
        const ann = await newAccount();
        const eve = await newAccount();
        const mine = new Browser(auth);
        await mine.signIn(ann);
        const theirs = new Browser(auth);
        await theirs.signIn(eve);

        const response = await mine.send("/multi-session/set-active", {
            body: { sessionToken: await theirs.token() },
        });

        expect(response.status).toBe(401);
        expect(await mine.who()).toBe(ann);
    });

    it("signs one account out and makes the other active", async () => {
        const ann = await newAccount();
        const bob = await newAccount();
        const browser = new Browser(auth);
        await browser.signIn(ann);
        await browser.signIn(bob);
        const bobToken = await browser.token();

        const response = await browser.send("/multi-session/revoke", {
            body: { sessionToken: bobToken },
        });

        expect(response.status).toBe(200);
        expect(await sessionExists(bobToken)).toBe(false);
        expect(await browser.who()).toBe(ann);
        expect((await browser.accounts()).map(a => a.email)).toEqual([ann]);
    });

    it("signs the last account out completely", async () => {
        const ann = await newAccount();
        const browser = new Browser(auth);
        await browser.signIn(ann);

        await browser.send("/multi-session/revoke", {
            body: { sessionToken: await browser.token() },
        });

        expect(await browser.who()).toBeNull();
        expect(browser.multiCookies()).toEqual([]);
    });

    it("ends every account on a plain sign-out", async () => {
        const ann = await newAccount();
        const bob = await newAccount();
        const browser = new Browser(auth);
        await browser.signIn(ann);
        await browser.signIn(bob);
        const tokens = (await browser.accounts()).map(a => a.token);

        const response = await browser.send("/sign-out", { body: {} });

        expect(response.status).toBe(200);
        expect(await browser.who()).toBeNull();
        expect(browser.multiCookies()).toEqual([]);
        for (const token of tokens) expect(await sessionExists(token)).toBe(false);
    });

    it("signing in again as the same person replaces their session, not adds one", async () => {
        const ann = await newAccount();
        const browser = new Browser(auth);
        await browser.signIn(ann);
        await browser.signIn(ann);

        expect((await browser.accounts()).map(a => a.email)).toEqual([ann]);
        expect(browser.multiCookies()).toHaveLength(1);
    });

    it("remembers a session from before multi-session, so adding one keeps it", async () => {
        const ann = await newAccount();
        const bob = await newAccount();
        const browser = new Browser(auth);
        await browser.signIn(ann);
        // What a browser signed in before the plugin shipped looks like.
        for (const name of browser.multiCookies()) browser.jar.delete(name);
        expect(await browser.accounts()).toEqual([]);

        const remembered = await browser.send("/device-sessions/remember", {
            method: "POST",
            body: {},
        });
        expect(await remembered.json()).toEqual({ remembered: true });
        expect((await browser.accounts()).map(a => a.email)).toEqual([ann]);

        await browser.signIn(bob);
        expect((await browser.accounts()).map(a => a.email)).toEqual([ann, bob].sort());

        // Calling it again is harmless.
        await browser.send("/device-sessions/remember", { method: "POST", body: {} });
        expect(browser.multiCookies()).toHaveLength(2);
    });

    it("needs a session to remember one", async () => {
        const response = await new Browser(auth).send("/device-sessions/remember", {
            method: "POST",
            body: {},
        });
        expect(response.status).toBe(401);
    });

    it(`holds at most ${MAX_DEVICE_ACCOUNTS} accounts`, async () => {
        const browser = new Browser(auth);
        const emails: string[] = [];
        for (let i = 0; i < MAX_DEVICE_ACCOUNTS + 1; i++) emails.push(await newAccount());
        const cookies = () => [...browser.jar].map(([name, value]) => ({ name, value }));

        for (const email of emails.slice(0, -1)) {
            // The server-side gate agrees with the plugin: room until the limit.
            expect(isAtAccountLimit(cookies())).toBe(false);
            await browser.signIn(email);
        }
        expect(isAtAccountLimit(cookies())).toBe(true);

        // Which is why the add-account pages refuse here: the one past the
        // limit is signed in and active, but not remembered.
        await browser.signIn(emails.at(-1)!);
        expect(await browser.who()).toBe(emails.at(-1));
        expect(browser.multiCookies()).toHaveLength(MAX_DEVICE_ACCOUNTS);
    });
});
