import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildGroups, validateGroupRequests } from "./vantage-rag-build-groups.mjs";

const requests = Array.from({ length: 40 }, (_, index) => ({
    caseId: String(index + 1),
    enterprise: index < 20 ? "Alpha" : "Beta",
    workspaceId: index < 20 ? "1" : "2",
    question: `Question ${index + 1}?`,
}));

test("each size forms its maximal enterprise-local disjoint partition", () => {
    const { groups, inventory } = buildGroups(requests);
    assert.equal(groups.length, 20);
    for (const size of [3, 5]) {
        for (const enterprise of ["Alpha", "Beta"]) {
            const partition = groups.filter(
                group => group.enterprise === enterprise && group.topics.length === size
            );
            assert.equal(partition.length, Math.floor(20 / size));
            const ordinals = partition.flatMap(group => group.topics.map(topic => topic.caseId));
            assert.equal(new Set(ordinals).size, partition.length * size);
            for (const group of partition) {
                assert.match(group.groupId, new RegExp(`^g${size}-[a-f0-9]{64}$`));
                assert.deepEqual(Object.keys(group), [
                    "groupId",
                    "enterprise",
                    "workspaceId",
                    "topics",
                ]);
                for (const topic of group.topics) {
                    const original = requests.find(request => request.caseId === topic.caseId);
                    assert.equal(original.enterprise, group.enterprise);
                    assert.equal(original.workspaceId, group.workspaceId);
                    assert.equal(original.question, topic.question);
                }
            }
        }
    }
    assert.deepEqual(
        inventory.partitions.map(partition => partition.droppedOrdinals.length),
        [2, 2, 0, 0]
    );
});

test("membership is stable under input reordering and question wording changes", () => {
    const original = buildGroups(requests);
    assert.deepEqual(buildGroups([...requests].reverse()), original);
    const changed = buildGroups(
        requests.map(request => ({ ...request, question: "Different question wording?" }))
    );
    assert.deepEqual(
        changed.groups.map(group => group.groupId),
        original.groups.map(group => group.groupId)
    );
    // Independently computed with Python hashlib over compact UTF-8 JSON tuples.
    assert.deepEqual(
        original.groups[0].topics.map(topic => topic.caseId),
        ["18", "5", "2"]
    );
    assert.equal(
        original.groups[0].groupId,
        "g3-79af7fe8ee06a710cfd44472aa6ffa62d1b0abaec607b393f5e311e8167f5083"
    );
    assert.deepEqual(original.inventory.partitions[0].droppedOrdinals, ["19", "6"]);
});

test("insufficient remainders are never pooled across enterprises or group sizes", () => {
    const result = buildGroups([requests[0], requests[1], requests[2], requests[20], requests[21]]);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].enterprise, "Alpha");
    assert.equal(result.groups[0].topics.length, 3);
    assert.deepEqual(
        result.inventory.partitions.map(partition => partition.droppedOrdinals.length),
        [0, 2, 3, 2]
    );
});

test("strict label-free fields, unique ordinals and consistent workspaces are required", () => {
    assert.throws(() => validateGroupRequests([]), /EMPTY_OR_INVALID/);
    for (const change of [
        { groundTruth: "forbidden" },
        { expectations: [] },
        { caseId: "01" },
        { caseId: "9007199254740992" },
        { question: " " },
        { workspaceId: "0" },
    ])
        assert.throws(
            () => validateGroupRequests([{ ...requests[0], ...change }]),
            /FIELDS_INVALID/
        );
    assert.throws(() => validateGroupRequests([requests[0], requests[0]]), /ORDINAL_DUPLICATED/);
    assert.throws(
        () => validateGroupRequests([requests[0], { ...requests[1], workspaceId: "2" }]),
        /WORKSPACE_MISMATCH/
    );
});

test("CLI writes exclusive external files with accurate hashes and no question inventory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vantage-group-design-"));
    try {
        const input = join(directory, "input.json");
        const output = join(directory, "groups.json");
        const inventory = join(directory, "inventory.json");
        await writeFile(input, JSON.stringify(requests));
        const cli = fileURLToPath(new URL("./vantage-rag-build-groups.mjs", import.meta.url));
        const args = [cli, "--input", input, "--output", output, "--inventory", inventory];
        const first = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });
        assert.equal(first.status, 0, first.stderr);
        const bytes = await readFile(output);
        const metadata = JSON.parse(await readFile(inventory, "utf8"));
        assert.equal(metadata.groupsSha256, createHash("sha256").update(bytes).digest("hex"));
        assert.equal(
            metadata.inputSha256,
            createHash("sha256")
                .update(await readFile(input))
                .digest("hex")
        );
        assert.equal(JSON.stringify(metadata).includes("Question 1?"), false);
        const repeated = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });
        assert.notEqual(repeated.status, 0);
        assert.deepEqual(await readFile(output), bytes);
        const insideRepo = fileURLToPath(
            new URL("../../group-design-must-not-write.json", import.meta.url)
        );
        const denied = spawnSync(
            process.execPath,
            [
                cli,
                "--input",
                input,
                "--output",
                insideRepo,
                "--inventory",
                join(directory, "denied.json"),
            ],
            { encoding: "utf8", windowsHide: true }
        );
        assert.notEqual(denied.status, 0);
        await assert.rejects(access(insideRepo));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
