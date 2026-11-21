import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLongDocuments } from "./vantage-long-documents.mjs";
import { loadCorpus } from "./vantage-sample-documents.mjs";

test("fixed-seed long corpus stays bounded and evidence is deep in canonical text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vantage-long-"));
    try {
        await generateLongDocuments(directory);
        const first = await loadCorpus(directory);
        await generateLongDocuments(directory);
        const second = await loadCorpus(directory);
        assert.equal(first.documents.length, 50);
        assert.deepEqual(
            first.documents.map(doc => doc.versions.map(version => version.hash)),
            second.documents.map(doc => doc.versions.map(version => version.hash))
        );
        assert.equal(first.documents.filter(doc => doc.restricted).length, 1);
        const expectations = JSON.parse(
            await readFile(
                new URL(
                    "../../docs/samples/vantage/harborlight-long/expectations.json",
                    import.meta.url
                ),
                "utf8"
            )
        );
        for (const testCase of expectations.cases) {
            for (const anchor of testCase.anchors) {
                const version = first.documents
                    .find(doc => doc.key === anchor.key)
                    .versions.find(version => version.versionNumber === anchor.versionNumber);
                const position = version.text.indexOf(anchor.quote) / version.text.length;
                assert.ok(position >= 0.4 && position <= 0.7, `${testCase.id}: ${position}`);
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
