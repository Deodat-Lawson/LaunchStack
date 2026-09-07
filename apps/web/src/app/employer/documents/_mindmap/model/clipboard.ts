/**
 * Copy / cut / paste.
 *
 * The payload is written to the system clipboard as JSON text so a copy in one
 * tab pastes in another (and into a plain text editor, where it is at least
 * legible). An in-memory buffer backs it up for browsers or contexts where
 * clipboard permission is denied.
 */

import { makeId } from "./factory";
import type { DiagramEdge, DiagramNode, Point } from "./types";

export const CLIPBOARD_MIME = "application/x-launchstack-mindmap";
const MAGIC = "launchstack/mindmap@1";

export interface ClipboardPayload {
    magic: typeof MAGIC;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    /** Top-left of the copied selection, so paste can offset from the cursor. */
    origin: Point;
}

let memoryBuffer: ClipboardPayload | null = null;

export function buildPayload(
    nodes: readonly DiagramNode[],
    edges: readonly DiagramEdge[]
): ClipboardPayload {
    const origin = nodes.length
        ? {
              x: Math.min(...nodes.map(nd => nd.x)),
              y: Math.min(...nodes.map(nd => nd.y)),
          }
        : { x: 0, y: 0 };
    return {
        magic: MAGIC,
        nodes: nodes.map(nd => ({ ...nd })),
        edges: edges.map(e => ({ ...e })),
        origin,
    };
}

export async function writeClipboard(payload: ClipboardPayload): Promise<void> {
    memoryBuffer = payload;
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(JSON.stringify(payload));
        }
    } catch {
        // Permission denied or insecure context — the memory buffer still works
        // inside this tab, which is the overwhelmingly common case.
    }
}

export function parsePayload(text: string): ClipboardPayload | null {
    try {
        const parsed: unknown = JSON.parse(text);
        if (
            parsed &&
            typeof parsed === "object" &&
            (parsed as ClipboardPayload).magic === MAGIC &&
            Array.isArray((parsed as ClipboardPayload).nodes)
        ) {
            return parsed as ClipboardPayload;
        }
    } catch {
        // Not our JSON — the caller falls back to treating it as plain text.
    }
    return null;
}

export async function readClipboard(): Promise<ClipboardPayload | null> {
    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            const parsed = parsePayload(text);
            if (parsed) return parsed;
        }
    } catch {
        // Fall through to the in-memory buffer.
    }
    return memoryBuffer;
}

export function memoryClipboard(): ClipboardPayload | null {
    return memoryBuffer;
}

/**
 * Re-key a payload for insertion: fresh ids everywhere, `parentId` and edge
 * endpoints remapped, and the whole block translated by `offset`.
 *
 * A connector whose endpoint shape was not part of the copy is dropped. The
 * alternative — keeping the original `nodeId` — silently wires the pasted copy
 * back to the source diagram's shape, or dangles at an id that does not exist
 * in the target document at all.
 */
export function instantiate(
    payload: ClipboardPayload,
    offset: Point
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
    const idMap = new Map<string, string>();
    for (const nd of payload.nodes) idMap.set(nd.id, makeId("n"));

    const nodes = payload.nodes.map(nd => ({
        ...nd,
        id: idMap.get(nd.id)!,
        x: nd.x + offset.x,
        y: nd.y + offset.y,
        parentId: nd.parentId ? (idMap.get(nd.parentId) ?? null) : null,
        style: { ...nd.style },
        textStyle: { ...nd.textStyle },
        ...(nd.data ? { data: { ...nd.data } } : {}),
    }));

    const edges: DiagramEdge[] = [];
    for (const e of payload.edges) {
        const from = remapEnd(e.from, idMap, offset);
        const to = remapEnd(e.to, idMap, offset);
        if (!from || !to) continue;
        edges.push({
            ...e,
            id: makeId("e"),
            from,
            to,
            waypoints: e.waypoints.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })),
            style: { ...e.style },
            textStyle: { ...e.textStyle },
            labels: e.labels.map(l => ({ ...l })),
        });
    }

    return { nodes, edges };
}

/** `null` when the endpoint cannot be expressed inside the pasted block. */
function remapEnd(
    end: DiagramEdge["from"],
    idMap: Map<string, string>,
    offset: Point
): DiagramEdge["from"] | null {
    if (end.nodeId) {
        const mapped = idMap.get(end.nodeId);
        return mapped ? { ...end, nodeId: mapped } : null;
    }
    if (end.point) {
        return { port: end.port, point: { x: end.point.x + offset.x, y: end.point.y + offset.y } };
    }
    return null;
}
