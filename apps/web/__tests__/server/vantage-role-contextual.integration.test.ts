/** @jest-environment node */
/** Launches actual loopback HTTP and PostgreSQL controls with isolated environment. No application mocks. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const suite = process.env.VANTAGE_ROLE_M2_ACCEPTANCE === "true" ? describe : describe.skip;
suite("Role contextual real runtime acceptance", () => {
    jest.setTimeout(240000);
    let httpPassed = false;
    function run(script: string) {
        const root = resolve(process.cwd(), "../..");
        const runtimeUrl = pathToFileURL(
            resolve(root, "scripts/dev/vantage-role-runtime.mjs")
        ).href;
        const extraArgs = script.endsWith("vantage-role-acceptance.ts")
            ? process.env.VANTAGE_ROLE_M2_CAPTURED_HTTP
                ? ["--complete-captured-http=" + process.env.VANTAGE_ROLE_M2_CAPTURED_HTTP]
                : process.env.VANTAGE_ROLE_M2_RESUME_ARTIFACT
                  ? ["--resume-http=" + process.env.VANTAGE_ROLE_M2_RESUME_ARTIFACT]
                  : []
            : [];
        const code = `import {readRuntime,childEnvironment} from ${JSON.stringify(runtimeUrl)};import {spawnSync} from 'node:child_process';
            const result=spawnSync(process.execPath,['--import','tsx',${JSON.stringify(script)},...${JSON.stringify(extraArgs)}],{cwd:${JSON.stringify(root)},env:{...childEnvironment(readRuntime()),TSX_TSCONFIG_PATH:'apps/web/tsconfig.json'},encoding:'utf8',timeout:200000});
            process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.status??1;`;
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
            cwd: root,
            encoding: "utf8",
            timeout: 215000,
        });
        expect({
            exitCode: result.status,
            error: result.error?.message,
            stdout: result.stdout,
            stderr: result.stderr,
        }).toMatchObject({ exitCode: 0 });
        const lines = result.stdout.trim().split(/\r?\n/);
        const summary = JSON.parse(lines[lines.length - 1]!) as { output: string; checks: number };
        expect(summary.output).toContain("vantage-role-m2-20261106");
        expect(summary.checks).toBeGreaterThan(0);
    }
    it("persists actual unknown neutral then the same-source paired primary-role reports through authenticated HTTP", () => {
        run("apps/web/scripts/vantage-role-acceptance.ts");
        httpPassed = true;
    });
    it("rejects actual stale-primary/map/source/permission/generation controls while preserving saved role reports", () => {
        expect(httpPassed).toBe(true);
        run("apps/web/scripts/vantage-role-db-controls.ts");
    });
});
