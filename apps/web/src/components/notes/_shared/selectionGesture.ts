/**
 * When to turn the browser's text selection into a note anchor.
 *
 * `selectionchange` fires on every pointer move of a drag. Reacting to each
 * one re-renders the viewer and pops the "+ Note" button up under the moving
 * cursor, which is what made selecting in a PDF feel shaky. So: while the
 * primary button is down, changes are only noted; the selection is committed
 * once, on release. Keyboard and programmatic selections (no button down)
 * commit on the next animation frame, coalescing bursts into one.
 */
export interface SelectionCommitter {
    pointerDown: (primary: boolean) => void;
    pointerUp: () => void;
    selectionChanged: () => void;
    /** Drop anything scheduled; call on unmount. */
    dispose: () => void;
}

export function createSelectionCommitter(
    commit: () => void,
    schedule: (fn: () => void) => number = fn => window.requestAnimationFrame(fn),
    cancel: (handle: number) => void = handle => window.cancelAnimationFrame(handle)
): SelectionCommitter {
    let dragging = false;
    let changedWhileDragging = false;
    let pending: number | null = null;

    const flush = () => {
        pending = null;
        commit();
    };

    return {
        pointerDown: primary => {
            if (!primary) return;
            dragging = true;
            changedWhileDragging = false;
            if (pending != null) {
                cancel(pending);
                pending = null;
            }
        },
        pointerUp: () => {
            if (!dragging) return;
            dragging = false;
            if (changedWhileDragging) {
                changedWhileDragging = false;
                commit();
            }
        },
        selectionChanged: () => {
            if (dragging) {
                changedWhileDragging = true;
                return;
            }
            pending ??= schedule(flush);
        },
        dispose: () => {
            if (pending != null) cancel(pending);
            pending = null;
            dragging = false;
            changedWhileDragging = false;
        },
    };
}
