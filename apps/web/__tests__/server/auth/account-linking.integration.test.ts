/**
 * Google and GitHub sign-in on an address that already has an account, end to
 * end through Better Auth's real endpoints (the app's own auth instance)
 * against a migrated throwaway database. Only the providers' servers are
 * faked: Google's token endpoint and GitHub's token and user APIs.
 *
 * See ~/server/auth/account-linking for the rule under test.
 */
import { and, eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import {
    authAccount,
    authOauthClient,
    authOauthConsent,
    authUser,
    mcpAccessKeys,
    users,
} from "~/server/db/schema";
import type { auth as Auth } from "~/server/auth";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const BASE = "http://localhost:3999";
const GOOGLE_CLIENT_ID = "test-google-client";
const PASSWORD = "correct horse battery";

interface Profile {
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string;
}

/** What the fake providers answer with on the next token exchange. */
let googleProfile: Profile | null = null;
let githubProfile: Profile | null = null;

function unsignedJwt(claims: Record<string, unknown>): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

function fakeProviderResponse(url: string): Response | null {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
        if (!googleProfile) throw new Error("no Google profile staged");
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
            access_token: "google-access",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
            id_token: unsignedJwt({
                iss: "https://accounts.google.com",
                aud: GOOGLE_CLIENT_ID,
                iat: now,
                exp: now + 3600,
                sub: googleProfile.sub,
                email: googleProfile.email,
                email_verified: googleProfile.emailVerified,
                name: googleProfile.name ?? "Google Person",
            }),
        });
    }
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return Response.json({
            access_token: "github-access",
            token_type: "bearer",
            scope: "read:user,user:email",
        });
    }
    if (url.startsWith("https://api.github.com/user/emails")) {
        if (!githubProfile) throw new Error("no GitHub profile staged");
        return Response.json([
            { email: githubProfile.email, primary: true, verified: githubProfile.emailVerified },
        ]);
    }
    if (url.startsWith("https://api.github.com/user")) {
        if (!githubProfile) throw new Error("no GitHub profile staged");
        return Response.json({
            id: Number(githubProfile.sub),
            login: "octo",
            name: githubProfile.name ?? "GitHub Person",
            email: githubProfile.email,
            avatar_url: null,
        });
    }
    return null;
}

/** The takeover notice cookie as the browser would read it. */
function notice(browser: Browser): string | null {
    const raw = browser.jar.get("ls_signin_notice");
    return raw === undefined ? null : decodeURIComponent(raw);
}

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

    async session(): Promise<{
        user: { id: string; email: string; emailVerified: boolean };
    } | null> {
        // Past the signed cookie cache: the database is what a revoked session loses.
        const response = await this.send("/get-session?disableCookieCache=true");
        return (await response.json()) as never;
    }
}

describeIfDatabase("social sign-in on an existing address", () => {
    jest.setTimeout(120_000);

    let testDb: FounderWeeklyReviewTestDatabase;
    let auth: typeof Auth;
    let fetchSpy: jest.SpyInstance;
    const quiet: jest.SpyInstance[] = [];
    let counter = 0;

    const freshEmail = () => `person${++counter}-${Date.now()}@example.com`;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        const url = new URL(
            (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)!
        );
        url.pathname = `/${testDb.databaseName}`;
        process.env.DATABASE_URL = url.toString();
        process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
        process.env.BETTER_AUTH_URL = BASE;
        process.env.AUTH_GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
        process.env.AUTH_GOOGLE_CLIENT_SECRET = "test-google-secret";
        process.env.AUTH_GITHUB_CLIENT_ID = "test-github-client";
        process.env.AUTH_GITHUB_CLIENT_SECRET = "test-github-secret";

        const realFetch = globalThis.fetch;
        fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url =
                    typeof input === "string"
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;
                return fakeProviderResponse(url) ?? realFetch(input, init);
            });

        // Better Auth logs every refusal these tests provoke on purpose.
        quiet.push(jest.spyOn(console, "warn").mockImplementation(() => undefined));
        quiet.push(jest.spyOn(console, "error").mockImplementation(() => undefined));

        ({ auth } = await import("~/server/auth"));
    });

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        fetchSpy?.mockRestore();
        await testDb?.close();
    });

    beforeEach(() => {
        googleProfile = null;
        githubProfile = null;
    });

    async function signUp(email: string): Promise<{ browser: Browser; userId: string }> {
        const browser = new Browser(auth);
        const response = await browser.send("/sign-up/email", {
            body: { email, password: PASSWORD, name: "Password Person" },
        });
        expect(response.status).toBe(200);
        const session = await browser.session();
        expect(session?.user.emailVerified).toBe(false);
        return { browser, userId: session!.user.id };
    }

    async function passwordWorks(email: string): Promise<boolean> {
        const response = await new Browser(auth).send("/sign-in/email", {
            body: { email, password: PASSWORD },
        });
        return response.status === 200;
    }

    async function providerSignIn(
        browser: Browser,
        provider: "google" | "github",
        mode: "sign-in" | "link" = "sign-in"
    ): Promise<Response> {
        const start =
            mode === "link"
                ? await browser.send("/link-social", {
                      body: {
                          provider,
                          callbackURL: "/employer/settings#account",
                          errorCallbackURL: "/employer/settings#account",
                      },
                  })
                : await browser.send("/sign-in/social", {
                      body: {
                          provider,
                          callbackURL: "/employer/documents",
                          newUserCallbackURL: "/signup",
                          errorCallbackURL: `/signin?provider=${provider}`,
                      },
                  });
        expect(start.status).toBe(200);
        const { url } = (await start.json()) as { url: string };
        const state = new URL(url).searchParams.get("state");
        expect(state).toBeTruthy();
        return browser.send(`/callback/${provider}?code=fake-code&state=${state}`);
    }

    async function providersOf(userId: string): Promise<string[]> {
        const rows = await testDb.db
            .select({ providerId: authAccount.providerId })
            .from(authAccount)
            .where(eq(authAccount.userId, userId));
        return rows.map(row => row.providerId).sort();
    }

    async function emailVerified(userId: string): Promise<boolean> {
        const [row] = await testDb.db
            .select({ emailVerified: authUser.emailVerified })
            .from(authUser)
            .where(eq(authUser.id, userId));
        return Boolean(row?.emailVerified);
    }

    it("lets Google take over an account whose address was never confirmed", async () => {
        const email = freshEmail();
        const { browser: earlier, userId } = await signUp(email);
        expect(await passwordWorks(email)).toBe(true);

        googleProfile = { sub: `g-${userId}`, email, emailVerified: true };
        const browser = new Browser(auth);
        const callback = await providerSignIn(browser, "google");

        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe("/employer/documents");
        expect(notice(browser)).toBe("google:credential");

        const session = await browser.session();
        expect(session?.user.id).toBe(userId);
        expect(session?.user.emailVerified).toBe(true);
        expect(await emailVerified(userId)).toBe(true);
        expect(await providersOf(userId)).toEqual(["google"]);

        // Whoever held the password before is out: it no longer signs in, and
        // the session it had is gone.
        expect(await passwordWorks(email)).toBe(false);
        expect(await earlier.session()).toBeNull();

        // The next Google sign-in is an ordinary one.
        const again = new Browser(auth);
        const second = await providerSignIn(again, "google");
        expect(second.headers.get("location")).toBe("/employer/documents");
        expect(again.jar.has("ls_signin_notice")).toBe(false);
        expect((await again.session())?.user.id).toBe(userId);
    });

    it("revokes assistant connections and access keys made before the takeover", async () => {
        const email = freshEmail();
        const { userId } = await signUp(email);

        const [workspace] = await testDb.db
            .insert(company)
            .values({ name: "Takeover Co", numberOfEmployees: "1" })
            .returning();
        const [person] = await testDb.db
            .insert(users)
            .values({ name: "Password Person", email, userId, companyId: BigInt(workspace!.id) })
            .returning();
        await testDb.db.insert(authOauthClient).values({
            id: "client-row",
            clientId: "assistant-client",
            redirectUris: ["https://assistant.example/callback"],
        });
        await testDb.db.insert(authOauthConsent).values({
            id: "consent-row",
            clientId: "assistant-client",
            userId,
            referenceId: String(workspace!.id),
            scopes: ["launchstack:read"],
        });
        await testDb.db.insert(mcpAccessKeys).values({
            companyId: BigInt(workspace!.id),
            userId: BigInt(person!.id),
            name: "script",
            displayPrefix: "lsk_test",
            secretHash: "a".repeat(64),
            scopes: ["launchstack:read"],
        });

        googleProfile = { sub: `g-${userId}`, email, emailVerified: true };
        const callback = await providerSignIn(new Browser(auth), "google");
        expect(callback.headers.get("location")).toBe("/employer/documents");

        const consents = await testDb.db
            .select()
            .from(authOauthConsent)
            .where(eq(authOauthConsent.userId, userId));
        expect(consents).toHaveLength(0);
        const [key] = await testDb.db
            .select({ revokedAt: mcpAccessKeys.revokedAt })
            .from(mcpAccessKeys)
            .where(eq(mcpAccessKeys.userId, BigInt(person!.id)));
        expect(key?.revokedAt).toBeInstanceOf(Date);
    });

    it("removes a provider that was linked while the address was unconfirmed", async () => {
        const email = freshEmail();
        // GitHub sign-up whose primary address GitHub has not verified.
        githubProfile = { sub: String(1000 + counter), email, emailVerified: false };
        const viaGithub = new Browser(auth);
        const signUpCallback = await providerSignIn(viaGithub, "github");
        expect(signUpCallback.status).toBe(302);
        const userId = (await viaGithub.session())!.user.id;
        expect(await emailVerified(userId)).toBe(false);
        expect(await providersOf(userId)).toEqual(["github"]);

        googleProfile = { sub: `g-${userId}`, email, emailVerified: true };
        const browser = new Browser(auth);
        await providerSignIn(browser, "google");

        expect(notice(browser)).toBe("google:github");
        expect(await providersOf(userId)).toEqual(["google"]);
        expect(await viaGithub.session()).toBeNull();
    });

    it("lets GitHub take over too when it confirms the address", async () => {
        const email = freshEmail();
        const { userId } = await signUp(email);

        githubProfile = { sub: String(2000 + counter), email, emailVerified: true };
        const browser = new Browser(auth);
        const callback = await providerSignIn(browser, "github");

        expect(callback.headers.get("location")).toBe("/employer/documents");
        expect(notice(browser)).toBe("github:credential");
        expect(await providersOf(userId)).toEqual(["github"]);
        expect(await passwordWorks(email)).toBe(false);
    });

    it("links Google to a confirmed account and keeps the password", async () => {
        const email = freshEmail();
        const { browser: earlier, userId } = await signUp(email);
        await testDb.db
            .update(authUser)
            .set({ emailVerified: true })
            .where(eq(authUser.id, userId));

        googleProfile = { sub: `g-${userId}`, email, emailVerified: true };
        const browser = new Browser(auth);
        const callback = await providerSignIn(browser, "google");

        expect(callback.headers.get("location")).toBe("/employer/documents");
        expect(browser.jar.has("ls_signin_notice")).toBe(false);
        expect(await providersOf(userId)).toEqual(["credential", "google"]);
        expect(await passwordWorks(email)).toBe(true);
        expect((await earlier.session())?.user.id).toBe(userId);
    });

    it("connects Google from Settings, keeps the password and confirms the address", async () => {
        const email = freshEmail();
        const { browser, userId } = await signUp(email);

        googleProfile = { sub: `g-${userId}`, email, emailVerified: true };
        const callback = await providerSignIn(browser, "google", "link");

        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe("/employer/settings#account");
        expect(browser.jar.has("ls_signin_notice")).toBe(false);
        expect(await providersOf(userId)).toEqual(["credential", "google"]);
        expect(await emailVerified(userId)).toBe(true);
        expect(await passwordWorks(email)).toBe(true);
        expect((await browser.session())?.user.id).toBe(userId);
    });

    it("refuses to connect a Google account with a different address", async () => {
        const email = freshEmail();
        const { browser, userId } = await signUp(email);

        googleProfile = { sub: `g-${userId}`, email: `other-${email}`, emailVerified: true };
        const callback = await providerSignIn(browser, "google", "link");

        const location = new URL(callback.headers.get("location")!, BASE);
        expect(location.pathname).toBe("/employer/settings");
        expect(location.searchParams.get("error")).toBe("email_does_not_match");
        expect(location.hash).toBe("#account");
        expect(await providersOf(userId)).toEqual(["credential"]);
        expect(await emailVerified(userId)).toBe(false);
    });

    it("refuses a provider that has not confirmed the address", async () => {
        const email = freshEmail();
        const { browser: earlier, userId } = await signUp(email);

        googleProfile = { sub: `g-${userId}`, email, emailVerified: false };
        const browser = new Browser(auth);
        const callback = await providerSignIn(browser, "google");

        const location = new URL(callback.headers.get("location")!, BASE);
        expect(location.pathname).toBe("/signin");
        expect(location.searchParams.get("error")).toBe("account_not_linked");
        expect(browser.jar.has("ls_signin_notice")).toBe(false);
        expect(await providersOf(userId)).toEqual(["credential"]);
        expect(await passwordWorks(email)).toBe(true);
        expect((await earlier.session())?.user.id).toBe(userId);
    });

    it("signs up a new address with Google as before", async () => {
        const email = freshEmail();
        googleProfile = { sub: `g-new-${counter}`, email, emailVerified: true };
        const browser = new Browser(auth);
        const callback = await providerSignIn(browser, "google");

        expect(callback.headers.get("location")).toBe("/signup");
        expect(browser.jar.has("ls_signin_notice")).toBe(false);
        const session = await browser.session();
        expect(session?.user.email).toBe(email);
        expect(await providersOf(session!.user.id)).toEqual(["google"]);
        const rows = await testDb.db
            .select()
            .from(authAccount)
            .where(
                and(eq(authAccount.userId, session!.user.id), eq(authAccount.providerId, "google"))
            );
        expect(rows).toHaveLength(1);
    });
});
