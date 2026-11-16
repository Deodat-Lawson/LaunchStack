/** Explicit download command; import/check modes are offline and never load .env. */
import { readFile, writeFile, realpath, access } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { importPinnedCsv, serializePilot, sha256, sourceLock } from "./rag-multi-corpus";
import { parseCsv } from "./csv";

async function main() {
    const { values } = parseArgs({
        options: {
            download: { type: "string" },
            input: { type: "string" },
            output: { type: "string" },
            "source-sample": { type: "string" },
            count: { type: "string" },
            duplicates: { type: "string" },
            check: { type: "boolean" },
            help: { type: "boolean" },
        },
    });
    if (values.help) {
        console.log(
            "Download: --download <existing directory outside repository>\nOffline import: --input <queries.csv> --output <pilot.json> [--source-sample <sample.csv>] [--count 20] [--duplicates reject|merge-identical] [--check]\nOutput files must not exist unless --check is used. Check compares bytes without writing."
        );
        return;
    }
    if (values.download) {
        if (Object.keys(values).length !== 1)
            throw new Error("Download cannot be combined with import options.");
        const directory = await realpath(values.download);
        const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
        const offset = relative(repository, directory);
        if (!offset || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)))
            throw new Error("Download directory must be outside the repository.");
        const files = [
            ["queries.csv", sourceLock.files.queries],
            ["LICENSE", sourceLock.files.license],
            ["README.md", sourceLock.files.readme],
        ] as const;
        for (const [name] of files) await requireAbsent(join(directory, name));
        for (const [name, pinned] of files) {
            const response = await fetch(pinned.url, {
                signal: AbortSignal.timeout(30000),
                redirect: "error",
            });
            if (!response.ok)
                throw new Error(`Download failed for ${name}: HTTP ${response.status}.`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (sha256(bytes) !== pinned.sha256) throw new Error(`SHA-256 mismatch for ${name}.`);
            await writeFile(join(directory, name), bytes, { flag: "wx" });
            console.log(`Downloaded and verified ${name} (${bytes.length} bytes).`);
        }
        return;
    }
    if (!values.input || !values.output) throw new Error("Use --input and --output, or --help.");
    const count = values.count === undefined ? 20 : Number(values.count);
    if (!Number.isSafeInteger(count) || count < 1)
        throw new Error("--count must be a positive integer.");
    const policy = values.duplicates ?? "reject";
    if (policy !== "reject" && policy !== "merge-identical")
        throw new Error("--duplicates must be reject or merge-identical.");
    const bytes = await readFile(values.input);
    const pilot = importPinnedCsv(bytes, count, policy);
    const outputs: [string, string][] = [[values.output, serializePilot(pilot)]];
    if (values["source-sample"]) {
        const wanted = new Set(
            pilot.cases.flatMap(item => item.sourceRecords.map(row => row.recordNumber))
        );
        const records = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const sample = records.filter(
            row => row.recordNumber === 1 || wanted.has(row.recordNumber)
        );
        // Re-encode CSV transport only. Every decoded field, including raw facts JSON, stays identical.
        outputs.push([
            values["source-sample"],
            sample
                .map(row => row.cells.map(cell => `"${cell.replaceAll('"', '""')}"`).join(","))
                .join("\n") + "\n",
        ]);
    }
    if (new Set(outputs.map(([path]) => resolve(path))).size !== outputs.length)
        throw new Error("Output paths must be distinct.");
    for (const [path] of outputs) {
        if (resolve(path) === resolve(values.input)) throw new Error("Input cannot be an output.");
        if (!values.check) await requireAbsent(path);
    }
    for (const [path, content] of outputs) {
        if (values.check) {
            if ((await readFile(path, "utf8")) !== content)
                throw new Error(`Reproduction mismatch: ${path}`);
        } else await writeFile(path, content, { flag: "wx" });
    }
    console.log(
        JSON.stringify(
            {
                action: values.check ? "verified" : "imported",
                revision: sourceLock.revision,
                ...pilot.selection,
            },
            null,
            2
        )
    );
}

async function requireAbsent(path: string) {
    try {
        await access(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    throw new Error(`Refusing to overwrite existing file: ${path}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : "Benchmark import failed.");
    process.exitCode = 1;
});
