import { expect, test } from "@playwright/test";

/** Real tab controls and pane hosts, using the session-free development page. */
test("opening a pane survives restored focus and clicks on the tab header", async ({ page }) => {
    await page.goto("/dev/studio-tabs");
    const previous = page.getByRole("tab", { name: "Chat", exact: true });
    await previous.click();

    // The toolbar opens a tab programmatically, just as note creation does.
    await page.getByRole("button", { name: "Knowledge", exact: true }).first().click();
    const current = page.getByRole("tab", { name: "Knowledge", exact: true });
    await expect(current).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();

    // A browser or closing menu can return focus to the last tab trigger.
    // Focus alone must never undo the more recent choice of what to show.
    await previous.focus();
    await expect(current).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();

    await current.click();
    await page.locator("[data-studio-tab-strip]").click({ position: { x: 1, y: 1 } });
    await expect(current).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();

    // A deliberate click or keyboard activation still changes the pane.
    await previous.click();
    await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(current).toBeFocused();
    await expect(previous).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(current).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
});
