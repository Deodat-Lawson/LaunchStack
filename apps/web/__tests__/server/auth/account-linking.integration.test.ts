/**
 * Provider sign-in (Google, GitHub, Microsoft, the deployment's own OIDC) on
 * an address that already has an account, end to end through Better Auth's
 * real endpoints (the app's own auth instance) against a migrated throwaway
 * database. Only the providers' servers are faked: Google's and Microsoft's
 * token endpoints, GitHub's token and user APIs, and an OIDC issuer's
 * discovery document, keys and token endpoint (its ID tokens are really
 * signed, because Better Auth checks them against the issuer's keys).
 *
 * See ~/server/auth/account-linking for the rule under test.
 */
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";
import {
    authAccount,
    authOauthAccessToken,
    authOauthClient,
    authOauthConsent,
    authOauthRefreshToken,
    authUser,
    mcpAccessKeys,
    users,
} from "~/server/db/schema";
import type { auth as Auth } from "~/server/auth";
import { parseTakeoverNoticeMethods } from "~/lib/auth/takeover-notice";

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
const MICROSOFT_CLIENT_ID = "test-microsoft-client";
const MICROSOFT = "https://login.microsoftonline.com";
const MICROSOFT_TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OIDC_ISSUER = "https://id.example.test/realms/acme";
const OIDC_CLIENT_ID = "test-oidc-client";
const OIDC_NAME = "Acme SSO";
const OIDC_KID = "acme-signing-key";
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
/**
 * Microsoft confirms an address only through the verified_primary_email
 * optional claim; `emailVerified` stages it.
 */
let microsoftProfile: Profile | null = null;
/** `forge` signs with a key the issuer never published; `nonce` overrides the bound one. */
let oidcProfile: (Profile & { forge?: boolean; nonce?: string }) | null = null;
/** The nonce Better Auth put in the last authorization URL, as the IdP would echo it. */
let lastNonce: string | null = null;

const issuerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });

function unsignedJwt(claims: Record<string, unknown>): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

function signedJwt(claims: Record<string, unknown>, key: KeyObject): string {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const data = `${part({ alg: "RS256", typ: "JWT", kid: OIDC_KID })}.${part(claims)}`;
    const signature = createSign("RSA-SHA256").update(data).sign(key).toString("base64url");
    return `${data}.${signature}`;
}

function fakeProviderResponse(url: string): Response | null {
    if (url === `${OIDC_ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
            issuer: OIDC_ISSUER,
            authorization_endpoint: `${OIDC_ISSUER}/protocol/openid-connect/auth`,
            token_endpoint: `${OIDC_ISSUER}/protocol/openid-connect/token`,
            userinfo_endpoint: `${OIDC_ISSUER}/protocol/openid-connect/userinfo`,
            jwks_uri: `${OIDC_ISSUER}/protocol/openid-connect/certs`,
            id_token_signing_alg_values_supported: ["RS256"],
        });
    }
    if (url === `${OIDC_ISSUER}/protocol/openid-connect/certs`) {
        const jwk = issuerKey.publicKey.export({ format: "jwk" });
        return Response.json({ keys: [{ ...jwk, kid: OIDC_KID, alg: "RS256", use: "sig" }] });
    }
    if (url === `${OIDC_ISSUER}/protocol/openid-connect/token`) {
        if (!oidcProfile) throw new Error("no OIDC profile staged");
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
            access_token: "oidc-access",
            token_type: "Bearer",
            expires_in: 300,
            id_token: signedJwt(
                {
                    iss: OIDC_ISSUER,
                    aud: OIDC_CLIENT_ID,
                    iat: now,
                    exp: now + 300,
                    nonce: oidcProfile.nonce ?? lastNonce,
                    sub: oidcProfile.sub,
                    email: oidcProfile.email,
                    email_verified: oidcProfile.emailVerified,
                    name: oidcProfile.name ?? "Acme Person",
                },
                oidcProfile.forge ? strangerKey.privateKey : issuerKey.privateKey
            ),
        });
    }
    if (url.startsWith(`${MICROSOFT}/common/oauth2/v2.0/token`)) {
        if (!microsoftProfile) throw new Error("no Microsoft profile staged");
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
            access_token: "microsoft-access",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid profile email",
            id_token: unsignedJwt({
                iss: `${MICROSOFT}/${MICROSOFT_TENANT}/v2.0`,
                aud: MICROSOFT_CLIENT_ID,
                tid: MICROSOFT_TENANT,
                oid: microsoftProfile.sub,
                iat: now,
                exp: now + 3600,
                email: microsoftProfile.email,
                name: microsoftProfile.name ?? "Microsoft Person",
                ...(microsoftProfile.emailVerified
                    ? { verified_primary_email: [microsoftProfile.email] }
                    : {}),
            }),
        });
    }
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
        // As the app reads it (middleware, route handlers): no cache to bypass.
        const response = await this.send("/get-session");
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
        process.env.AUTH_MICROSOFT_CLIENT_ID = MICROSOFT_CLIENT_ID;
        process.env.AUTH_MICROSOFT_CLIENT_SECRET = "test-microsoft-secret";
        process.env.AUTH_OIDC_ISSUER = OIDC_ISSUER;
        process.env.AUTH_OIDC_CLIENT_ID = OIDC_CLIENT_ID;
        process.env.AUTH_OIDC_CLIENT_SECRET = "test-oidc-secret";
        process.env.AUTH_OIDC_NAME = OIDC_NAME;

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
        microsoftProfile = null;
        oidcProfile = null;
        lastNonce = null;
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

    /** The authorization URL the last providerSignIn sent the browser to. */
    let lastAuthorizationUrl: URL | null = null;

    async function providerSignIn(
        browser: Browser,
        provider: "google" | "github" | "microsoft" | "oidc",
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
        lastAuthorizationUrl = new URL(url);
        lastNonce = lastAuthorizationUrl.searchParams.get("nonce");
        const state = lastAuthorizationUrl.searchParams.get("state");
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
        // the session it had is refused on its very next request, so there is
        // no window in which to mint access that outlives it.
        expect(await passwordWorks(email)).toBe(false);
        expect(await earlier.session()).toBeNull();
        expect((await earlier.send("/list-accounts")).status).toBe(401);

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
        await testDb.db.insert(authOauthRefreshToken).values({
            id: "refresh-row",
            token: "refresh-token",
            clientId: "assistant-client",
            userId,
            referenceId: String(workspace!.id),
            scopes: ["launchstack:read"],
        });
        await testDb.db.insert(authOauthAccessToken).values({
            id: "access-row",
            token: "access-token",
            clientId: "assistant-client",
            userId,
            referenceId: String(workspace!.id),
            refreshId: "refresh-row",
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
        const refreshTokens = await testDb.db
            .select()
            .from(authOauthRefreshToken)
            .where(eq(authOauthRefreshToken.userId, userId));
        const accessTokens = await testDb.db
            .select()
            .from(authOauthAccessToken)
            .where(eq(authOauthAccessToken.userId, userId));
        expect(refreshTokens).toHaveLength(0);
        expect(accessTokens).toHaveLength(0);
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

    it("refuses to connect a Google account that has not confirmed the address", async () => {
        const email = freshEmail();
        const { browser, userId } = await signUp(email);

        googleProfile = { sub: `g-${userId}`, email, emailVerified: false };
        const callback = await providerSignIn(browser, "google", "link");

        const location = new URL(callback.headers.get("location")!, BASE);
        expect(location.pathname).toBe("/employer/settings");
        expect(location.searchParams.get("error")).toBe("unable_to_link_account");
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

    describe("the deployment's own OIDC provider", () => {
        it("takes over an unconfirmed account and is named in the notice", async () => {
            const email = freshEmail();
            const { browser: earlier, userId } = await signUp(email);

            oidcProfile = { sub: `acme-${userId}`, email, emailVerified: true };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "oidc");

            // Discovery found the issuer's own authorization endpoint, with PKCE
            // and a nonce bound to this sign-in.
            expect(lastAuthorizationUrl?.origin + lastAuthorizationUrl!.pathname).toBe(
                `${OIDC_ISSUER}/protocol/openid-connect/auth`
            );
            expect(lastAuthorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
            expect(lastNonce).toBeTruthy();

            expect(callback.headers.get("location")).toBe("/employer/documents");
            expect(parseTakeoverNoticeMethods(browser.jar.get("ls_signin_notice"))).toEqual({
                provider: OIDC_NAME,
                removed: ["credential"],
            });
            expect(browser.jar.get("better-auth.last_used_login_method")).toBe("oidc");
            expect((await browser.session())?.user.id).toBe(userId);
            expect(await providersOf(userId)).toEqual(["oidc"]);
            expect(await passwordWorks(email)).toBe(false);
            expect(await earlier.session()).toBeNull();
        });

        it("refuses an ID token the issuer did not sign", async () => {
            const email = freshEmail();
            const { userId } = await signUp(email);

            oidcProfile = { sub: `acme-${userId}`, email, emailVerified: true, forge: true };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "oidc");

            const location = new URL(callback.headers.get("location")!, BASE);
            expect(location.pathname).toBe("/signin");
            expect(location.searchParams.get("error")).toBe("unable_to_get_user_info");
            expect(await browser.session()).toBeNull();
            expect(await providersOf(userId)).toEqual(["credential"]);
            expect(await passwordWorks(email)).toBe(true);
        });

        it("refuses an ID token minted for a different sign-in", async () => {
            const email = freshEmail();
            oidcProfile = {
                sub: `acme-replay-${counter}`,
                email,
                emailVerified: true,
                nonce: "nonce-from-another-sign-in",
            };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "oidc");

            const location = new URL(callback.headers.get("location")!, BASE);
            expect(location.pathname).toBe("/signin");
            expect(location.searchParams.get("error")).toBe("unable_to_get_user_info");
            expect(await browser.session()).toBeNull();
        });

        it("can't join an existing account when the IdP hasn't confirmed the address", async () => {
            const email = freshEmail();
            const { userId } = await signUp(email);

            oidcProfile = { sub: `acme-${userId}`, email, emailVerified: false };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "oidc");

            const location = new URL(callback.headers.get("location")!, BASE);
            expect(location.searchParams.get("error")).toBe("account_not_linked");
            expect(location.searchParams.get("provider")).toBe("oidc");
            expect(await providersOf(userId)).toEqual(["credential"]);
            expect(await passwordWorks(email)).toBe(true);
        });

        it("connects from Settings and keeps the password", async () => {
            const email = freshEmail();
            const { browser, userId } = await signUp(email);

            oidcProfile = { sub: `acme-${userId}`, email, emailVerified: true };
            const callback = await providerSignIn(browser, "oidc", "link");

            expect(callback.headers.get("location")).toBe("/employer/settings#account");
            expect(browser.jar.has("ls_signin_notice")).toBe(false);
            expect(await providersOf(userId)).toEqual(["credential", "oidc"]);
            expect(await emailVerified(userId)).toBe(true);
            expect(await passwordWorks(email)).toBe(true);

            // Settings › Account unlinks by Better Auth's row id, which
            // list-accounts returns as `id`; the provider's subject
            // (`accountId`) is not what unlink-account looks up.
            const listed = (await (await browser.send("/list-accounts")).json()) as {
                id: string;
                providerId: string;
                accountId: string;
            }[];
            const linked = listed.find(account => account.providerId === "oidc")!;
            const bySubject = await browser.send("/unlink-account", {
                body: { accountId: linked.accountId },
            });
            expect(bySubject.status).toBe(400);
            const byRow = await browser.send("/unlink-account", { body: { accountId: linked.id } });
            expect(byRow.status).toBe(200);
            expect(await providersOf(userId)).toEqual(["credential"]);
        });
    });

    describe("Microsoft", () => {
        it("signs up a new address asking only who the person is", async () => {
            const email = freshEmail();
            microsoftProfile = { sub: `ms-new-${counter}`, email, emailVerified: true };
            fetchSpy.mockClear();
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "microsoft");

            expect(lastAuthorizationUrl?.origin).toBe(MICROSOFT);
            expect(lastAuthorizationUrl?.pathname).toBe("/common/oauth2/v2.0/authorize");
            expect(lastAuthorizationUrl?.searchParams.get("scope")?.split(" ").sort()).toEqual([
                "email",
                "openid",
                "profile",
            ]);
            // No Graph call: the profile photo is off.
            const graphCalls = fetchSpy.mock.calls.filter(([input]) =>
                String(input instanceof Request ? input.url : input).includes("graph.microsoft.com")
            );
            expect(graphCalls).toHaveLength(0);

            expect(callback.headers.get("location")).toBe("/signup");
            const session = await browser.session();
            expect(session?.user.email).toBe(email);
            expect(session?.user.emailVerified).toBe(true);
            expect(await providersOf(session!.user.id)).toEqual(["microsoft"]);
            expect(browser.jar.get("better-auth.last_used_login_method")).toBe("microsoft");
        });

        it("takes over an unconfirmed account when Microsoft confirms the address", async () => {
            const email = freshEmail();
            const { userId } = await signUp(email);

            microsoftProfile = { sub: `ms-${userId}`, email, emailVerified: true };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "microsoft");

            expect(callback.headers.get("location")).toBe("/employer/documents");
            expect(notice(browser)).toBe("microsoft:credential");
            expect(parseTakeoverNoticeMethods(browser.jar.get("ls_signin_notice"))?.provider).toBe(
                "Microsoft"
            );
            expect(await providersOf(userId)).toEqual(["microsoft"]);
            expect(await passwordWorks(email)).toBe(false);
        });

        it("can't join an existing account without the verified-email claim", async () => {
            const email = freshEmail();
            const { browser: earlier, userId } = await signUp(email);

            microsoftProfile = { sub: `ms-${userId}`, email, emailVerified: false };
            const browser = new Browser(auth);
            const callback = await providerSignIn(browser, "microsoft");

            const location = new URL(callback.headers.get("location")!, BASE);
            expect(location.pathname).toBe("/signin");
            expect(location.searchParams.get("error")).toBe("account_not_linked");
            expect(await providersOf(userId)).toEqual(["credential"]);
            expect(await passwordWorks(email)).toBe(true);
            expect((await earlier.session())?.user.id).toBe(userId);
        });
    });
});
