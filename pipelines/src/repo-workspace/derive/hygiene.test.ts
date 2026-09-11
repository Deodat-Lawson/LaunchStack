import { describe, expect, it } from "vitest";

import type { WorkspaceFile } from "../types";
import { buildHygieneManifest, isDeniedPath, makeDeniedSet } from "./hygiene";

const wf = (path: string): WorkspaceFile => ({ path, size: 1 });

describe("isDeniedPath", () => {
    it("denies dotenv files wherever they sit", () => {
        expect(isDeniedPath(".env")).toBe(true);
        expect(isDeniedPath(".env.local")).toBe(true);
        expect(isDeniedPath(".env.production")).toBe(true);
        expect(isDeniedPath("apps/web/.env")).toBe(true);
    });

    it("denies credential stores by exact name", () => {
        expect(isDeniedPath("credentials.json")).toBe(true);
        expect(isDeniedPath(".credentials.json")).toBe(true);
        expect(isDeniedPath("auth.json")).toBe(true);
        expect(isDeniedPath("settings.local.json")).toBe(true);
        expect(isDeniedPath("history.jsonl")).toBe(true);
        expect(isDeniedPath("config/credentials.json")).toBe(true);
    });

    it("denies private keys by name and extension", () => {
        expect(isDeniedPath("id_rsa")).toBe(true);
        expect(isDeniedPath("id_ed25519")).toBe(true);
        expect(isDeniedPath(".ssh/id_rsa")).toBe(true);
        expect(isDeniedPath("certs/server.pem")).toBe(true);
        expect(isDeniedPath("tls/private.key")).toBe(true);
        expect(isDeniedPath("bundle.p12")).toBe(true);
        expect(isDeniedPath("keystore.pfx")).toBe(true);
    });

    it("denies secret/token/credential names only at separator boundaries", () => {
        expect(isDeniedPath("api-token.ts")).toBe(true);
        expect(isDeniedPath("my_secret.txt")).toBe(true);
        expect(isDeniedPath("secrets.yaml")).toBe(true);
        expect(isDeniedPath("aws.credentials")).toBe(true);
        // "token" embedded inside a longer word is not secret material.
        expect(isDeniedPath("tokenizer.ts")).toBe(false);
        expect(isDeniedPath("src/tokenizer.ts")).toBe(false);
    });

    it("denies the repo-specific extras", () => {
        expect(isDeniedPath(".npmrc")).toBe(true);
        expect(isDeniedPath(".netrc")).toBe(true);
        expect(isDeniedPath("gcp/serviceaccount.json")).toBe(true);
        expect(isDeniedPath("serviceaccount-prod.json")).toBe(true);
        expect(isDeniedPath("vault.kdbx")).toBe(true);
        expect(isDeniedPath("key.asc")).toBe(true);
        expect(isDeniedPath("backup.gpg")).toBe(true);
    });

    it("allows ordinary source and docs files", () => {
        expect(isDeniedPath("src/index.ts")).toBe(false);
        expect(isDeniedPath("README.md")).toBe(false);
        expect(isDeniedPath("package.json")).toBe(false);
        expect(isDeniedPath("environment.ts")).toBe(false);
        expect(isDeniedPath("keyboard.ts")).toBe(false);
        expect(isDeniedPath("docs/authentication.md")).toBe(false);
    });
});

describe("buildHygieneManifest", () => {
    it("keeps only denied paths, sorted", () => {
        const manifest = buildHygieneManifest([
            wf("src/index.ts"),
            wf("z/.env"),
            wf(".env"),
            wf("README.md"),
            wf("config/credentials.json"),
        ]);
        expect(manifest.deniedPaths).toEqual([".env", "config/credentials.json", "z/.env"]);
    });

    it("produces an empty manifest for a clean listing", () => {
        const manifest = buildHygieneManifest([wf("src/a.ts"), wf("docs/b.md")]);
        expect(manifest.deniedPaths).toEqual([]);
    });
});

describe("makeDeniedSet", () => {
    it("answers membership for exactly the manifest paths", () => {
        const manifest = buildHygieneManifest([wf(".env"), wf("src/index.ts"), wf("id_rsa")]);
        const denied = makeDeniedSet(manifest);
        expect(denied.has(".env")).toBe(true);
        expect(denied.has("id_rsa")).toBe(true);
        expect(denied.has("src/index.ts")).toBe(false);
        expect(denied.size).toBe(2);
    });
});
