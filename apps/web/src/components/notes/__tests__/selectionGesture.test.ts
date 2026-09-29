import { createSelectionCommitter } from "../_shared/selectionGesture";

/** A scheduler that runs nothing until told to, so commits are observable. */
function harness() {
    const queue = new Map<number, () => void>();
    let next = 1;
    const commit = jest.fn();
    const committer = createSelectionCommitter(
        commit,
        fn => {
            const id = next++;
            queue.set(id, fn);
            return id;
        },
        id => {
            queue.delete(id);
        }
    );
    const runFrame = () => {
        const jobs = [...queue.values()];
        queue.clear();
        jobs.forEach(job => job());
    };
    return { committer, commit, runFrame, pending: () => queue.size };
}

describe("selection committer", () => {
    it("holds a drag's changes and commits once on release", () => {
        const { committer, commit, pending } = harness();
        committer.pointerDown(true);
        for (let i = 0; i < 40; i += 1) committer.selectionChanged();
        expect(commit).not.toHaveBeenCalled();
        expect(pending()).toBe(0);
        committer.pointerUp();
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("does not commit a drag that never changed the selection", () => {
        const { committer, commit } = harness();
        committer.pointerDown(true);
        committer.pointerUp();
        expect(commit).not.toHaveBeenCalled();
    });

    it("coalesces keyboard selection changes into one frame", () => {
        const { committer, commit, runFrame, pending } = harness();
        committer.selectionChanged();
        committer.selectionChanged();
        committer.selectionChanged();
        expect(pending()).toBe(1);
        expect(commit).not.toHaveBeenCalled();
        runFrame();
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("ignores secondary buttons, so a right-click never starts a drag", () => {
        const { committer, commit, runFrame } = harness();
        committer.pointerDown(false);
        committer.selectionChanged();
        runFrame();
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("drops a scheduled commit when a drag starts, and everything on dispose", () => {
        const { committer, commit, runFrame, pending } = harness();
        committer.selectionChanged();
        committer.pointerDown(true);
        expect(pending()).toBe(0);
        committer.selectionChanged();
        committer.dispose();
        committer.pointerUp();
        runFrame();
        expect(commit).not.toHaveBeenCalled();
    });
});
