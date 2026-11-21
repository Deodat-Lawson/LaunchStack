import { describe, expect, it } from "vitest";

import { mapInPool } from "./pool";

/** A promise the test finishes by hand, so overlap is exact rather than timed. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("mapInPool", () => {
    it("never runs more than the limit, and returns results in input order", async () => {
        const gates = [0, 1, 2, 3, 4].map(() => deferred<string>());
        const started: number[] = [];
        const pending = mapInPool([0, 1, 2, 3, 4], 2, i => {
            started.push(i);
            return gates[i]!.promise;
        });

        await tick();
        expect(started).toEqual([0, 1]);

        // The later item finishes first; its slot goes to the next one.
        gates[1]!.resolve("b");
        await tick();
        expect(started).toEqual([0, 1, 2]);

        gates[0]!.resolve("a");
        gates[2]!.resolve("c");
        gates[3]!.resolve("d");
        gates[4]!.resolve("e");
        await expect(pending).resolves.toEqual(["a", "b", "c", "d", "e"]);
    });

    it("starts nothing new after a failure, and waits for what started", async () => {
        const gates = [0, 1, 2, 3].map(() => deferred<string>());
        const started: number[] = [];
        let settled = false;
        const pending = mapInPool([0, 1, 2, 3], 2, i => {
            started.push(i);
            return gates[i]!.promise;
        }).finally(() => {
            settled = true;
        });
        const outcome = expect(pending).rejects.toThrow("first");

        await tick();
        gates[0]!.reject(new Error("first"));
        await tick();
        expect(started).toEqual([0, 1]);
        expect(settled).toBe(false);

        gates[1]!.resolve("b");
        await outcome;
        expect(started).toEqual([0, 1]);
    });

    it("skips what has not started once stopped, keeping the finished results", async () => {
        let stop = false;
        const results = await mapInPool(
            [0, 1, 2, 3],
            1,
            async i => {
                if (i === 1) stop = true;
                return i;
            },
            () => stop
        );
        expect(results).toEqual([0, 1]);
    });

    it("treats a limit below one as one, and handles no items", async () => {
        await expect(mapInPool([1, 2], 0, async i => i * 2)).resolves.toEqual([2, 4]);
        await expect(mapInPool([], 5, async i => i)).resolves.toEqual([]);
    });
});
