import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

/**
 * A mindmap is a source: create → edit → back → preview → library, all inside
 * the Documents workspace, with the browser's own back button walking the
 * same path. Each test gets a fresh account and workspace so nothing depends
 * on the database's prior state and nothing leaks between runs.
 */

/**
 * A throwaway credential per run, generated rather than written down. The
 * account exists only for the length of one test against a local server, so
 * the value carries no meaning — and a literal here would be a hardcoded
 * password for every secret scanner that reads the repository.
 */
function throwawayPassword(): string {
    return `E2e-${randomBytes(18).toString("base64url")}!`;
}

async function signUpWithWorkspace(page: Page): Promise<{ email: string; workspace: string }> {
    const stamp = randomUUID().replace(/-/g, "").slice(0, 12);
    const email = `mindmap-e2e-${stamp}@example.test`;
    const workspace = `Mindmap E2E ${stamp}`;

    // Better Auth's email sign-up sets the session cookie on this page's
    // context; the workspace route then hangs a company off that identity.
    const signup = await page.request.post("/api/auth/sign-up/email", {
        data: { name: "Mindmap E2E", email, password: throwawayPassword() },
    });
    expect(signup.ok(), `sign-up failed: ${signup.status()} ${await signup.text()}`).toBe(true);

    const company = await page.request.post("/api/signup/employerCompany", {
        data: { companyName: workspace, name: "Mindmap E2E", email, numberOfEmployees: "1" },
    });
    expect(company.ok(), `workspace failed: ${company.status()} ${await company.text()}`).toBe(
        true
    );
    return { email, workspace };
}

/** The `m<id>` source id from the URL the workspace puts a map under. */
function sourceIdFromUrl(url: string): string {
    const value = new URL(url).searchParams.get("source");
    if (!value) throw new Error(`no ?source= in ${url}`);
    return value;
}

test.describe("mindmaps live in the Documents workspace", () => {
    test.beforeEach(async ({ page }) => {
        await signUpWithWorkspace(page);
    });

    test("create → edit in place → back → preview → library, with a working back button", async ({
        page,
    }) => {
        await page.goto("/employer/documents");
        // A dev server compiles the workspace on first visit; give the rail
        // the time that takes rather than failing on a cold start.
        await expect(page.getByPlaceholder("Search your knowledge")).toBeVisible({
            timeout: 90_000,
        });

        // Add a source → Create → Mindmap → a template.
        await page.getByTitle("Add knowledge  ⌘U").click();
        await page.getByRole("button", { name: "Mindmap", exact: true }).click();
        await expect(page.getByText("Diagram it, then cite it")).toBeVisible();
        await page.getByText("Blank canvas").click();

        // The editor opened in place: the URL names the map and the edit mode,
        // and the editor's own chrome is on screen beside the rail.
        await page.waitForURL(/\/employer\/documents\?.*source=m\d+.*edit=1/);
        const sourceId = sourceIdFromUrl(page.url());
        await expect(page.getByLabel("Mindmap title")).toBeVisible();
        await expect(page.getByPlaceholder("Search your knowledge")).toBeVisible();

        // Name it from the editor, then leave.
        const title = `Launch plan ${sourceId}`;
        await page.getByLabel("Mindmap title").fill(title);
        await page.getByLabel("Mindmap title").press("Enter");
        await page.getByRole("button", { name: "Back", exact: true }).click();

        // Back lands on the preview, not on a gallery.
        await page.waitForURL(url => {
            const params = new URL(url).searchParams;
            return params.get("source") === sourceId && params.get("edit") === null;
        });
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await expect(page.getByTestId("viewer-edit-mindmap")).toBeVisible();
        await expect(page.getByRole("button", { name: "Make citable" })).toBeVisible();

        // Edit goes back in; the browser's back button comes out again.
        await page.getByTestId("viewer-edit-mindmap").click();
        await page.waitForURL(/edit=1/);
        await expect(page.getByLabel("Mindmap title")).toBeVisible();
        await page.goBack();
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();

        // Close the preview: the library, with the map in the rail under its
        // new name.
        await page.getByRole("button", { name: "Library" }).click();
        await page.waitForURL(url => new URL(url).searchParams.get("source") === null);
        const row = page.getByTestId(`source-row-${sourceId}`);
        await expect(row).toBeVisible();
        await expect(row).toContainText(title);

        // ⌘K finds it like any other source.
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByPlaceholder("Jump to anything — sources, features, actions…").fill(title);
        await expect(page.getByText(title).first()).toBeVisible();
        await page.keyboard.press("Escape");

        // The rail reopens the preview; a deep link survives a reload.
        await row.getByTitle("Open").click();
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await page.reload();
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
    });

    test("the old editor address redirects into the workspace", async ({ page }) => {
        await page.goto("/employer/documents");
        await page.getByTitle("Add knowledge  ⌘U").click();
        await page.getByRole("button", { name: "Mindmap", exact: true }).click();
        await page.getByText("Blank canvas").click();
        await page.waitForURL(/source=m\d+/);
        const sourceId = sourceIdFromUrl(page.url());
        const numericId = sourceId.slice(1);

        await page.goto(`/employer/mindmap/${numericId}`);
        await page.waitForURL(url => {
            const params = new URL(url).searchParams;
            return (
                new URL(url).pathname === "/employer/documents" &&
                params.get("source") === sourceId &&
                params.get("edit") === "1"
            );
        });
        await expect(page.getByLabel("Mindmap title")).toBeVisible();
    });

    test("the gallery is gone", async ({ page }) => {
        const response = await page.goto("/employer/mindmap");
        expect(response?.status()).toBe(404);
    });
});
