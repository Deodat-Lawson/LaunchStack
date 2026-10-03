import type { CSSProperties } from "react";

import type { LayoutNode, SplitAxis } from "./paneLayout";

/**
 * Where each pane and divider sits, worked out from the split tree.
 *
 * The centre does not nest its panes in the DOM the way the tree nests them.
 * Every pane is a sibling, absolutely placed from these frames, because
 * nesting would tie a pane's DOM to its place in the tree: splitting it would
 * wrap it in a new container, and React rebuilds what it wraps — detaching
 * the pane's node for a moment, which reloads any document frame in it
 * and resets every scroller. Siblings keyed by pane id only ever move.
 */

/** A rectangle as fractions of the centre: 0 to 1 on each axis. */
export interface Frame {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface DividerFrame {
    splitId: string;
    /** It sits between child `index` and child `index + 1`. */
    index: number;
    axis: SplitAxis;
    /** The split's own frame: what the divider spans, and is dragged within. */
    split: Frame;
    /** Its position along the axis, as a fraction of the centre. */
    at: number;
    /** The split's shares, as they are while this frame is current. */
    sizes: number[];
    /**
     * How deeply its split is nested. Where two dividers meet, the outer one
     * is drawn on top, so the junction grabs the split that spans the most.
     */
    depth: number;
}

export const FULL_FRAME: Frame = { left: 0, top: 0, width: 1, height: 1 };

/** Shares in flight while a divider is dragged, before they are committed. */
export interface SizesDraft {
    splitId: string;
    sizes: number[];
}

export function layoutFrames(
    root: LayoutNode,
    draft?: SizesDraft | null
): { panes: Map<string, Frame>; dividers: DividerFrame[] } {
    const panes = new Map<string, Frame>();
    const dividers: DividerFrame[] = [];
    const place = (node: LayoutNode, frame: Frame, depth: number) => {
        if (node.type === "pane") {
            panes.set(node.groupId, frame);
            return;
        }
        const sizes = draft && draft.splitId === node.id ? draft.sizes : node.sizes;
        let offset = 0;
        node.children.forEach((child, i) => {
            const share = sizes[i] ?? 0;
            place(
                child,
                node.axis === "row"
                    ? {
                          left: frame.left + frame.width * offset,
                          top: frame.top,
                          width: frame.width * share,
                          height: frame.height,
                      }
                    : {
                          left: frame.left,
                          top: frame.top + frame.height * offset,
                          width: frame.width,
                          height: frame.height * share,
                      },
                depth + 1
            );
            offset += share;
            if (i < node.children.length - 1) {
                dividers.push({
                    splitId: node.id,
                    index: i,
                    axis: node.axis,
                    split: frame,
                    at:
                        node.axis === "row"
                            ? frame.left + frame.width * offset
                            : frame.top + frame.height * offset,
                    sizes,
                    depth,
                });
            }
        });
    };
    place(root, FULL_FRAME, 0);
    return { panes, dividers };
}

/**
 * The shares after moving divider `index` by `delta` (a fraction of its
 * split). Only the two panes either side of it change, and neither goes
 * below `min` — also a fraction of the split — unless the pair together is
 * too small for that, when they meet in the middle.
 */
export function dragSizes(sizes: number[], index: number, delta: number, min: number): number[] {
    const first = sizes[index];
    const second = sizes[index + 1];
    if (first === undefined || second === undefined) return sizes;
    const pair = first + second;
    const floor = Math.min(min, pair / 2);
    const next = Math.min(pair - floor, Math.max(floor, first + delta));
    const out = [...sizes];
    out[index] = next;
    out[index + 1] = pair - next;
    return out;
}

const percent = (value: number) => `${(value * 100).toFixed(4)}%`;

export function frameStyle(frame: Frame): CSSProperties {
    return {
        left: percent(frame.left),
        top: percent(frame.top),
        width: percent(frame.width),
        height: percent(frame.height),
    };
}

export function dividerStyle(divider: DividerFrame): CSSProperties {
    // Above the panes (10 while zoomed), below drop zones (30); outer first.
    const zIndex = 25 - Math.min(divider.depth, 5);
    return divider.axis === "row"
        ? {
              left: percent(divider.at),
              top: percent(divider.split.top),
              height: percent(divider.split.height),
              zIndex,
          }
        : {
              top: percent(divider.at),
              left: percent(divider.split.left),
              width: percent(divider.split.width),
              zIndex,
          };
}
