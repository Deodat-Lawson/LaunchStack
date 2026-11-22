// Label-free experiment design. Only case ordinals and enterprise labels rank groups.
import { createHash } from "node:crypto";
import { access, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { externalOutput } from "./vantage-rag-multi-corpus-score.mjs";

export const GROUP_SEED = "vantage-contested-20261122";
export const GROUP_ALGORITHM = "enterprise-disjoint-sha256-tuples/1";
const sizes = [3, 5];
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const tupleHash = tuple => hash(JSON.stringify(tuple));

export function validateGroupRequests(requests) {
    if (!Array.isArray(requests) || requests.length === 0)
        throw new Error("GROUP_REQUESTS_EMPTY_OR_INVALID");
    const ordinals = new Set();
    const workspaces = new Map();
    for (const request of requests) {
        if (
            !request ||
            typeof request !== "object" ||
            Array.isArray(request) ||
            Object.keys(request).sort().join(",") !== "caseId,enterprise,question,workspaceId" ||
            typeof request.caseId !== "string" ||
            !/^[1-9]\d*$/.test(request.caseId) ||
            !Number.isSafeInteger(Number(request.caseId)) ||
            typeof request.enterprise !== "string" ||
            !request.enterprise.trim() ||
            request.enterprise.length > 200 ||
            typeof request.workspaceId !== "string" ||
            !/^[1-9]\d{0,17}$/.test(request.workspaceId) ||
            typeof request.question !== "string" ||
            !request.question.trim() ||
            request.question.length > 2000
        )
            throw new Error("GROUP_REQUEST_FIELDS_INVALID");
        if (ordinals.has(request.caseId)) throw new Error("GROUP_ORDINAL_DUPLICATED");
        ordinals.add(request.caseId);
        const previous = workspaces.get(request.enterprise);
        if (previous !== undefined && previous !== request.workspaceId)
            throw new Error("GROUP_ENTERPRISE_WORKSPACE_MISMATCH");
        workspaces.set(request.enterprise, request.workspaceId);
    }
}

export function buildGroups(requests) {
    validateGroupRequests(requests);
    const enterprises = [...new Set(requests.map(request => request.enterprise))].sort();
    const groups = [];
    const partitions = [];
    for (const size of sizes) {
        for (const enterprise of enterprises) {
            const ordered = requests
                .filter(request => request.enterprise === enterprise)
                .map(request => ({
                    request,
                    rank: tupleHash([GROUP_SEED, size, enterprise, request.caseId]),
                }))
                .sort((a, b) =>
                    a.rank < b.rank
                        ? -1
                        : a.rank > b.rank
                          ? 1
                          : Number(a.request.caseId) - Number(b.request.caseId)
                )
                .map(item => item.request);
            const retained = Math.floor(ordered.length / size) * size;
            for (let offset = 0; offset < retained; offset += size) {
                const members = ordered.slice(offset, offset + size);
                const caseIds = members.map(member => member.caseId);
                groups.push({
                    groupId: `g${size}-${tupleHash([GROUP_SEED, size, enterprise, caseIds])}`,
                    enterprise,
                    workspaceId: members[0].workspaceId,
                    topics: members.map(({ caseId, question }) => ({ caseId, question })),
                });
            }
            partitions.push({
                size,
                enterprise,
                inputQuestions: ordered.length,
                groupCount: retained / size,
                retainedQuestions: retained,
                droppedOrdinals: ordered.slice(retained).map(request => request.caseId),
            });
        }
    }
    return {
        groups,
        inventory: {
            algorithm: GROUP_ALGORITHM,
            seed: GROUP_SEED,
            rankEncoding: "SHA256(UTF8(JSON.stringify([seed,size,enterprise,caseId])))",
            groupIdEncoding:
                "g<size>-SHA256(UTF8(JSON.stringify([seed,size,enterprise,orderedCaseIds])))",
            ordering:
                "size ascending, enterprise UTF-16 ascending, rank hash ascending, ordinal numeric tie-break",
            inputQuestions: requests.length,
            groupCount: groups.length,
            topicAssignments: groups.reduce((sum, group) => sum + group.topics.length, 0),
            partitions,
        },
    };
}

async function requireAbsent(path) {
    try {
        await access(path);
        throw new Error("GROUP_OUTPUT_ALREADY_EXISTS");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            input: { type: "string" },
            output: { type: "string" },
            inventory: { type: "string" },
        },
    });
    if (!values.input || !values.output || !values.inventory)
        throw new Error("GROUP_INPUT_OUTPUT_INVENTORY_REQUIRED");
    const paths = [values.input, values.output, values.inventory].map(path => resolve(path));
    if (new Set(paths).size !== 3) throw new Error("GROUP_PATHS_MUST_DIFFER");
    await requireAbsent(paths[1]);
    await requireAbsent(paths[2]);
    const bytes = await readFile(paths[0]);
    const requests = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const { groups, inventory } = buildGroups(requests);
    const result = {
        ...inventory,
        inputSha256: hash(bytes),
        groupsSha256: hash(JSON.stringify(groups, null, 2) + "\n"),
    };
    // The existing evaluator helper rejects repository/Git paths and creates
    // files exclusively. Roll back our first output if the sidecar cannot write.
    await externalOutput(paths[1], groups);
    try {
        await externalOutput(paths[2], result);
    } catch (error) {
        await unlink(paths[1]);
        throw error;
    }
    console.log(JSON.stringify(result));
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(/^GROUP_[A-Z_]+$/.test(error.message) ? error.message : "GROUP_BUILD_FAILED");
        process.exitCode = 1;
    });
}
