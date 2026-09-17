import type { ActionMenuIconName, ActionMenuItem } from "~/components/ui/action-menu";

/**
 * The context-menu layer, in three parts:
 *
 * - A **target** is what got right-clicked. Components declare one with
 *   `useContextTarget`; the provider reads the chain of targets under the
 *   pointer (innermost first) off the DOM.
 * - An **action** is a verb declared once, with `appliesTo` deciding which
 *   targets it belongs to. The same definition feeds the context menu, the
 *   command palette and keyboard shortcuts.
 * - The **resolver** turns a chain of targets plus the registered actions
 *   into one `ActionMenuItem[]` for the menu primitive to draw.
 */

/** The root every chain ends with: the fallback menu when nothing else applies. */
export const APP_TARGET_KIND = "app";
/** Synthetic overlay target for a text selection under the pointer. */
export const SELECTION_TARGET_KIND = "selection";
/** Synthetic overlay target for an `<a href>` under the pointer. */
export const LINK_TARGET_KIND = "link";

export type MenuVia = "pointer" | "keyboard" | "touch" | "button";

export interface TextSelectionInfo {
    text: string;
    /** The element the selection's common ancestor lives in. */
    container: Element | null;
}

export interface LinkInfo {
    href: string;
    text: string;
}

export interface MenuOpenContext {
    /** Where the menu opens, in viewport coordinates. */
    x: number;
    y: number;
    via: MenuVia;
    /** Every target from innermost outward, ending with the app root. */
    chain: ContextTarget[];
    /** Text selected under the pointer, when the click landed inside it. */
    selection: TextSelectionInfo | null;
    /** The DOM element the event landed on. */
    element: Element | null;
}

export interface ContextTarget<TData = unknown> {
    /** What was right-clicked: "source", "folder", "chat-message", … */
    kind: string;
    /** Stable id of the object, when it has one. */
    id?: string;
    /** Free-form payload actions may read: the source, the message, the row. */
    data?: TData;
    /** Accessible name for the menu when this is the primary target. */
    label?: string;
    /**
     * Items this target contributes. Called at open time so it sees fresh
     * state; return `[]` to contribute nothing.
     */
    items?: (ctx: MenuOpenContext) => ActionMenuItem[];
    /**
     * Also contribute (below a separator) when a target nested inside this one
     * is right-clicked. Off by default so a message menu is not buried under
     * its pane's verbs.
     */
    inherit?: boolean;
    /**
     * Intercept right-click inside inputs, textareas and contenteditable
     * regions within this target. Off by default: the browser's own menu
     * (spellcheck, paste) is usually better there.
     */
    editable?: boolean;
    /**
     * An overlay sits in front of the primary target without displacing it —
     * a text selection, a link. Overlays always contribute.
     */
    overlay?: boolean;
}

export type ActionLabel<TData = unknown> =
    | string
    | ((target: ContextTarget<TData>, ctx: MenuOpenContext) => string);

export interface ActionDefinition<TData = unknown> {
    /** Namespaced, stable: "source.rename", "chat.message.copy". */
    id: string;
    label: ActionLabel<TData>;
    icon?: ActionMenuIconName;
    shortcut?: string;
    /** Destructive: rendered last, after a separator, in the danger colour. */
    danger?: boolean;
    /** Lower first within a target's group; ties keep registration order. */
    order?: number;
    /** Which targets this action belongs to. */
    appliesTo: (target: ContextTarget, ctx: MenuOpenContext) => boolean;
    /** A reason the action cannot run right now; falsy means enabled. */
    disabled?: (target: ContextTarget<TData>, ctx: MenuOpenContext) => string | false | undefined;
    checked?: (target: ContextTarget<TData>, ctx: MenuOpenContext) => boolean;
    /** Renders as a submenu of these items instead of running. */
    children?: (target: ContextTarget<TData>, ctx: MenuOpenContext) => ActionMenuItem[];
    run: (target: ContextTarget<TData>, ctx: MenuOpenContext) => void | Promise<void>;
    /**
     * List in the command palette when the action applies to the palette's
     * ambient targets. Defaults to true.
     */
    palette?: boolean;
}

export type ContextMenuEvent =
    | { type: "open"; via: MenuVia; kind: string; itemCount: number }
    | { type: "pick"; via: MenuVia; kind: string; itemId: string }
    | { type: "dismiss"; via: MenuVia; kind: string };
