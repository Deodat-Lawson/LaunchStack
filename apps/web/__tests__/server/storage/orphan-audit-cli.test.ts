import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("storage orphan audit CLI argument safety", () => {
    jest.setTimeout(30_000);
    it.each(["", " ", "0.5", "1e2", "0x10", "-1"])(
        "rejects non-integer --grace-days %j before connecting",
        value => {
            const result = spawnSync(
                "pnpm",
                ["exec", "tsx", "scripts/storage-orphan-audit.ts", `--grace-days=${value}`],
                {
                    cwd: join(__dirname, "../../.."),
                    encoding: "utf8",
                    timeout: 15_000,
                    env: {
                        ...process.env,
                        DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/unused",
                        DOTENV_CONFIG_QUIET: "true",
                    },
                }
            );
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain("--grace-days must be a non-negative integer");
        }
    );
});
