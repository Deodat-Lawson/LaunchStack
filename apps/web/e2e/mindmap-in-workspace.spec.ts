import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

/**
 * A mindmap is a source, and everything it opens is a tab of the Documents
 * workspace: its editor is the Mindmap tab, its preview a tab named after it.
 * Create → edit → back → close → find → reopen, with the browser's own back
 * button in the mix. Each test gets a fresh account and workspace so nothing
 * depends on the database's prior state and nothing leaks between runs.
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

    test("create → edit in place → back to its tab → close → palette → rail → reload → deep link", async ({
        page,
    }) => {
        await page.goto("/employer/documents");
        // A dev server compiles the workspace on first visit; give the rail
        // the time that takes rather than failing on a cold start.
        await expect(page.getByPlaceholder("Filter sources")).toBeVisible({
            timeout: 90_000,
        });

        // Add a source → Create → Mindmap → a template.
        await page.getByRole("button", { name: /^Add knowledge/ }).click();
        await page.getByRole("button", { name: "Mindmap", exact: true }).click();
        await expect(page.getByText("Diagram it, then cite it")).toBeVisible();
        await page.getByText("Blank canvas").click();

        // The editor opens in place, as the Mindmap tab: the URL names the map
        // and the edit mode, and the rail stays beside it.
        await page.waitForURL(/\/employer\/documents\?.*source=m\d+.*edit=1/);
        const sourceId = sourceIdFromUrl(page.url());
        const editorTab = page.getByRole("tab", { name: "Mindmap", exact: true });
        await expect(editorTab).toHaveAttribute("data-state", "active");
        await expect(page.getByLabel("Mindmap title")).toBeVisible();
        await expect(page.getByPlaceholder("Filter sources")).toBeVisible();

        // Name it from the editor, then leave by its Back button.
        const title = `Launch plan ${sourceId}`;
        const mapTab = page.getByRole("tab", { name: title, exact: true });
        const row = page.getByTestId(`source-row-${sourceId}`);
        await page.getByLabel("Mindmap title").fill(title);
        await page.getByLabel("Mindmap title").press("Enter");
        await page.getByRole("button", { name: "Back", exact: true }).click();

        // Back saves first, then shows the map's preview in a tab of its own,
        // and the URL lets go of the map. The tab and the rail already carry
        // the new name — the template's first save still running is no
        // excuse to show the old one.
        await page.waitForURL(url => {
            const params = new URL(url).searchParams;
            return params.get("source") === null && params.get("edit") === null;
        });
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await expect(mapTab).toHaveAttribute("data-state", "active");
        await expect(row).toContainText(title);
        await expect(page.getByTestId("viewer-edit-mindmap")).toBeVisible();
        await expect(page.getByRole("button", { name: "Make citable" })).toBeVisible();

        // Edit goes back into the Mindmap tab. The browser's back button comes
        // out to the preview but keeps the editor open in its tab behind: a
        // stray back swipe must not throw the undo history away.
        await page.getByTestId("viewer-edit-mindmap").click();
        await page.waitForURL(/edit=1/);
        await expect(editorTab).toHaveAttribute("data-state", "active");
        await expect(page.getByLabel("Mindmap title")).toHaveValue(title);
        await page.goBack();
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await expect(mapTab).toHaveAttribute("data-state", "active");
        await expect(editorTab).toBeVisible();

        // Close the preview from its tab: the editor's tab, next in line,
        // comes forward with the map still open.
        await page.getByTitle(`Close ${title}`).click();
        await expect(page.getByTestId("mindmap-preview")).toHaveCount(0);
        await expect(editorTab).toHaveAttribute("data-state", "active");
        await expect(page.getByLabel("Mindmap title")).toHaveValue(title);

        // The focus followed the close onto the editor's tab, and the strip is
        // the workspace's: ⌘K there is the workspace palette, not the
        // editor's, and it finds the map like any other source.
        await page.keyboard.press("ControlOrMeta+k");
        const jump = page.getByPlaceholder(/^Jump to anything/);
        await jump.fill(title);
        // The palette's results sit in the same panel as its input.
        const palette = jump.locator("xpath=ancestor::div[2]");
        await expect(palette.getByText(title, { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(jump).toHaveCount(0);

        // Close the editor's tab too: it lets go of the map, nothing of it is
        // left open, and the rail still lists it under its new name.
        await page.getByTitle("Close Mindmap").click();
        await expect(editorTab).toHaveCount(0);
        await expect(page.getByLabel("Mindmap title")).toHaveCount(0);
        await expect(page.getByTestId("mindmap-preview")).toHaveCount(0);
        await expect(row).toContainText(title);

        // The rail reopens it as a tab, which survives a reload; a deep link
        // opens the same tab and drops the param.
        await row.getByTitle("Open").click();
        await expect(mapTab).toHaveAttribute("data-state", "active");
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await page.reload();
        await expect(mapTab).toHaveAttribute("data-state", "active", { timeout: 60_000 });
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await page.getByTitle(`Close ${title}`).click();
        await expect(mapTab).toHaveCount(0);
        await page.goto(`/employer/documents?source=${sourceId}`);
        await expect(mapTab).toHaveAttribute("data-state", "active");
        await expect(page.getByTestId("mindmap-preview")).toBeVisible();
        await page.waitForURL(url => new URL(url).searchParams.get("source") === null);
    });

    test("the old editor address redirects into the workspace", async ({ page }) => {
        await page.goto("/employer/documents");
        await page.getByRole("button", { name: /^Add knowledge/ }).click();
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
