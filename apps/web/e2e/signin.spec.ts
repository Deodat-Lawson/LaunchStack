import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

/**
 * The sign-in screen, end to end: credentials, the deep-link return, the
 * reset-link request, the social buttons, and the ways each can fail.
 *
 * Every test makes its own throwaway account and workspace through the API,
 * then drops the session so it starts signed out. Social sign-in is checked
 * up to the provider's consent screen (stubbed — no request leaves the
 * machine) and is skipped when the server has no provider credentials.
 *
 * Needs a running server with a database behind it — see playwright.config.ts.
 */

type Account = { email: string; password: string };

function throwawayPassword(): string {
    return `E2e-${randomBytes(18).toString("base64url")}!`;
}

async function createAccount(page: Page): Promise<Account> {
    const stamp = randomUUID().replace(/-/g, "").slice(0, 12);
    const account = { email: `signin-${stamp}@example.test`, password: throwawayPassword() };
    const signup = await page.request.post("/api/auth/sign-up/email", {
        data: { name: "Sign In", ...account },
    });
    expect(signup.ok(), `sign-up failed: ${signup.status()} ${await signup.text()}`).toBe(true);
    const company = await page.request.post("/api/signup/employerCompany", {
        data: {
            companyName: `Sign In ${stamp}`,
            name: "Sign In",
            email: account.email,
            numberOfEmployees: "1",
        },
    });
    expect(company.ok(), `workspace failed: ${company.status()} ${await company.text()}`).toBe(
        true
    );
    // Start every test signed out, with no "last used" memory either.
    await page.context().clearCookies();
    return account;
}

async function fillCredentials(page: Page, { email, password }: Account) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
}

const signInButton = (page: Page) => page.getByRole("button", { name: "Sign in", exact: true });

/** The page's own alerts — not Next's route announcer, which is role="alert" too. */
const alertOn = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

test.describe("sign-in", () => {
    let account: Account;

    test.beforeEach(async ({ page }) => {
        account = await createAccount(page);
    });

    test("signs in, lands on the dashboard, and remembers the method", async ({ page }) => {
        await page.goto("/signin");
        // The cursor starts in the email field.
        await expect(page.getByLabel("Email")).toBeFocused();

        await fillCredentials(page, account);
        await signInButton(page).click();
        await page.waitForURL(/\/employer\/documents/);

        const cookies = await page.context().cookies();
        expect(cookies.find(c => c.name.endsWith("last_used_login_method"))?.value).toBe("email");
        // "Keep me signed in" is on by default: the session outlives the browser.
        const session = cookies.find(c => c.name.endsWith("session_token"));
        expect(session?.expires).toBeGreaterThan(Date.now() / 1000 + 60 * 60 * 24);

        // Back on the sign-in screen after signing out, the email route is
        // marked — when there are other routes to tell it apart from.
        const signOut = await page.request.post("/api/auth/sign-out", {
            headers: { origin: new URL(page.url()).origin },
            // better-auth refuses a POST without a JSON content type.
            data: {},
        });
        expect(signOut.ok()).toBe(true);
        await page.goto("/signin");
        if ((await page.getByRole("button", { name: /^Continue with/ }).count()) > 0) {
            await expect(page.getByText("Last used")).toBeVisible();
        }
    });

    test("without 'Keep me signed in' the session ends with the browser", async ({ page }) => {
        await page.goto("/signin");
        await fillCredentials(page, account);
        await page.getByLabel("Keep me signed in").uncheck();
        await signInButton(page).click();
        await page.waitForURL(/\/employer\/documents/);

        const session = (await page.context().cookies()).find(c =>
            c.name.endsWith("session_token")
        );
        expect(session, "no session cookie").toBeDefined();
        expect(session?.expires).toBe(-1);
    });

    test("returns to the page that was asked for", async ({ page }) => {
        await page.goto("/employer/documents?panel=sources");
        await page.waitForURL(/\/signin\?next=/);
        expect(new URL(page.url()).searchParams.get("next")).toBe(
            "/employer/documents?panel=sources"
        );
        await expect(
            page.getByRole("status").filter({ hasText: "Sign in to continue" })
        ).toBeVisible();

        await fillCredentials(page, account);
        await signInButton(page).click();
        await page.waitForURL(
            url =>
                url.pathname === "/employer/documents" &&
                url.searchParams.get("panel") === "sources"
        );
    });

    test("a wrong password keeps the email, and the error clears on edit", async ({ page }) => {
        await page.goto("/signin");
        await fillCredentials(page, { ...account, password: "not-the-password" });
        await signInButton(page).click();

        const alert = alertOn(page);
        await expect(alert).toHaveText(
            "That email and password don't match. Check both and try again."
        );
        const password = page.getByLabel("Password", { exact: true });
        await expect(password).toBeFocused();
        await expect(password).toHaveAttribute("aria-invalid", "true");
        await expect(page.getByLabel("Email")).toHaveValue(account.email);

        await password.press("x");
        await expect(alert).toHaveCount(0);
        await expect(password).not.toHaveAttribute("aria-invalid");
    });

    test("an unknown email reads exactly like a wrong password", async ({ page }) => {
        await page.goto("/signin");
        await fillCredentials(page, {
            email: `nobody-${randomUUID()}@example.test`,
            password: "x",
        });
        await signInButton(page).click();
        await expect(alertOn(page)).toHaveText(
            "That email and password don't match. Check both and try again."
        );
    });

    test("the password can be revealed, and Caps Lock is called out", async ({ page }) => {
        await page.goto("/signin");
        const password = page.getByLabel("Password", { exact: true });
        await password.fill("secret");

        await page.getByRole("button", { name: "Show password" }).click();
        await expect(password).toHaveAttribute("type", "text");
        await page.getByRole("button", { name: "Hide password" }).click();
        await expect(password).toHaveAttribute("type", "password");

        await password.focus();
        await password.evaluate(el =>
            el.dispatchEvent(
                new KeyboardEvent("keyup", { key: "A", bubbles: true, modifierCapsLock: true })
            )
        );
        await expect(page.getByText("Caps Lock is on")).toBeVisible();
        await password.blur();
        await expect(page.getByText("Caps Lock is on")).toHaveCount(0);
    });

    test("a rate-limited attempt waits out the server's retry hint", async ({ page }) => {
        await page.route("**/api/auth/sign-in/email", route =>
            route.fulfill({
                status: 429,
                headers: { "content-type": "application/json", "X-Retry-After": "3" },
                body: JSON.stringify({ message: "Too many requests. Please try again later." }),
            })
        );
        await page.goto("/signin");
        await fillCredentials(page, account);
        await signInButton(page).click();

        await expect(alertOn(page)).toHaveText("Too many attempts. Try again in 3 seconds.");
        await expect(page.getByRole("button", { name: /^Try again in \ds$/ })).toBeDisabled();
        // The lockout lifts by itself.
        await expect(signInButton(page)).toBeEnabled({ timeout: 6_000 });
        await expect(alertOn(page)).toHaveCount(0);
    });

    test("a dropped connection says so", async ({ page }) => {
        await page.route("**/api/auth/sign-in/email", route => route.abort("internetdisconnected"));
        await page.goto("/signin");
        await fillCredentials(page, account);
        await signInButton(page).click();
        await expect(alertOn(page)).toContainText("Can't reach Launchstack");
        await expect(signInButton(page)).toBeEnabled();
    });

    test("forgot password: sends a link, then throttles the resend", async ({ page }) => {
        await page.goto("/signin");
        await page.getByLabel("Email").fill(account.email);
        await page.getByRole("button", { name: "Forgot password?" }).click();

        await expect(page.getByText("Reset your password")).toBeVisible();
        // The address typed on the sign-in form carries over, and has focus.
        await expect(page.getByLabel("Email")).toHaveValue(account.email);
        await expect(page.getByLabel("Email")).toBeFocused();

        await page.getByRole("button", { name: "Email me a reset link" }).click();
        await expect(page.getByText("Check your email")).toBeVisible();
        await expect(page.getByText(account.email)).toBeVisible();
        await expect(page.getByRole("button", { name: /^Resend link in \d+s$/ })).toBeDisabled();

        await page.getByRole("button", { name: "Back to sign in" }).click();
        await expect(signInButton(page)).toBeVisible();
    });

    test("an expired reset link offers a fresh one", async ({ page }) => {
        await page.goto("/reset-password?error=INVALID_TOKEN");
        await expect(page.getByRole("heading", { name: "That link has expired." })).toBeVisible();
        await page.getByRole("link", { name: "Send a new link" }).click();
        await page.waitForURL(/\/signin/);
        await expect(page.getByText("Reset your password")).toBeVisible();
        // The one-shot `view` parameter is gone from the address bar.
        expect(new URL(page.url()).searchParams.has("view")).toBe(false);
    });

    test("signing up with a taken email points back to sign-in", async ({ page }) => {
        await page.goto("/signup");
        await page.getByLabel("Name").fill("Someone Else");
        await page.getByLabel("Email").fill(account.email);
        await page.getByLabel("Password", { exact: true }).fill(throwawayPassword());
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(alertOn(page)).toContainText("already exists");
        await page.getByRole("link", { name: "Sign in instead →" }).click();
        await page.waitForURL(/\/signin/);
    });
});

test.describe("social sign-in", () => {
    test("an OAuth failure comes back as a sentence, once", async ({ page }) => {
        await page.goto("/signin?error=access_denied&provider=github");
        await expect(alertOn(page)).toContainText("Sign-in was cancelled");
        // Dropped from the address bar, so a refresh doesn't replay it.
        await expect.poll(() => new URL(page.url()).search).toBe("");
        await page.reload();
        await expect(alertOn(page)).toHaveCount(0);
    });

    test("a broken callback lands on the sign-in page, not a bare error page", async ({ page }) => {
        await page.goto("/api/auth/callback/github?code=x&state=not-a-real-state");
        await page.waitForURL(/\/signin/);
        await expect(alertOn(page)).toContainText("sign-in");
    });

    for (const [provider, label, host] of [
        ["github", "GitHub", "github.com"],
        ["google", "Google", "accounts.google.com"],
    ] as const) {
        test(`Continue with ${label} heads to its consent screen`, async ({ page }) => {
            await page.goto("/signin?next=%2Fworkspaces");
            const button = page.getByRole("button", { name: `Continue with ${label}` });
            test.skip((await button.count()) === 0, `no ${label} credentials on this server`);

            // Never actually reach the provider.
            await page.route(`https://${host}/**`, route =>
                route.fulfill({ status: 200, contentType: "text/html", body: "consent stub" })
            );
            await button.click();
            await page.waitForURL(new RegExp(`^https://${host.replace(/\./g, "\\.")}/`));

            const authorize = new URL(page.url());
            const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3010")
                .origin;
            expect(authorize.searchParams.get("redirect_uri")).toBe(
                `${origin}/api/auth/callback/${provider}`
            );
            expect(authorize.searchParams.get("state")).toBeTruthy();
        });
    }
});
