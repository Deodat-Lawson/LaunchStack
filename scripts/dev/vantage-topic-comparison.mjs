// Evaluation boundary. Providers and corpus generation never import this module.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function evaluateFrozenEvidence(snapshot, imported, expectations) {
    const sources = snapshot.sources;
    const belongs = (source, version) => {
        if (source.ref === version.ref || source.ref.startsWith(`${version.ref}#`)) return true;
        const dependencies = snapshot.scopedEvidence ?? [];
        return dependencies.some(
            parent =>
                String(parent.parentVersion) === String(version.id) &&
                parent.units.some(unit => unit.ref === source.ref)
        );
    };
    const documents = imported.documents.filter(document =>
        document.versions.some(version => sources.some(source => belongs(source, version)))
    );
    return {
        documents: documents.map(document => document.key),
        fullDocumentCount: sources.filter(source => source.ref.startsWith("doc:")).length,
        excerptCount: sources.filter(source => source.ref.startsWith("unit:")).length,
        excerpts: sources.map(source => {
            const document = imported.documents.find(document =>
                document.versions.some(version => belongs(source, version))
            );
            const version = document?.versions.find(version => belongs(source, version));
            const proof = (snapshot.scopedEvidence ?? []).find(parent =>
                parent.units.some(unit => unit.ref === source.ref)
            );
            const unit = proof?.units.find(unit => unit.ref === source.ref);
            return {
                ref: source.ref,
                documentKey: document?.key,
                version: version?.version,
                kind: unit ? "excerpt" : "full_document",
                start: unit?.start ?? 0,
                end: unit?.end ?? source.text.length,
                characters: source.text.length,
                bytes: Buffer.byteLength(source.text, "utf8"),
                purpose: source.purpose,
            };
        }),
        frozenBytes: sources.reduce(
            (total, source) => total + Buffer.byteLength(source.text, "utf8"),
            0
        ),
        cases: expectations.cases.map(testCase => ({
            id: testCase.id,
            anchors: testCase.anchors.map(anchor => {
                const document = imported.documents.find(item => item.key === anchor.key);
                const version = document?.versions.find(
                    item => item.version === anchor.versionNumber
                );
                return {
                    key: anchor.key,
                    version: anchor.versionNumber,
                    present:
                        !!version &&
                        sources.some(
                            source => belongs(source, version) && source.text.includes(anchor.quote)
                        ),
                };
            }),
        })),
    };
}

// Inputs are six captured real-path frozen snapshots, each paired with its own import map.
// Format [{fixture, arm, snapshotFile, importFile, expectationsFile}].
export async function compareCapturedRuns(runListFile, outputFile) {
    const runs = JSON.parse(await readFile(runListFile, "utf8"));
    const output = [];
    for (const run of runs) {
        const [snapshot, imported, expectations] = await Promise.all(
            [run.snapshotFile, run.importFile, run.expectationsFile].map(async file =>
                JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""))
            )
        );
        output.push({
            fixture: run.fixture,
            arm: run.arm,
            ...evaluateFrozenEvidence(snapshot, imported, expectations),
        });
    }
    await writeFile(outputFile, JSON.stringify(output, null, 2) + "\n");
    return output;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    if (process.argv.length !== 4)
        throw new Error("Pass captured run list JSON and output JSON paths");
    await compareCapturedRuns(process.argv[2], process.argv[3]);
}
