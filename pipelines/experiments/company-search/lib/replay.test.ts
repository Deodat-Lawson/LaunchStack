import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pipelines = path.resolve(here, "..", "..", "..");
const results = path.resolve(here, "..", "results");

function checksums(): Record<string, string> {
    return Object.fromEntries(
        readdirSync(results)
            .sort()
            .map(file => [
                file,
                createHash("sha1")
                    .update(readFileSync(path.join(results, file)))
                    .digest("hex"),
            ])
    );
}

/**
 * The whole replay on a checkout that has no recordings, which is what a
 * fresh clone is: the recordings are not in git. Every experiment has to
 * stop, and the committed results have to be left exactly as they are.
 */
describe("replaying without recordings", () => {
    let empty: string;
    beforeAll(() => {
        empty = mkdtempSync(path.join(tmpdir(), "bench-no-recordings-"));
    });
    afterAll(() => rmSync(empty, { recursive: true, force: true }));

    it("stops every experiment, exits 1 and writes nothing", () => {
        const before = checksums();
        const run = spawnSync("pnpm", ["exec", "tsx", "experiments/company-search/run.ts"], {
            cwd: pipelines,
            encoding: "utf8",
            env: { ...process.env, COMPANY_SEARCH_BENCH_CACHE: empty },
        });
        expect(run.status).toBe(1);
        for (const id of ["e1", "e2", "e3", "e4"]) {
            expect(run.stdout).toMatch(new RegExp(`######## ${id} FAILED`));
            expect(run.stdout).not.toMatch(new RegExp(`######## ${id} finished`));
        }
        expect(checksums()).toEqual(before);
        expect(readdirSync(empty)).toEqual([]);
    }, 180_000);
});
