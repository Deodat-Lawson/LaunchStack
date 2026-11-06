/** @jest-environment node */
/** Real Better Auth HTTP and PostgreSQL checks. This suite does not mock application modules. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const suite = process.env.VANTAGE_FINANCE_M1_ACCEPTANCE === "true" ? describe : describe.skip;
suite("Finance contextual real runtime acceptance", () => {
    jest.setTimeout(180000);
    async function run(mode: "http" | "direct") {
        const root = resolve(process.cwd(), "../..");
        const runtimeUrl = pathToFileURL(
            resolve(root, "scripts/dev/vantage-finance-runtime.mjs")
        ).href;
        const code = `import {readRuntime,childEnvironment} from ${JSON.stringify(runtimeUrl)};
            import {spawnSync} from 'node:child_process';
            const result=spawnSync(process.execPath,['--import','tsx','apps/web/scripts/vantage-finance-acceptance.ts',...${JSON.stringify(mode === "direct" ? ["--direct"] : [])}],{cwd:${JSON.stringify(root)},env:{...childEnvironment(readRuntime()),TSX_TSCONFIG_PATH:'apps/web/tsconfig.json'},encoding:'utf8',timeout:140000});
            process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.status??1;`;
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
            cwd: root,
            encoding: "utf8",
            timeout: 150000,
        });
        expect({
            exitCode: result.status,
            error: result.error?.message,
            stdout: result.stdout,
            stderr: result.stderr,
        }).toMatchObject({ exitCode: 0 });
        const lines = result.stdout.trim().split(/\r?\n/);
        const summary = JSON.parse(lines[lines.length - 1]!) as { output: string; checks: number };
        expect(summary.output).toContain("vantage-finance-m1-20261105");
        expect(summary.checks).toBeGreaterThan(0);
    }
    it("authenticates, generates, opens sources, reviews, reloads and denies scoped failures over HTTP", async () =>
        run("http"));
    it("rejects real DB prepare/commit races, malformed output and report tampering preserving the saved report", async () =>
        run("direct"));
});
