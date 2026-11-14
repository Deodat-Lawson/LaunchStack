import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** The visible PDF page, independently of the React page-counter state. */
async function visiblePage(page: Page) {
    return page.getByTestId("pdf-scroll").evaluate(scroll => {
        const box = scroll.getBoundingClientRect();
        const probe = box.top + box.height / 3;
        const pages = Array.from(scroll.querySelectorAll<HTMLElement>("[data-pdf-page]"));
        const current = pages
            .filter(element => element.getBoundingClientRect().top <= probe)
            .at(-1);
        return Number(current?.dataset.pdfPage ?? 0);
    });
}

async function mockWorkspace(page: Page, quoteOnly: boolean) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let number = 1; number <= 5; number += 1) {
        pdf.addPage([600, 800]).drawText(`Annotation target on page ${number}`, {
            x: 60,
            y: 600,
            size: 18,
            font,
        });
    }
    const bytes = Buffer.from(await pdf.save());
    await page.route("**/navigation-regression.pdf", route =>
        route.fulfill({ contentType: "application/pdf", body: bytes })
    );
    await page.route("**/api/**", route => {
        const path = new URL(route.request().url()).pathname;
        const date = "2026-01-01T00:00:00.000Z";
        if (path === "/api/auth/get-session")
            return route.fulfill({
                json: {
                    user: {
                        id: "preview-u1",
                        name: "Preview",
                        email: "preview@example.test",
                        emailVerified: true,
                        createdAt: date,
                        updatedAt: date,
                    },
                    session: {
                        id: "preview-session",
                        token: "preview-session",
                        userId: "preview-u1",
                        expiresAt: "2030-01-01T00:00:00.000Z",
                        createdAt: date,
                        updatedAt: date,
                    },
                },
            });
        if (path === "/api/fetchDocument")
            return route.fulfill({
                json: [
                    {
                        id: 9,
                        title: "Navigation regression.pdf",
                        category: "Tests",
                        url: "/navigation-regression.pdf",
                        mimeType: "application/pdf",
                    },
                ],
            });
        if (path === "/api/documents/9/versions")
            return route.fulfill({
                json: {
                    documentId: 9,
                    currentVersionId: 1,
                    fileType: "application/pdf",
                    versions: [],
                },
            });
        if (path === "/api/notes")
            return route.fulfill({
                json: {
                    notes: [
                        {
                            id: 1,
                            documentId: "9",
                            title: "Previous note",
                            content: "Existing annotation",
                            contentMarkdown: "Existing annotation",
                            contentRich: null,
                            tags: [],
                            createdAt: date,
                            updatedAt: date,
                            anchor: {
                                type: "pdf",
                                primary: {
                                    kind: "pdf",
                                    page: 1,
                                    quads: quoteOnly ? [] : [[0.1, 0.23, 0.65, 0.27]],
                                },
                                quote: { exact: "Annotation target on page 1" },
                            },
                            anchorStatus: "resolved",
                        },
                    ],
                },
            });
        return route.fulfill({ json: {} });
    });
}

for (const focus of ["positioned note", "quote-only note", "citation"] as const) {
    for (const fixedZoom of [false, true]) {
        test(`notes and Ask AI preserve the real viewport after a ${focus} at ${fixedZoom ? "fixed" : "automatic"} zoom`, async ({
            page,
        }) => {
            await page.setViewportSize({ width: 2560, height: 1440 });
            await mockWorkspace(page, focus === "quote-only note");
            await page.goto("/dev/document-workspace");
            const counter = page.getByRole("textbox", { name: "Page number", exact: true });
            await expect(counter).toHaveValue("1");
            if (fixedZoom) {
                await page.getByTestId("pdf-zoom-level").click();
                await page.getByRole("menuitem", { name: "100%", exact: true }).click();
                await expect(page.getByTestId("pdf-zoom-level")).toHaveText("100%");
            }
            await page.getByRole("button", { name: "Notes", exact: true }).click();
            const focusPrevious = async () => {
                if (focus === "citation") {
                    await page
                        .getByRole("button", { name: "Cite first page", exact: true })
                        .click();
                } else {
                    await page.getByText("Previous note", { exact: true }).click();
                }
                await expect.poll(() => visiblePage(page)).toBe(1);
                await expect(counter).toHaveValue("1");
                if (focus !== "positioned note") {
                    await expect(
                        page.locator('[data-pdf-page="1"] [class*="outline-"]')
                    ).toBeVisible();
                }
            };
            await focusPrevious();

            // Open Notes and write a new draft after following an older note.
            await page
                .getByRole("button", { name: "Hide versions and notes", exact: true })
                .first()
                .click();
            await counter.fill("3");
            await counter.press("Enter");
            await expect.poll(() => visiblePage(page)).toBe(3);
            await page
                .getByRole("button", { name: "Show versions and notes", exact: true })
                .click();
            await page.getByRole("button", { name: "New note", exact: true }).click();
            await page
                .getByRole("textbox", { name: "Title", exact: true })
                .last()
                .fill("New draft");
            await page
                .locator('[contenteditable="true"]')
                .filter({ visible: true })
                .fill("A note on the current page.");
            await expect.poll(() => visiblePage(page)).toBe(3);
            await page.getByRole("button", { name: "Cancel", exact: true }).click();

            // Ask AI moves the same mounted viewer into a newly created pane.
            await focusPrevious();
            await counter.fill("3");
            await counter.press("Enter");
            await expect.poll(() => visiblePage(page)).toBe(3);
            await page
                .locator('[data-pdf-page="3"] .react-pdf__Page__textContent span')
                .filter({ hasText: "Annotation target on page 3" })
                .click({ clickCount: 3 });
            await page.getByRole("button", { name: "✦ Ask AI", exact: true }).click();
            await expect(page.getByTestId("asked-passage")).toContainText(
                "Annotation target on page 3"
            );
            await expect.poll(() => visiblePage(page), { timeout: 8000 }).toBe(3);
            expect(
                await page.getByTestId("pdf-scroll").evaluate(element => element.scrollTop)
            ).toBeGreaterThan(0);
            await expect(counter).toHaveValue("3");

            // With chat focused and Notes open, starting another draft changes
            // the focused pane but must keep the document where the reader was.
            await page.getByRole("textbox", { name: "Question", exact: true }).click();
            await page.getByRole("button", { name: "New note", exact: true }).click();
            await expect.poll(() => visiblePage(page)).toBe(3);
            await page.getByRole("button", { name: "Cancel", exact: true }).click();
            await page.getByRole("button", { name: "Merge panes", exact: true }).click();
            await expect.poll(() => visiblePage(page)).toBe(3);
            await focusPrevious();
            await counter.fill("3");
            await counter.press("Enter");
            await expect.poll(() => visiblePage(page)).toBe(3);
            await focusPrevious();
        });
    }
}
