import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    selectHeldoutMetadata,
    buildHeldoutRequests,
    questionIdentity,
    requestMetadata,
} from "./vantage-rag-build-heldout.mjs";
import { buildGroups } from "./vantage-rag-build-groups.mjs";

const id = text => "rag-multi-corpus:" + createHash("sha256").update(text).digest("hex");
const enterprises = ["A", "B", "C", "D", "E"];
const prior = enterprises.flatMap(enterprise =>
    Array.from({ length: 20 }, (_, index) => ({
        id: id(`prior-${enterprise}-${index}`),
        enterprise,
        question: `Earlier item ${enterprise} ${index}?`,
    }))
);
const fresh = enterprises.flatMap(enterprise =>
    Array.from({ length: 25 }, (_, index) => ({
        id: id(`fresh-${enterprise}-${index}`),
        enterprise,
        question: `Unused item ${enterprise} ${index}?`,
    }))
);
const all = [...prior, ...fresh];

test("held-out sample excludes all prior canonical identities and question-equivalent variants", () => {
    const variant = {
        id: id("variant"),
        enterprise: "A",
        question: prior[0].question.toUpperCase().replaceAll(" ", " \n ").replace("?", "!"),
    };
    const result = selectHeldoutMetadata([...all, variant], prior);
    assert.equal(result.selected.length, 100);
    assert.equal(result.proof.excludedCanonicalIds, 100);
    assert.equal(result.proof.excludedQuestionEquivalence, 1);
    assert.equal(result.proof.canonicalIdOverlap, 0);
    assert.equal(result.proof.questionEquivalenceOverlap, 0);
    const previousIds = new Set(prior.map(item => item.id));
    const previousQuestions = new Set(prior.map(questionIdentity));
    assert.ok(
        result.selected.every(
            item => !previousIds.has(item.id) && !previousQuestions.has(questionIdentity(item))
        )
    );
    assert.equal(new Set(result.selected.map(questionIdentity)).size, 100);
    for (const enterprise of enterprises)
        assert.equal(result.selected.filter(item => item.enterprise === enterprise).length, 20);
});

test("selection and exclusion proof are invariant under source/prior reordering", () => {
    assert.deepEqual(
        selectHeldoutMetadata(all, prior),
        selectHeldoutMetadata([...all].reverse(), [...prior].reverse())
    );
});

test("request builder receives strict label-free metadata and grouping stays unchanged", () => {
    const selection = selectHeldoutMetadata(all, prior);
    const map = new Map(enterprises.map((enterprise, index) => [enterprise, String(index + 1)]));
    const projected = selection.selected.map(item =>
        requestMetadata({ ...item, groundTruth: "must be stripped" })
    );
    const requests = buildHeldoutRequests(projected, map);
    assert.deepEqual(
        requests.map(item => item.caseId),
        Array.from({ length: 100 }, (_, index) => String(index + 1))
    );
    assert.ok(
        requests.every(
            item => Object.keys(item).sort().join(",") === "caseId,enterprise,question,workspaceId"
        )
    );
    assert.throws(
        () => buildHeldoutRequests([{ ...projected[0], groundTruth: "forbidden" }], map),
        /METADATA_INVALID/
    );
    const grouping = buildGroups(requests);
    assert.equal(grouping.groups.filter(group => group.topics.length === 3).length, 30);
    assert.equal(grouping.groups.filter(group => group.topics.length === 5).length, 20);
    assert.equal(
        grouping.inventory.partitions.reduce(
            (sum, partition) => sum + partition.droppedOrdinals.length,
            0
        ),
        10
    );
});

test("duplicate identities, mismatched prior source and insufficient pools fail closed", () => {
    assert.throws(() => selectHeldoutMetadata([...all, all[0]], prior), /DUPLICATE_CANONICAL_ID/);
    assert.throws(
        () =>
            selectHeldoutMetadata(all, [{ ...prior[0], question: "Modified?" }, ...prior.slice(1)]),
        /PRIOR_NOT_IN_PINNED_SOURCE/
    );
    assert.throws(
        () =>
            selectHeldoutMetadata(
                all.filter(item => item.enterprise !== "E" || prior.includes(item)),
                prior
            ),
        /INSUFFICIENT_ENTERPRISE_POOL/
    );
    assert.throws(() => selectHeldoutMetadata(all, prior.slice(1)), /FIVE_BY_TWENTY/);
});
