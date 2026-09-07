#!/usr/bin/env node
/**
 * Regenerates THIRD_PARTY_LICENSES.md from the real dependency graphs.
 *
 * A hand-written attribution file is wrong the day after it is written: this
 * repository ships ~1,300 third-party runtime packages across five build
 * targets, and every `pnpm add` changes the set. So the file is generated, and
 * the generator is the thing under review.
 *
 * Sources, one per distributed component:
 *
 *   workspace  `pnpm licenses list --prod --json` — everything bundled into
 *              the app and worker images that CI pushes to GHCR.
 *   converter  services/document-converter/package-lock.json, dev entries
 *              excluded via npm's own `dev: true` marking.
 *   python     `pip install --dry-run --report` per service. Requires network
 *              and a Python 3.12+ interpreter; pass --skip-python to reuse the
 *              cached reports in scripts/licenses/cache/ instead.
 *
 * Usage:
 *   node scripts/licenses/generate-attributions.mjs
 *   node scripts/licenses/generate-attributions.mjs --skip-python
 *   node scripts/licenses/generate-attributions.mjs --check   # CI: fail on drift
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CACHE = join(HERE, "cache");
const OUT = join(ROOT, "THIRD_PARTY_LICENSES.md");

const args = new Set(process.argv.slice(2));
const SKIP_PYTHON = args.has("--skip-python");
const CHECK = args.has("--check");

const PYTHON_SERVICES = ["adeu-ai-docs-editing", "transcription"];

/**
 * Licenses that impose obligations beyond "keep the notice", or that offer a
 * choice one has to make deliberately. These get called out by name rather
 * than folded into a count — the whole point of the audit is that a reader can
 * see them without reading 1,300 rows.
 */
const NEEDS_ATTENTION = /GPL|MPL|EUPL|CDDL|EPL|CPL|OSL|SSPL|BUSL|Commons Clause/i;

function sh(cmd, cmdArgs, opts = {}) {
    return execFileSync(cmd, cmdArgs, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        ...opts,
    });
}

function readJson(path, fallback = null) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return fallback;
    }
}

// --- collectors --------------------------------------------------------------

/** Workspace prod dependencies — the contents of the GHCR images. */
function collectWorkspace() {
    let raw;
    try {
        raw = sh("pnpm", ["licenses", "list", "--prod", "--json"]);
    } catch (err) {
        // pnpm exits non-zero when it finds unknown licenses; the JSON is
        // still on stdout and is exactly what we want to report.
        raw = err.stdout?.toString() ?? "";
    }
    const parsed = raw ? JSON.parse(raw) : {};
    const packages = [];
    for (const [license, entries] of Object.entries(parsed)) {
        for (const entry of entries) {
            packages.push({
                name: entry.name,
                version: Array.isArray(entry.versions) ? entry.versions.join(", ") : entry.version,
                license,
                homepage: entry.homepage ?? null,
                author: entry.author ?? null,
            });
        }
    }
    return dedupe(packages);
}

/** document-converter runtime dependencies, from its own lockfile. */
function collectConverter() {
    const lock = readJson(join(ROOT, "services", "document-converter", "package-lock.json"));
    if (!lock?.packages) return [];
    const packages = [];
    for (const [path, meta] of Object.entries(lock.packages)) {
        if (!path.startsWith("node_modules/")) continue;
        if (meta.dev) continue; // npm marks dev-only subtrees; trust it
        packages.push({
            name: path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
            version: meta.version ?? "",
            license: meta.license || "Unknown",
            homepage: null,
            author: null,
        });
    }
    return dedupe(packages);
}

/** Python service closures, resolved without installing anything. */
function collectPython(service) {
    const cached = join(CACHE, `${service}.json`);

    if (!SKIP_PYTHON) {
        mkdirSync(CACHE, { recursive: true });
        const req = join(ROOT, "services", service, "requirements.txt");
        const full = join(CACHE, `.${service}.raw.json`);
        try {
            // A throwaway venv keeps the resolution honest: resolving against
            // an environment that already has the packages reports an empty
            // install set.
            const venv = join(CACHE, `.venv-${service}`);
            if (!existsSync(venv)) sh("python3", ["-m", "venv", venv]);
            sh(join(venv, "bin", "pip"), [
                "install",
                "-q",
                "--disable-pip-version-check",
                "--dry-run",
                "--report",
                full,
                "-r",
                req,
            ]);
            // pip's report is ~900 KB per service, nearly all of it metadata
            // this generator never reads. Cache only the fields it uses, so
            // the committed artifact stays reviewable.
            const raw = readJson(full);
            if (raw?.install) {
                writeFileSync(
                    cached,
                    JSON.stringify(
                        {
                            _note: `Trimmed 'pip install --dry-run --report' for services/${service}. Regenerate with scripts/licenses/generate-attributions.mjs.`,
                            packages: raw.install.map(item => {
                                const m = item.metadata ?? {};
                                return {
                                    name: m.name,
                                    version: m.version ?? "",
                                    license: normalizePythonLicense(m),
                                };
                            }),
                        },
                        null,
                        1
                    ) + "\n"
                );
                rmSync(full, { force: true });
            }
        } catch (err) {
            console.warn(`  ! could not resolve ${service}: ${err.message.split("\n")[0]}`);
        }
    }

    const report = readJson(cached);
    if (!report?.packages) {
        console.warn(`  ! no cached report for ${service}; section will be empty`);
        return [];
    }

    return dedupe(
        report.packages.map(p => ({
            name: p.name,
            version: p.version ?? "",
            license: p.license || "Unknown",
            homepage: null,
            author: null,
        }))
    );
}

/**
 * pip reports carry the license three different ways depending on how old the
 * package's metadata is: a PEP 639 expression, trove classifiers, or a free
 * text blob that is sometimes the entire license.
 */
function normalizePythonLicense(meta) {
    if (meta.license_expression) return meta.license_expression;

    const classifiers = (meta.classifiers ?? []).filter(c => c.startsWith("License ::"));
    if (classifiers.length) {
        return classifiers.map(c => c.split("::").pop().trim()).join("; ");
    }

    const raw = (meta.license ?? "").trim();
    if (!raw) return "Unknown";
    const firstLine = raw.split("\n")[0].trim();
    // A full license text in the field: report the identifier, not the blob.
    return firstLine.length > 64 ? "See package metadata" : firstLine;
}

function dedupe(packages) {
    const byKey = new Map();
    for (const p of packages) {
        if (!p.name) continue;
        const key = `${p.name}@${p.version}`;
        if (!byKey.has(key)) byKey.set(key, p);
    }
    return [...byKey.values()].sort((a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    );
}

// --- rendering ---------------------------------------------------------------

function summarize(packages) {
    const counts = new Map();
    for (const p of packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderSummaryTable(packages) {
    const rows = summarize(packages).map(
        ([license, count]) => `| ${license} | ${count} |`
    );
    return ["| License | Packages |", "| --- | ---: |", ...rows].join("\n");
}

function renderAttention(packages) {
    const flagged = packages.filter(p => NEEDS_ATTENTION.test(p.license));
    if (!flagged.length) return "_None._";
    const byLicense = new Map();
    for (const p of flagged) {
        if (!byLicense.has(p.license)) byLicense.set(p.license, []);
        byLicense.get(p.license).push(`${p.name}@${p.version}`);
    }
    return [...byLicense.entries()]
        .sort()
        .map(([license, names]) => `- **${license}** — ${names.sort().join(", ")}`)
        .join("\n");
}

function renderInventory(packages) {
    const rows = packages.map(p => `| \`${p.name}\` | ${p.version} | ${p.license} |`);
    return ["| Package | Version | License |", "| --- | --- | --- |", ...rows].join("\n");
}

function section(title, blurb, packages) {
    return [
        `## ${title}`,
        "",
        blurb,
        "",
        `**${packages.length} runtime packages.**`,
        "",
        renderSummaryTable(packages),
        "",
        "### Requires attention",
        "",
        renderAttention(packages),
        "",
        "<details>",
        "<summary>Full inventory</summary>",
        "",
        renderInventory(packages),
        "",
        "</details>",
    ].join("\n");
}

// --- main --------------------------------------------------------------------

console.log("collecting…");
console.log("  workspace (app + worker images)");
const workspace = collectWorkspace();
console.log("  document-converter");
const converter = collectConverter();
const python = {};
for (const svc of PYTHON_SERVICES) {
    console.log(`  ${svc}`);
    python[svc] = collectPython(svc);
}

const adeuLicense = readFileSync(join(HERE, "adeu-LICENSE.txt"), "utf8").trim();

const doc = `<!--
  GENERATED FILE — do not edit by hand.
  Regenerate with: node scripts/licenses/generate-attributions.mjs
  The generator, not this output, is the thing to review.
-->

# Third-Party Licenses

LaunchStack is licensed under [Apache-2.0](LICENSE). It bundles third-party
software whose licenses require that their copyright and permission notices
travel with any copy. This file carries those notices.

## What is distributed, and how

| Component | Distribution | Contents |
| --- | --- | --- |
| App image, worker image | Built and pushed to GHCR by \`.github/workflows/docker.yml\` | The pnpm workspace's production dependency tree |
| \`services/document-converter\` | Built from source by \`docker-compose.yml\` | Its own \`package-lock.json\` |
| \`services/adeu-ai-docs-editing\` | Built from source by \`docker-compose.yml\` | Its \`requirements.txt\` closure |
| \`services/transcription\` | Built from source by \`docker-compose.yml\` | Its \`requirements.txt\` closure |

Only the app and worker images are published as binaries. The service images
are built locally from this repository, so their dependencies are fetched by
the operator at build time rather than redistributed here — the notices are
included anyway, because the resulting image contains them and an operator who
passes that image on is distributing them.

## adeu

The DOCX redlining engine behind \`services/adeu-ai-docs-editing\`.
Repository: <https://github.com/dealfluence/adeu> · Homepage: <https://adeu.ai>

\`\`\`
${adeuLicense}
\`\`\`

${section(
    "App and worker images",
    "Everything in the pnpm workspace's production dependency tree, which is what CI builds into the two published images.",
    workspace
)}

${section(
    "services/document-converter",
    "Node service: routing, vision classification, PDF page rendering, and docling-backed conversion.",
    converter
)}

${section(
    "services/adeu-ai-docs-editing",
    "Python service: DOCX tracked-change editing, review-item enumeration, CriticMarkup preview, diffing.",
    python["adeu-ai-docs-editing"] ?? []
)}

${section(
    "services/transcription",
    "Python service: Whisper transcription and yt-dlp download. \`torch\` is installed from the PyTorch CPU wheel index, not PyPI (see the service Dockerfile).",
    python["transcription"] ?? []
)}

## License texts

The permissive licenses above (MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0,
0BSD, Unlicense, BlueOak-1.0.0) are reproduced by reference: each package's own
\`LICENSE\` file ships inside the image alongside its code, in
\`node_modules/<pkg>/\` or \`site-packages/<dist>-<version>.dist-info/\`. The
verbatim text for adeu is included above because this repository names it
explicitly as a core dependency.

## Known gaps

- Packages reported as \`Unknown\` declare their license in a non-standard
  \`package.json\` field (typically the pre-2015 \`licenses: [{type, url}]\`
  array) rather than having none. Most are transitive dependencies of the
  deprecated \`request\` package.
- Dual-licensed packages are listed with both options. Where one is permissive
  and one is copyleft — \`jszip\`, \`pizzip\`, \`dompurify\` — LaunchStack takes
  the permissive option.
- \`sharp\` bundles prebuilt \`libvips\` binaries under LGPL-3.0-or-later. They
  are used unmodified and dynamically loaded, which is the arrangement the LGPL
  is written for; a build that modifies libvips would take on further
  obligations.
- This file lists licenses, not a full SBOM. For vulnerability or provenance
  work, generate one from the lockfiles.
`;

if (CHECK) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current !== doc) {
        console.error(
            "\nTHIRD_PARTY_LICENSES.md is out of date.\n" +
                "Run: node scripts/licenses/generate-attributions.mjs"
        );
        process.exit(1);
    }
    console.log("\nTHIRD_PARTY_LICENSES.md is up to date.");
} else {
    writeFileSync(OUT, doc);
    const total =
        workspace.length +
        converter.length +
        Object.values(python).reduce((n, list) => n + list.length, 0);
    console.log(`\nwrote THIRD_PARTY_LICENSES.md (${total} package entries)`);
}
