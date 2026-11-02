import { createHash } from "node:crypto";
/** Build the checked-in recorded Windows demo. Does not start the product or connect to services. */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web");
const demo = join(root, "apps/vantage-demo");
const out = join(demo, "recorded");
const require = createRequire(join(web, "package.json"));
const rootRequire = createRequire(join(root, "package.json"));
const esbuild = rootRequire(
    rootRequire.resolve("esbuild", { paths: [dirname(rootRequire.resolve("tsx/package.json"))] })
);
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const loadConfig = require("tailwindcss/loadConfig");
const sha = data => createHash("sha256").update(data).digest("hex");
const snapshot = JSON.parse(await readFile(join(demo, "source-ui-snapshot.json"), "utf8"));
async function verifyUiSnapshot() {
    for (const file of snapshot.files)
        if (sha((await readFile(join(root, file.path), "utf8")).replaceAll("\r\n", "\n")) !== file.sha256)
            throw new Error("Polished UI snapshot changed: " + file.path);
}
await verifyUiSnapshot();
await mkdir(out, { recursive: true });
const result = await esbuild.build({
    entryPoints: [join(demo, "src/main.tsx")],
    outfile: join(out, "app.js"),
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    target: ["chrome110", "edge110"],
    jsx: "automatic",
    tsconfig: join(web, "tsconfig.json"),
    alias: { "~": join(web, "src") },
    nodePaths: [join(web, "node_modules"), join(root, "node_modules")],
    loader: { ".woff2": "file", ".ttf": "file" },
    assetNames: "assets/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    logLevel: "warning",
});
const forbidden = Object.keys(result.metafile.inputs).filter(p =>
    /server\/|store\/src|\.env|9499/.test(p.replaceAll("\\", "/"))
);
if (forbidden.length) throw new Error("Unexpected server/config import: " + forbidden.join(","));
const config = loadConfig(join(web, "tailwind.config.ts"));
config.content = Object.keys(result.metafile.inputs)
    .filter(p => /\.[tj]sx?$/.test(p))
    .map(p => resolve(root, p));
const tokens = await readFile(join(root, "packages/design-tokens/tokens.css"), "utf8");
const globals = await readFile(join(web, "src/styles/globals.css"), "utf8");
const css = await postcss([tailwind(config), require("autoprefixer")]).process(
    tokens + "\n" + globals,
    { from: join(web, "src/styles/globals.css"), map: false }
);
await writeFile(join(out, "base.css"), css.css, "utf8");
await writeFile(
    join(out, "index.html"),
    '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Vantage - Recorded Synthetic Demo</title><link rel="icon" href="./icon.svg"><link rel="stylesheet" href="./base.css"><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
    "utf8"
);
await writeFile(
    join(demo, "bundle-inputs.json"),
    JSON.stringify(
        {
            recordedSyntheticOnly: true,
            sourceSnapshot: "source-ui-snapshot.json",
            files: Object.keys(result.metafile.inputs)
                .map(p => relative(root, resolve(root, p)).replaceAll("\\", "/"))
                .sort(),
        },
        null,
        2
    ) + "\n"
);
console.log("Built portable recorded demo at " + relative(root, out));

await cp(join(web, "public/icon.svg"), join(out, "icon.svg"));
await cp(join(demo, "src/fonts"), join(out, "licenses"), {
    recursive: true,
    filter: source => !source.endsWith(".ttf"),
});

await verifyUiSnapshot();
const extras = [
    "packages/design-tokens/tokens.css",
    "apps/web/src/styles/globals.css",
    "apps/web/tailwind.config.ts",
    "apps/web/public/icon.svg",
    "pnpm-lock.yaml",
    "apps/vantage-demo/source-ui-snapshot.json",
];
for (const name of await readdir(join(demo, "src/fonts")))
    extras.push("apps/vantage-demo/src/fonts/" + name);
const sourceInputs = [...new Set([...Object.keys(result.metafile.inputs), ...extras])].filter(
    p => !p.includes("node_modules")
);
await writeFile(
    join(demo, "bundle-inputs.json"),
    JSON.stringify(
        {
            recordedSyntheticOnly: true,
            sourceSnapshot: "source-ui-snapshot.json",
            files: await Promise.all(
                sourceInputs
                    .sort()
                    .map(async p => ({
                        path: p.replaceAll("\\", "/"),
                        sha256: sha(await readFile(resolve(root, p))),
                    }))
            ),
        },
        null,
        2
    ) + "\n"
);
async function listFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Bundle contains a link");
        const p = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await listFiles(p)));
        else files.push(p);
    }
    return files;
}
const allowed = new Set([
    ...Object.keys(result.metafile.outputs).map(p =>
        relative(out, resolve(root, p)).replaceAll("\\", "/")
    ),
    "base.css",
    "index.html",
    "icon.svg",
    "bundle-manifest.json",
]);
for (const name of await readdir(join(demo, "src/fonts"))) if (!name.endsWith(".ttf")) allowed.add("licenses/" + name);
const files = [];
for (const file of await listFiles(out)) {
    const path = relative(out, file).replaceAll("\\", "/");
    if (!allowed.has(path))
        throw new Error("Unexpected file in portable bundle; retained for review: " + path);
    if (path === "bundle-manifest.json") continue;
    const bytes = await readFile(file);
    files.push({ path, sha256: sha(bytes), bytes: bytes.length });
}
await writeFile(
    join(out, "bundle-manifest.json"),
    JSON.stringify(
        {
            schemaVersion: "vantage-portable-bundle/v1",
            files: files.sort((a, b) => a.path.localeCompare(b.path)),
        },
        null,
        2
    ) + "\n"
);
console.log("Verified " + files.length + " portable bundle files; polished source hashes match.");
