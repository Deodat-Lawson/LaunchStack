/**
 * Bug Condition Exploration Tests — Infrastructure & Config
 *
 * Property 1: Expected Behavior — ADEU Review Fixes
 * Tests in this file verify bugs 1.8, 1.11, 1.12, 1.18 are FIXED.
 * They PASS on fixed code, confirming each bug has been resolved.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../../../..");

// ===========================================================================
// Fix 1.8 — OPENAI_API_KEY removed from Docker build args
// ===========================================================================
describe("Fix 1.8: Secret removed from Docker build args — OPENAI_API_KEY not in x-app-build-args", () => {
    it("docker-compose.yml does NOT include OPENAI_API_KEY as a build arg value in x-app-build-args", () => {
        const composePath = path.join(ROOT, "docker-compose.yml");
        const content = fs.readFileSync(composePath, "utf-8");

        // FIX: OPENAI_API_KEY should NOT be in the build args anchor as an actual key-value pair.
        // It should only be a runtime env var, never baked into image layers.
        const buildArgsSection =
            /x-app-build-args:.*?&app-build-args\n([\s\S]*?)(?=\nservices:|\n\S)/.exec(
                content,
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

describe("Single-endpoint chat runtime configuration", () => {
    it("forwards the chat endpoint and its config file to the app container", () => {
        const composePath = path.join(ROOT, "docker-compose.yml");
        const content = fs.readFileSync(composePath, "utf-8");
        const appService = /\n  app:\n([\s\S]*?)(?=\n  \S|\nvolumes:)/.exec(
            content,
        );

        expect(appService).not.toBeNull();
        expect(appService![1]).toContain("CHAT_BASE_URL: ${CHAT_BASE_URL:-}");
        expect(appService![1]).toContain("CHAT_API_KEY: ${CHAT_API_KEY:-}");
        expect(appService![1]).toContain("CHAT_MODELS_CONFIG:");
    });

    it("mounts the chat model configuration so it is editable without a rebuild", () => {
        const composePath = path.join(ROOT, "docker-compose.yml");
        const content = fs.readFileSync(composePath, "utf-8");
        const appService = /\n  app:\n([\s\S]*?)(?=\n  \S|\nvolumes:)/.exec(
            content,
        );

        expect(appService![1]).toContain(
            "./apps/web/config/chat-models.yaml:/app/apps/web/config/chat-models.yaml:ro",
        );
    });

    /**
     * `CHAT_MODELS_CONFIG` defaults to a *relative* path, so where the
     * container starts decides whether the file is found at all. Three places
     * have to agree and none of them mention the other two: the Dockerfile's
     * final WORKDIR, the directory the config is copied into, and the path
     * compose mounts over. Asserted here because getting it wrong produces a
     * container that builds, boots, serves pages, and then fails the first
     * chat request with a missing-file error.
     */
    describe.each([
        ["apps/web/Dockerfile", path.join("apps", "web", "Dockerfile")],
        [
            "apps/web/Dockerfile.prebuilt",
            path.join("apps", "web", "Dockerfile.prebuilt"),
        ],
    ])("%s runner", (_label, relativePath) => {
        const dockerfile = fs.readFileSync(
            path.join(ROOT, relativePath),
            "utf-8",
        );
        const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));

        // DEFAULT_CHAT_CONFIG_PATH in apps/web/src/server/chat-endpoint.ts.
        const DEFAULT_CHAT_CONFIG_PATH = "config/chat-models.yaml";
        const MOUNT_TARGET = "/app/apps/web/config/chat-models.yaml";

        it("starts in the directory the default config path resolves against", () => {
            const workdirs = [...runner.matchAll(/^WORKDIR\s+(\S+)/gm)].map(
                (match) => match[1]!,
            );
            const finalWorkdir = workdirs[workdirs.length - 1];

            expect(finalWorkdir).toBeDefined();
            expect(
                path.posix.join(finalWorkdir!, DEFAULT_CHAT_CONFIG_PATH),
            ).toBe(MOUNT_TARGET);
        });

        it("copies the config to that same resolved path", () => {
            // The source is `apps/web/config` in the prebuilt runner and
            // `/app/apps/web/config` in the builder-fed one.
            const copy = /^COPY[^\n]*\s\/?(?:app\/)?apps\/web\/config\s+(\S+)\s*$/m.exec(
                runner,
            );
            expect(copy).not.toBeNull();

            // COPY destinations are relative to the WORKDIR in force at that
            // line, which is /app in both runner stages.
            const destination = path.posix.resolve("/app", copy![1]!);
            expect(path.posix.join(destination, "chat-models.yaml")).toBe(
                MOUNT_TARGET,
            );
        });

        it("starts the server entrypoint from that working directory", () => {
            const cmd = /^CMD\s+(\[[^\]]*\])/m.exec(runner);
            expect(cmd).not.toBeNull();

            const argv = JSON.parse(cmd![1]!) as string[];
            const workdirs = [...runner.matchAll(/^WORKDIR\s+(\S+)/gm)].map(
                (match) => match[1]!,
            );
            const entry = argv[argv.length - 1]!;
            expect(
                path.posix.resolve(workdirs[workdirs.length - 1]!, entry),
            ).toBe("/app/apps/web/server.js");
        });
    });

    it("no longer forwards removed per-provider chat variables", () => {
        const composePath = path.join(ROOT, "docker-compose.yml");
        const content = fs.readFileSync(composePath, "utf-8");
        for (const removed of [
            "CHAT_PROVIDER",
            "CHAT_CAPABILITIES",
            "CHAT_FAST_PROVIDER",
            "CHAT_REASONING_MODEL",
            "CHAT_VISION_PROVIDER",
            "CHAT_STRUCTURED_MODEL",
        ]) {
            expect(content).not.toContain(removed);
        }
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
        const userMatch = /^USER\s+(\S+)/m.exec(content);
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
