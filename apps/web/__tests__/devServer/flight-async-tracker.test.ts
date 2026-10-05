/**
 * Async work outside a React render must not grow the dev server's heap.
 *
 * `next dev --turbo` loads `app-page-turbo.runtime.dev.js` into the router
 * process even for API-only traffic. Its React Flight build installs a
 * process-wide `async_hooks` tracker (`pendingOperations`) and, unpatched,
 * starts a node for every promise and I/O resource in the process — linked
 * through `previous`/`awaited` into chains that are never released. The Calls
 * UI's 1 s polling grew live heap by ~1 GB/hour this way (react/react#36836
 * describes the same retention; React 19.3 does not change it).
 * `patches/next@15.5.7.patch` starts tracking only inside a React render.
 *
 * The child process loads the exact runtime Next serves and awaits real I/O
 * in a loop outside any render. Unpatched, 8000 iterations retain ~21 MB.
 */

import { spawnSync } from "node:child_process";

const runtimePath = require.resolve("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js");

const probe = `
process.env.NODE_ENV = "development";
const fs = require("node:fs/promises");
const runtime = ${JSON.stringify(runtimePath)};
require(runtime);
// Real fs and timer resources on purpose: they are the async_hooks resource
// types the tracker hooks, so fake timers would bypass the code under test.
async function poll(iterations) {
    for (let i = 0; i < iterations; i++) {
        await fs.stat(runtime);
        const { promise, resolve } = Promise.withResolvers();
        setTimeout(resolve, 0);
        await promise;
    }
}
(async () => {
    await poll(200);
    global.gc(); global.gc();
    const before = process.memoryUsage().heapUsed;
    await poll(8000);
    global.gc(); global.gc();
    process.stdout.write(String(process.memoryUsage().heapUsed - before));
})();
`;

describe("Next dev Flight runtime async tracking", () => {
    it("retains no heap for async work outside a React render", () => {
        const result = spawnSync(process.execPath, ["--expose-gc", "-e", probe], {
            encoding: "utf8",
            timeout: 60_000,
        });
        expect(result.stderr).toBe("");
        const growthBytes = Number(result.stdout);
        expect(Number.isFinite(growthBytes)).toBe(true);
        expect(growthBytes).toBeLessThan(2_000_000);
    }, 70_000);
});
