/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { useRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useSheetFocusRecovery } from "~/app/employer/tools/vantage/_lib/use-sheet-focus-recovery";
function Demo({ removed = false, open = true }: { removed?: boolean; open?: boolean }) {
    const heading = useRef<HTMLElement | null>(null);
    useSheetFocusRecovery(open, heading);
    return (
        <>
            <section>
                <header ref={heading} tabIndex={-1}>
                    Drawer heading
                </header>
                {removed ? <p>Saved</p> : <button>Save</button>}
            </section>
            <input aria-label="Other pane" />
        </>
    );
}
it("recovers to the drawer when a save removes its focused control", async () => {
    const view = render(<Demo />);
    screen.getByRole("button").focus();
    view.rerender(<Demo removed />);
    await waitFor(() => expect(screen.getByText("Drawer heading")).toHaveFocus());
});
it("does not steal focus from another pane", async () => {
    const view = render(<Demo />);
    const other = screen.getByRole("textbox");
    other.focus();
    view.rerender(<Demo removed />);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(other).toHaveFocus();
});
it("does not recover a closed drawer", async () => {
    const view = render(<Demo />);
    screen.getByRole("button").focus();
    view.rerender(<Demo removed open={false} />);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.getByText("Drawer heading")).not.toHaveFocus();
});

it("does not move focus behind an open nested confirmation dialog", async () => {
    const view = render(
        <>
            <Demo />
            <div role="dialog" aria-modal="true" data-state="open">
                Confirmation
            </div>
        </>
    );
    screen.getByRole("button").focus();
    view.rerender(
        <>
            <Demo removed />
            <div role="dialog" aria-modal="true" data-state="open">
                Confirmation
            </div>
        </>
    );
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.getByText("Drawer heading")).not.toHaveFocus();
});

function LatePortal({
    mounted = false,
    removed = false,
}: {
    mounted?: boolean;
    removed?: boolean;
}) {
    const heading = useRef<HTMLElement | null>(null);
    useSheetFocusRecovery(true, heading);
    return mounted ? (
        <section>
            <header ref={heading} tabIndex={-1}>
                Late drawer
            </header>
            {removed ? <p>Saved</p> : <button>Late save</button>}
        </section>
    ) : null;
}
it("recovers when a portal attaches its header after the open effect", async () => {
    const view = render(<LatePortal />);
    view.rerender(<LatePortal mounted />);
    screen.getByRole("button", { name: "Late save" }).focus();
    view.rerender(<LatePortal mounted removed />);
    await waitFor(() => expect(screen.getByText("Late drawer")).toHaveFocus());
});
