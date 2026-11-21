import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "@playwright/test";

test("a new annotation and a header rerender preserve the current PDF page", async ({ page }) => {
    // Real pdf.js pages and selections; no account, uploaded file or server
    // note is created by this session-free component regression.
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let number = 1; number <= 3; number += 1) {
        pdf.addPage([600, 800]).drawText(`Annotation target on page ${number}`, {
            x: 60,
            y: 600,
            size: 18,
            font,
        });
    }
    const bytes = Buffer.from(await pdf.save());
    await page.route("**/preview-notes-regression.pdf", route =>
        route.fulfill({ contentType: "application/pdf", body: bytes })
    );
    await page.goto("/dev/pdf-viewer?url=/preview-notes-regression.pdf&width=580");

    const pageNumber = page.getByRole("textbox", { name: "Page number", exact: true });
    await expect(pageNumber).toHaveValue("1");
    await page
        .locator('[data-pdf-page="1"] .react-pdf__Page__textContent span')
        .filter({ hasText: "Annotation target on page 1" })
        .click({ clickCount: 3 });
    await page.getByRole("button", { name: "+ Note", exact: true }).click();
    await page.getByTitle("Note 1", { exact: true }).click();

    await pageNumber.fill("3");
    await pageNumber.press("Enter");
    await expect(pageNumber).toHaveValue("3");
    await page
        .locator('[data-pdf-page="3"] .react-pdf__Page__textContent span')
        .filter({ hasText: "Annotation target on page 3" })
        .click({ clickCount: 3 });
    await page.getByRole("button", { name: "+ Note", exact: true }).click();
    await expect(page.getByTestId("harness-notes")).toHaveText("2 note(s)");
    await expect(pageNumber).toHaveValue("3");

    await page
        .getByRole("textbox", { name: "PDF URL", exact: true })
        .fill("/preview-notes-regression.pdf#header-rerender");
    await expect(pageNumber).toHaveValue("3");
    await expect(page.locator('[data-pdf-page="3"]')).toBeVisible();
});
