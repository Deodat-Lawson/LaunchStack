import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The demonstrator's whole experience, timed in interactions.
 *
 * From the workspace: create a mindmap, grow it with Tab and Enter, present
 * it, step through it. The interaction count is asserted because it is the
 * one number the disclosure plan set out to move, and because "simple" only
 * stays simple if something fails when it stops being simple.
 *
 * Needs a running server with a database behind it — see playwright.config.ts.
 */

function throwawayPassword(): string {
    return `E2e-${randomBytes(18).toString("base64url")}!`;
}

async function signUpWithWorkspace(page: Page): Promise<void> {
    const stamp = randomUUID().replace(/-/g, "").slice(0, 12);
    const email = `demo-path-${stamp}@example.test`;
    const signup = await page.request.post("/api/auth/sign-up/email", {
        data: { name: "Demo Path", email, password: throwawayPassword() },
    });
    expect(signup.ok(), `sign-up failed: ${signup.status()} ${await signup.text()}`).toBe(true);
    const company = await page.request.post("/api/signup/employerCompany", {
        data: {
            companyName: `Demo Path ${stamp}`,
            name: "Demo Path",
            email,
            numberOfEmployees: "1",
        },
    });
    expect(company.ok(), `workspace failed: ${company.status()} ${await company.text()}`).toBe(
        true
    );
}

/** Counts the clicks and key presses the person makes, and nothing else. */
class Meter {
    n = 0;
    constructor(private readonly page: Page) {}
    async click(locator: Locator) {
        this.n += 1;
        await locator.click();
    }
    /** SVG text never passes Playwright's actionability checks; click its centre. */
    async clickAt(locator: Locator) {
        this.n += 1;
        const box = await locator.boundingBox();
        if (!box) throw new Error("nothing to click");
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    async key(key: string) {
        this.n += 1;
        await this.page.keyboard.press(key);
    }
    async type(text: string) {
        // Typing the content is not an interaction cost — it is the work.
        await this.page.keyboard.type(text);
    }
}

test.describe("the demo path", () => {
    test.beforeEach(async ({ page }) => {
        await signUpWithWorkspace(page);
    });

    test("template → three topics → present, in nine interactions or fewer", async ({ page }) => {
        const m = new Meter(page);

        await page.goto("/employer/documents");
        await expect(page.getByPlaceholder("Filter sources")).toBeVisible({
            timeout: 90_000,
        });

        // 1–3: the rail's caret → New mindmap → a template.
        await m.click(page.getByLabel("More ways to add"));
        await m.click(page.getByRole("menuitem", { name: "New mindmap" }));
        await m.click(page.getByRole("button", { name: /^Mindmap Central idea/ }));

        await page.waitForURL(/\/employer\/documents\?.*source=m\d+.*edit=1/);
        await expect(page.getByLabel("Mindmap title")).toBeVisible();

        // A mindmap opens simple: no shape library, five tools.
        await expect(page.getByPlaceholder("Search shapes…")).toHaveCount(0);
        // `exact`: a substring match would catch "Open Knowledge" on the rail.
        await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveCount(0);

        // 4: select the centre. 5–6: Tab and Enter grow the tree; typing is free.
        await m.clickAt(page.getByText("Central idea").first());
        await m.key("Tab");
        await m.type("Budget");
        await m.key("Enter");
        await m.type("Timeline");
        await page.keyboard.press("Escape");

        // Auto-arrange placed them: no two topics overlap. One box per node id
        // (the selected node also carries a chrome group with the same id),
        // measured on the shape itself — the group around it holds the padded
        // hit target and the collapse pill, which reach into the sibling gap.
        const boxes = await page.locator("svg [data-node-id]").evaluateAll(els => {
            const seen = new Set<string>();
            const out: { left: number; right: number; top: number; bottom: number }[] = [];
            for (const el of els) {
                const id = el.getAttribute("data-node-id") ?? "";
                if (seen.has(id)) continue;
                seen.add(id);
                const shape = el.querySelector("path, rect, ellipse") ?? el;
                const r = (shape as SVGGraphicsElement).getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                out.push({
                    left: r.left + 1,
                    right: r.right - 1,
                    top: r.top + 1,
                    bottom: r.bottom - 1,
                });
            }
            return out;
        });
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]!;
                const b = boxes[j]!;
                const overlap =
                    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                expect(overlap, `topics ${i} and ${j} overlap`).toBe(false);
            }
        }

        // 7: Present. 8–9: two steps through the branches.
        await m.click(page.getByRole("button", { name: /Present/ }));
        await expect(page.getByText("Overview")).toBeVisible();
        await m.key("ArrowRight");
        await expect(page.getByText(/Branch 1 of/)).toBeVisible();
        await m.key("ArrowRight");
        await expect(page.getByText(/Branch 2 of/)).toBeVisible();

        expect(m.n, "interactions on the demo path").toBeLessThanOrEqual(9);
    });
});
