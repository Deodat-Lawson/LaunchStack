"use client";

import { Component, type ReactNode } from "react";

export interface PaneDomState {
    focused: HTMLElement | null;
    scrolled: Array<{ element: HTMLElement; top: number; left: number }>;
}

export function capturePaneDomState(host: HTMLElement): PaneDomState {
    return {
        focused: host.contains(document.activeElement)
            ? (document.activeElement as HTMLElement)
            : null,
        scrolled: [host, ...host.querySelectorAll<HTMLElement>("*")]
            .filter(element => element.scrollTop || element.scrollLeft)
            .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })),
    };
}

export function restorePaneDomState(state: PaneDomState) {
    for (const { element, top, left } of state.scrolled) {
        element.scrollTop = top;
        element.scrollLeft = left;
    }
    // An explicit focus change (Ask AI focuses chat) wins. Restore only a
    // focus the DOM move dropped onto the body, and never a removed control.
    if (state.focused?.isConnected && document.activeElement === document.body) {
        state.focused.focus({ preventScroll: true });
    }
}

/**
 * React can remove a tab's old slot before the host's layout effect moves
 * its content to the new one. A detached scroller already reports zero, so
 * reading it in that effect is too late. This lifecycle runs before React
 * changes the DOM; the host restores the snapshot after the new slot exists.
 */
export class BeforePaneMutation extends Component<{
    placement: string;
    capture: () => void;
    children: ReactNode;
}> {
    getSnapshotBeforeUpdate(previous: Readonly<BeforePaneMutation["props"]>) {
        if (previous.placement !== this.props.placement) this.props.capture();
        return null;
    }

    componentDidUpdate() {
        // Required partner to getSnapshotBeforeUpdate. The workspace's layout
        // effect restores after it has attached the hosts to their new slots.
    }

    render() {
        return this.props.children;
    }
}
