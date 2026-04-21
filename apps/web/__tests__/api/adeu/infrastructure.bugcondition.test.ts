/**
 * Bug Condition Exploration Tests — Infrastructure & Config
 *
 * Property 1: Expected Behavior — ADEU Review Fixes
 * Tests in this file verify bugs 1.8, 1.11, 1.12, 1.18 are FIXED.
 * They PASS on fixed code, confirming each bug has been resolved.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

// ===========================================================================
// Fix 1.8 — OPENAI_API_KEY removed from Docker build args
// ===========================================================================
describe("Fix 1.8: Secret removed from Docker build args — OPENAI_API_KEY not in x-app-build-args", () => {
    it("docker-compose.yml does NOT include OPENAI_API_KEY as a build arg value in x-app-build-args", () => {
        const composePath = path.join(ROOT, "docker-compose.yml");
        const content = fs.readFileSync(composePath, "utf-8");

        // FIX: OPENAI_API_KEY should NOT be in the build args anchor as an actual key-value pair.
        // It should only be a runtime env var, never baked into image layers.
        const buildArgsSection = content.match(
            /x-app-build-args:.*?&app-build-args\n([\s\S]*?)(?=\nservices:|\n\S)/,
        );
        expect(buildArgsSection).not.toBeNull();

        const buildArgs = buildArgsSection![1]!;
        // Filter out comment lines (lines starting with #) before checking
        const nonCommentLines = buildArgs
            .split("\n")
            .filter((line) => !line.trim().startsWith("#"))
            .join("\n");
        expect(nonCommentLines).not.toContain("OPENAI_API_KEY");
    });
});

// ===========================================================================
// Fix 1.11 — sidecar Dockerfile has USER directive
// ===========================================================================
describe("Fix 1.11: Non-root container — sidecar Dockerfile has USER directive", () => {
    it("sidecar/Dockerfile has a USER directive", () => {
        const dockerfilePath = path.join(ROOT, "sidecar", "Dockerfile");
        const content = fs.readFileSync(dockerfilePath, "utf-8");

        // FIX: A USER directive is present so the container runs as non-root.
        const hasUserDirective = /^USER\s+/m.test(content);
        expect(hasUserDirective).toBe(true);
    });

    it("sidecar/Dockerfile USER is not root", () => {
        const dockerfilePath = path.join(ROOT, "sidecar", "Dockerfile");
        const content = fs.readFileSync(dockerfilePath, "utf-8");

        // FIX: The USER should be a non-root user (not "root" or "0")
        const userMatch = content.match(/^USER\s+(\S+)/m);
        expect(userMatch).not.toBeNull();
        expect(userMatch![1]).not.toBe("root");
        expect(userMatch![1]).not.toBe("0");
    });
});

// ===========================================================================
// Fix 1.12 — *.log in .gitignore
// ===========================================================================
describe("Fix 1.12: Log files excluded — *.log in .gitignore", () => {
    it(".gitignore contains *.log entry", () => {
        const gitignorePath = path.join(ROOT, ".gitignore");
        const content = fs.readFileSync(gitignorePath, "utf-8");

        // FIX: *.log is in .gitignore so log files cannot be accidentally committed
        const lines = content.split("\n").map((l) => l.trim());
        const hasWildcardLog = lines.some((l) => l === "*.log");
        expect(hasWildcardLog).toBe(true);
    });
});

// ===========================================================================
// Fix 1.18 — adeu installed only once (via requirements.txt, not duplicated)
// ===========================================================================
describe("Fix 1.18: Single adeu install — adeu not duplicated in Dockerfile", () => {
    it("sidecar/Dockerfile does NOT have explicit standalone pip install adeu", () => {
        const dockerfilePath = path.join(ROOT, "sidecar", "Dockerfile");
        const content = fs.readFileSync(dockerfilePath, "utf-8");

        // FIX: adeu should NOT be installed via a standalone pip install line.
        // It should only be installed via requirements.txt.
        // A standalone pip install adeu line (not part of -r requirements.txt) is the bug.
        const lines = content.split("\n");
        const hasStandalonePipInstallAdeu = lines.some((line) => {
            const trimmed = line.trim();
            // Match lines like "pip install adeu==0.9.0" but NOT "pip install -r requirements.txt"
            return /pip install(?!.*-r).*adeu/.test(trimmed) && !trimmed.includes("-r");
        });
        expect(hasStandalonePipInstallAdeu).toBe(false);
    });

    it("sidecar/requirements.txt contains adeu as single source of truth", () => {
        const reqPath = path.join(ROOT, "sidecar", "requirements.txt");
        const content = fs.readFileSync(reqPath, "utf-8");

        // FIX: adeu is in requirements.txt as the single source of truth
        expect(content).toMatch(/adeu/);
    });

    it("sidecar/Dockerfile installs dependencies via requirements.txt", () => {
        const dockerfilePath = path.join(ROOT, "sidecar", "Dockerfile");
        const content = fs.readFileSync(dockerfilePath, "utf-8");

        // FIX: Dockerfile uses pip install -r requirements.txt (which includes adeu)
        expect(content).toMatch(/pip install.*-r\s+requirements\.txt/);
    });
});
