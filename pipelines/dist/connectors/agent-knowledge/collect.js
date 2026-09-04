/**
 * Reading half of the connector: turns discovered files into
 * `KnowledgeItem`s with contents and a content hash.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describeError } from "./discover.js";
export function hashContent(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
/**
 * A NUL byte means the file is a binary that happens to sit under an
 * allowlisted path with a text extension — not knowledge. `readFile` with
 * `utf8` would hand back mojibake rather than fail, so check explicitly.
 */
function looksBinary(content) {
    return content.includes("\u0000");
}
export async function readKnowledgeItem(item) {
    let raw;
    try {
        raw = await readFile(item.location.origin, "utf8");
    }
    catch (error) {
        return { sourceId: item.sourceId, reason: "unreadable", detail: describeError(error) };
    }
    if (looksBinary(raw)) {
        return { sourceId: item.sourceId, reason: "excluded", detail: "binary content" };
    }
    const content = raw.replace(/\r\n/g, "\n").trim();
    if (content.length === 0) {
        return { sourceId: item.sourceId, reason: "empty" };
    }
    return { ...item, content, contentHash: hashContent(content) };
}
function isSkipped(value) {
    return "reason" in value;
}
/** Read every discovered item, keeping failures as skips rather than throwing. */
export async function collectAgentKnowledge(discovered) {
    const items = [];
    const skipped = [];
    for (const candidate of discovered) {
        const result = await readKnowledgeItem(candidate);
        if (isSkipped(result))
            skipped.push(result);
        else
            items.push(result);
    }
    return { items, skipped };
}
//# sourceMappingURL=collect.js.map