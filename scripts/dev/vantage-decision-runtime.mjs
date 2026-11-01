/** Local-only frontend preview: existing synthetic DB, native auth, recorded replay. */
import { spawn } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    copyFileSync,
    symlinkSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseline =
    process.env.VANTAGE_DECISION_BASELINE ??
    "C:/Users/junku/orca/LaunchStack/test-output/vantage-action-first-20261028/source";
const fontBaseline =
    "C:/Users/junku/orca/LaunchStack/test-output/vantage-joseph-integration-20261026/source";
const runtime = resolve(root, "test-output/vantage-context-demo/runtime");
const mode = process.argv[2];
process.env.VANTAGE_CONTEXT_DEMO_DB_PORT = "55438";
const { childEnvironment, parsePassword } = await import("./vantage-integration-tl-test.mjs");

function dependencies(source, destination) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const from = join(source, entry.name),
            to = join(destination, entry.name);
        if (existsSync(to)) continue;
        if (entry.name === "@launchstack") {
            mkdirSync(to, { recursive: true });
            for (const name of readdirSync(from)) {
                const target = resolve(root, relative(baseline, realpathSync(join(from, name))));
                symlinkSync(target, join(to, name), "junction");
            }
        } else if (entry.name.startsWith("@")) dependencies(from, to);
        else if (entry.isDirectory() || entry.isSymbolicLink()) symlinkSync(from, to, "junction");
        else copyFileSync(from, to);
    }
}

if (mode === "--prepare") {
    const dirs = [
        "",
        "apps/web",
        "pipelines",
        ...readdirSync(resolve(root, "packages")).map(x => `packages/${x}`),
    ];
    for (const dir of dirs) {
        const from = resolve(baseline, dir, "node_modules");
        if (existsSync(from)) dependencies(from, resolve(root, dir, "node_modules"));
    }
    mkdirSync(runtime, { recursive: true });
    for (const name of ["credentials.json", "fixture.json", "tl-test.env.local"]) {
        if (!existsSync(resolve(runtime, name)))
            copyFileSync(
                resolve(baseline, "test-output/vantage-context-demo/runtime", name),
                resolve(runtime, name)
            );
    }
    console.log(
        "Prepared dependency junctions and retained synthetic fixture/auth files. No install or database write."
    );
    process.exit(0);
}
if (!["--serve", "--check"].includes(mode)) throw new Error("Use --prepare, --check, or --serve");
for (const dir of [root, resolve(root, "apps/web")]) {
    if (
        readdirSync(dir).some(x =>
            /^\.env(?:$|\.(?:local|development|production|test)(?:\.local)?$)/.test(x)
        )
    )
        throw new Error("Refusing dotenv files");
}
const password = parsePassword(readFileSync(resolve(runtime, "tl-test.env.local"), "utf8"));
const env = childEnvironment(password);
const secret = JSON.parse(readFileSync(resolve(runtime, "credentials.json"), "utf8"));
const fixture = JSON.parse(readFileSync(resolve(runtime, "fixture.json"), "utf8"));
const web = resolve(root, "apps/web");
// Reuse the actual original font files, with no Google stylesheet/font request.
const chunks = resolve(fontBaseline, "apps/web/.next/static/chunks");
const fonts = {};
for (const [family, prefix] of [
    ["Inter", "[next]_internal_font_google_inter_"],
    ["JetBrains", "[next]_internal_font_google_jetbrains_mono_"],
]) {
    const file = readdirSync(chunks).find(name => name.startsWith(prefix) && name.endsWith(".css"));
    if (!file) throw new Error("Original cached font CSS unavailable");
    fonts[family] = [
        ...readFileSync(resolve(chunks, file), "utf8").matchAll(/@font-face\s*\{[^}]*\}/g),
    ]
        .map(match => match[0])
        .filter(face => face.includes("src: url("))
        .join("\n")
        .replaceAll(/\.\.\/media\/([^"')]+)/g, (_, name) =>
            resolve(fontBaseline, "apps/web/.next/static/media", name)
                .replaceAll("\\", "/")
                .replace(/^[A-Za-z]:/, "")
        )
        .replaceAll(/url\("([^"]+)"\)/g, "url($1)");
}
const fontResponses = resolve(runtime, "offline-font-responses.cjs");
writeFileSync(
    fontResponses,
    `const fonts=${JSON.stringify(fonts)}; module.exports=new Proxy({}, {get:(_,url)=>typeof url==='string' ? fonts[url.includes('JetBrains')?'JetBrains':'Inter'] : undefined});\n`
);
const requireWeb = createRequire(resolve(web, "package.json"));
const postgres = requireWeb("postgres");
const sql = postgres(env.DATABASE_URL, { connect_timeout: 3, max: 1 });
try {
    const rows = await sql`select current_database() as name`;
    if (rows[0]?.name !== "vantage_week2_tl_contract_v1") throw new Error("Unexpected database");
    console.log(
        "Existing loopback synthetic PostgreSQL reachable; no migrations or seed executed."
    );
} catch {
    throw new Error(
        "Existing synthetic PostgreSQL 127.0.0.1:55438 is unavailable; no reset or fallback performed"
    );
} finally {
    await sql.end({ timeout: 1 });
}
if (mode === "--check") process.exit(0);
Object.assign(env, {
    NODE_ENV: "development",
    TZ: "America/New_York",
    BETTER_AUTH_URL: "http://localhost:3111",
    APP_PUBLIC_URL: "http://localhost:3111",
    BETTER_AUTH_SECRET: secret.authSecret,
    EMBEDDING_SECRETS_KEY: secret.embeddingSecretsKey,
    VANTAGE_CONTEXT_DEMO_ENABLED: "true",
    VANTAGE_CONTEXT_DEMO_JOSEPH_ENABLED: "true",
    VANTAGE_CONTEXT_DEMO_FIXTURE: resolve(runtime, "fixture.json"),
    VANTAGE_CONTEXT_DEMO_CREDENTIALS: resolve(runtime, "credentials.json"),
    VANTAGE_CONTEXT_DEMO_AS_OF: fixture.weeks.at(-1).asOf,
    VANTAGE_CONTEXT_DEMO_APP_PORT: "3111",
    VANTAGE_CONTEXT_DEMO_GENERATION_MODE: "replay",
    VANTAGE_TEST_MODE: "true",
    VANTAGE_TEST_COMPANY_ID: fixture.companyId,
    VANTAGE_TEST_USER_IDS: fixture.actorId,
    NEXT_TELEMETRY_DISABLED: "1",
    DEPLOYMENT_MODE: "self-hosted",
    NEXT_PUBLIC_STORAGE_PROVIDER: "database",
    LANGCHAIN_TRACING_V2: "false",
    INNGEST_DEV: "1",
    LOG_LEVEL: "warn",
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontResponses,
});
console.log("Action sample: http://localhost:3111/dev/vantage-action-sample");
console.log(
    "Original Joseph demo: http://localhost:3111/dev/vantage-context; native synthetic authentication; no worker or provider."
);
const child = spawn(
    process.execPath,
    [requireWeb.resolve("next/dist/bin/next"), "dev", "--hostname", "localhost", "--port", "3111"],
    { cwd: web, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
);
const sensitive = [
    env.DATABASE_URL,
    password,
    secret.authSecret,
    secret.loginPassword,
    secret.embeddingSecretsKey,
];
for (const [stream, target] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
]) {
    stream.on("data", data => {
        let text = data.toString();
        for (const value of sensitive.filter(Boolean))
            text = text.split(value).join("[local-secret-redacted]");
        target.write(text);
    });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("exit", code => {
    process.exitCode = code ?? 1;
});
