/**
 * What the flowchart UI is told about a pointer on the canvas. See `index.ts`.
 */

import type { Point, PortId } from "../model/types";

/** Where a pointer is: on the board, and on the stage (CSS px from its top-left). */
export interface CanvasPoint {
    world: Point;
    screen: Point;
}

/** An arrow dragged out of a box and let go over empty space. */
export interface ConnectDrop extends CanvasPoint {
    /** The box the arrow was dragged out of. */
    sourceId: string;
    /** The dot (or side) it left by. */
    port: PortId | null;
}
