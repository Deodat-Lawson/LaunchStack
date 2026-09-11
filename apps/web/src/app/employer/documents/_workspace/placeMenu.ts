/**
 * Viewport-aware placement for floating menus. Pure so tests can pin the
 * overflow cases without mounting a DOM.
 */

export interface MenuPoint {
    left: number;
    top: number;
}

const DEFAULT_PAD = 8;

export function placeMenu(opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    pad?: number;
}): MenuPoint {
    const pad = opts.pad ?? DEFAULT_PAD;
    let left = opts.x;
    let top = opts.y;
    if (left + opts.width > opts.viewportWidth - pad) {
        left = opts.viewportWidth - opts.width - pad;
    }
    if (top + opts.height > opts.viewportHeight - pad) {
        top = opts.viewportHeight - opts.height - pad;
    }
    return {
        left: Math.max(pad, left),
        top: Math.max(pad, top),
    };
}

export function placeSubmenu(opts: {
    parentLeft: number;
    parentTop: number;
    parentWidth: number;
    itemOffsetTop: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    pad?: number;
}): MenuPoint {
    const pad = opts.pad ?? DEFAULT_PAD;
    let left = opts.parentLeft + opts.parentWidth - 4;
    if (left + opts.width > opts.viewportWidth - pad) {
        left = opts.parentLeft - opts.width + 4;
    }
    let top = opts.parentTop + opts.itemOffsetTop;
    if (top + opts.height > opts.viewportHeight - pad) {
        top = opts.viewportHeight - opts.height - pad;
    }
    return {
        left: Math.max(pad, left),
        top: Math.max(pad, top),
    };
}
