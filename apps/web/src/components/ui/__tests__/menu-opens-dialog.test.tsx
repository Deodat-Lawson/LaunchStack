/** @jest-environment jsdom */

/**
 * A menu item that opens a dialog must give the page back when the dialog
 * closes.
 *
 * Radix's DismissableLayer sets `pointer-events: none` on <body> while a modal
 * layer is open and restores the value it found when the last one closes. The
 * bookkeeping lives in module state, so it only works when the menu and the
 * dialog share one copy of `@radix-ui/react-dismissable-layer`. With two
 * copies, the dialog (which mounts synchronously while the menu is still open)
 * records the menu's "none" as the original value and puts it back on close:
 * nothing on the page can be clicked until a reload. FocusScope has the same
 * shape — two copies means two focus traps that hand focus back and forth
 * forever, which is why the flows below refuse to run on split copies rather
 * than hang.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";

// Module state every overlay must share: the open-layer stack
// (dismissable-layer), the focus-trap stack (focus-scope) and the focus-guard
// count (focus-guards).
const SHARED = [
    "@radix-ui/react-dismissable-layer",
    "@radix-ui/react-focus-scope",
    "@radix-ui/react-focus-guards",
];

// The overlays the kit renders, reached the way apps/web reaches them.
const OVERLAYS: string[][] = [
    ["@radix-ui/react-dialog"],
    ["@radix-ui/react-dropdown-menu", "@radix-ui/react-menu"],
    ["@radix-ui/react-context-menu", "@radix-ui/react-menu"],
    ["@radix-ui/react-popover"],
    ["@radix-ui/react-hover-card"],
    ["@radix-ui/react-select"],
    ["@radix-ui/react-tooltip"],
];

function readPackage(dir: string) {
    const json = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(json) as { version: string; dependencies?: Record<string, string> };
    return { version: pkg.version, dependencies: pkg.dependencies ?? {} };
}

function packageDir(fromDir: string, name: string): string {
    const entry = createRequire(path.join(fromDir, "package.json")).resolve(name);
    let dir = path.dirname(entry);
    while (!fs.existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir);
    return fs.realpathSync(dir);
}

/** "version: the overlays that load it", one line per copy of `dep`. */
function copiesOf(dep: string): string[] {
    const webDir = path.resolve(__dirname, "../../../..");
    const copies = new Map<string, string[]>();
    for (const chain of OVERLAYS) {
        const dir = chain.reduce(packageDir, webDir);
        // Only declared dependencies: resolving anything else would walk up
        // to pnpm's hoisted copy and blame a package that never loads it.
        if (!(dep in readPackage(dir).dependencies)) continue;
        const { version } = readPackage(packageDir(dir, dep));
        copies.set(version, [...(copies.get(version) ?? []), chain[0]!]);
    }
    return [...copies].map(([version, users]) => `${version}: ${users.join(", ")}`);
}

describe("radix layer bookkeeping", () => {
    it.each(SHARED)("resolves one copy of %s for every overlay", dep => {
        // On failure this prints which overlay pulls which version.
        expect(copiesOf(dep)).toHaveLength(1);
    });
});

type Overlay = "dialog" | "sheet" | "confirm";

function MenuThatOpens({ overlay }: { overlay: Overlay }) {
    const [open, setOpen] = React.useState(false);
    return (
        <>
            <button type="button">Something else on the page</button>
            <DropdownMenu>
                <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setOpen(true)}>Edit</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {overlay === "dialog" && (
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogContent>
                        <DialogTitle>Edit definition</DialogTitle>
                        <DialogDescription>Change how this is measured.</DialogDescription>
                    </DialogContent>
                </Dialog>
            )}
            {overlay === "sheet" && (
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetContent>
                        <SheetTitle>Details</SheetTitle>
                        <SheetDescription>Everything about this application.</SheetDescription>
                    </SheetContent>
                </Sheet>
            )}
            {overlay === "confirm" && (
                <ConfirmDialog
                    open={open}
                    onOpenChange={setOpen}
                    title="Remove member?"
                    onConfirm={() => setOpen(false)}
                />
            )}
        </>
    );
}

async function chooseEdit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    await screen.findByRole("dialog");
    // While the overlay is open the rest of the page is meant to be inert.
    expect(document.body.style.pointerEvents).toBe("none");
}

async function expectPageUsable(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.style.pointerEvents).toBe("");
    // user-event refuses to click through `pointer-events: none`, so this is
    // the page being usable, not just un-styled.
    await user.click(screen.getByRole("button", { name: "Something else on the page" }));
}

describe("a menu item that opens an overlay", () => {
    beforeAll(() => {
        const split = SHARED.flatMap(dep => {
            const copies = copiesOf(dep);
            return copies.length > 1 ? [`${dep} → ${copies.join(" | ")}`] : [];
        });
        if (split.length) {
            throw new Error(`Radix overlays load split copies:\n${split.join("\n")}`);
        }
        // Radix measures the trigger to place the menu; jsdom has no ResizeObserver.
        global.ResizeObserver ??= class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    });

    afterEach(() => {
        document.body.removeAttribute("style");
    });

    it.each<Overlay>(["dialog", "sheet", "confirm"])(
        "gives the page back when the %s is dismissed with Escape",
        async overlay => {
            const user = userEvent.setup();
            render(<MenuThatOpens overlay={overlay} />);
            await chooseEdit(user);
            await user.keyboard("{Escape}");
            await expectPageUsable(user);
        }
    );

    it("gives the page back when the dialog's close button is used", async () => {
        const user = userEvent.setup();
        render(<MenuThatOpens overlay="dialog" />);
        await chooseEdit(user);
        await user.click(screen.getByRole("button", { name: "Close" }));
        await expectPageUsable(user);
    });

    it("gives the page back when a confirm dialog is cancelled", async () => {
        const user = userEvent.setup();
        render(<MenuThatOpens overlay="confirm" />);
        await chooseEdit(user);
        await user.click(screen.getByTestId("confirm-cancel"));
        await expectPageUsable(user);
    });

    it("still works the second time round", async () => {
        const user = userEvent.setup();
        render(<MenuThatOpens overlay="dialog" />);
        for (let round = 0; round < 2; round++) {
            await chooseEdit(user);
            await user.keyboard("{Escape}");
            await expectPageUsable(user);
        }
    });
});
