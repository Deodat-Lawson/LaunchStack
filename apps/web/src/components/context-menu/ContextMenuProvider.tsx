"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { ActionMenu, type ActionMenuItem } from "~/components/ui/action-menu";
import {
    APP_TARGET_KIND,
    LINK_TARGET_KIND,
    SELECTION_TARGET_KIND,
    TARGET_ATTR,
    isEditableElement,
    linkAt,
    listActions,
    resolveMenu,
    targetChainFor,
    textSelectionAt,
    type ContextMenuEvent,
    type ContextTarget,
    type MenuOpenContext,
    type MenuVia,
} from "~/lib/context-menu";
import { buildAppActions } from "./appActions";
import { useRegisterActions } from "./useRegisterActions";

/**
 * One listener for the whole app. Right-click, Shift+F10 / the Menu key, and
 * a long-press all resolve the target chain under the pointer and open the
 * same menu. Surfaces declare targets (`useContextTarget`) and actions
 * (`useRegisterActions`); "⋯" buttons open the menu imperatively through
 * `useActionMenu`.
 *
 * What is deliberately left to the browser: Shift+right-click (always native),
 * inputs and textareas unless a target opted in with `editable`, and any
 * right-click for which nothing resolves.
 */

export interface OpenMenuRequest {
    x: number;
    y: number;
    items: ActionMenuItem[];
    ariaLabel?: string;
    via?: MenuVia;
    /** Target kind, for telemetry. */
    kind?: string;
}

export interface ActionMenuApi {
    open: (request: OpenMenuRequest) => void;
    close: () => void;
    /**
     * Opens the menu for whatever targets are declared on `element` and its
     * ancestors, exactly as a right-click there would. Returns false when
     * nothing resolves.
     */
    openFor: (element: Element | null, point: { x: number; y: number }, via?: MenuVia) => boolean;
}

interface OpenMenu {
    x: number;
    y: number;
    items: ActionMenuItem[];
    ariaLabel: string;
    via: MenuVia;
    kind: string;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;
/** How far a touch-opened menu sits from the finger, so it does not open under it. */
const TOUCH_OFFSET_PX = 10;
/** Keyboard opens hang the menu just inside the focused element's left edge. */
const KEYBOARD_INSET_PX = 16;

const MenuContext = createContext<ActionMenuApi | null>(null);

export function useActionMenu(): ActionMenuApi {
    const api = useContext(MenuContext);
    if (!api) {
        throw new Error("useActionMenu must be used within a ContextMenuProvider");
    }
    return api;
}

/** The api, or null outside a provider — for components that also render in isolation. */
export function useOptionalActionMenu(): ActionMenuApi | null {
    return useContext(MenuContext);
}

export interface ContextMenuProviderProps {
    children: ReactNode;
    /** Sink for open / pick / dismiss events. Nothing is recorded without one. */
    onEvent?: (event: ContextMenuEvent) => void;
}

export function ContextMenuProvider({ children, onEvent }: ContextMenuProviderProps) {
    const [menu, setMenu] = useState<OpenMenu | null>(null);
    const menuRef = useRef<OpenMenu | null>(null);
    menuRef.current = menu;
    const pickedRef = useRef(false);
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;
    const emit = useCallback((event: ContextMenuEvent) => onEventRef.current?.(event), []);

    const { theme, setTheme } = useTheme();
    useRegisterActions(
        useMemo(() => buildAppActions({ current: theme, set: setTheme }), [theme, setTheme])
    );

    const open = useCallback(
        (request: OpenMenuRequest) => {
            const via = request.via ?? "button";
            const kind = request.kind ?? "custom";
            pickedRef.current = false;
            const items = instrument(request.items, itemId => {
                pickedRef.current = true;
                emit({ type: "pick", via, kind, itemId });
            });
            if (items.length === 0) return;
            setMenu({
                x: request.x,
                y: request.y,
                items,
                ariaLabel: request.ariaLabel ?? "Actions",
                via,
                kind,
            });
            emit({ type: "open", via, kind, itemCount: items.length });
        },
        [emit]
    );

    const close = useCallback(() => {
        const current = menuRef.current;
        if (!current) return;
        if (!pickedRef.current) emit({ type: "dismiss", via: current.via, kind: current.kind });
        setMenu(null);
    }, [emit]);

    const openFor = useCallback(
        (element: Element | null, point: { x: number; y: number }, via: MenuVia = "pointer") => {
            const { targets } = targetChainFor(element);
            const editable = isEditableElement(element);
            if (editable && !targets.some(t => t.editable)) return false;

            const chain: ContextTarget[] = [];
            const selection = editable ? null : textSelectionAt(element, point);
            if (selection) {
                chain.push({
                    kind: SELECTION_TARGET_KIND,
                    overlay: true,
                    data: selection,
                    label: "Selection",
                });
            }
            const link = linkAt(element);
            if (link) chain.push({ kind: LINK_TARGET_KIND, overlay: true, data: link });
            chain.push(...targets, { kind: APP_TARGET_KIND });

            const ctx: MenuOpenContext = { x: point.x, y: point.y, via, chain, selection, element };
            const { items, ariaLabel } = resolveMenu(ctx, listActions());
            if (items.length === 0) return false;
            const primary =
                targets[0]?.kind ??
                (link ? LINK_TARGET_KIND : selection ? SELECTION_TARGET_KIND : APP_TARGET_KIND);
            open({ x: point.x, y: point.y, items, ariaLabel, via, kind: primary });
            return true;
        },
        [open]
    );

    useEffect(() => {
        let pressTimer: number | null = null;
        let press: { x: number; y: number; target: Element | null } | null = null;
        // A long-press opens the menu; the contextmenu/click the browser fires
        // afterwards for the same touch must not open it again or pick an item.
        let suppressUntil = 0;

        const cancelPress = () => {
            if (pressTimer != null) window.clearTimeout(pressTimer);
            pressTimer = null;
            press = null;
        };

        const onContextMenu = (e: MouseEvent) => {
            if (Date.now() < suppressUntil) {
                e.preventDefault();
                return;
            }
            if (e.defaultPrevented || e.shiftKey) return;
            const element = e.target instanceof Element ? e.target : null;
            if (openFor(element, { x: e.clientX, y: e.clientY }, "pointer")) e.preventDefault();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || menuRef.current) return;
            const isMenuKey = e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
            if (!isMenuKey) return;
            const active =
                document.activeElement instanceof Element ? document.activeElement : null;
            const anchor = active?.closest(`[${TARGET_ATTR}]`) ?? active;
            const rect = anchor?.getBoundingClientRect();
            const point = rect
                ? { x: Math.min(rect.left + KEYBOARD_INSET_PX, rect.right), y: rect.bottom }
                : { x: KEYBOARD_INSET_PX, y: KEYBOARD_INSET_PX };
            if (openFor(active, point, "keyboard")) e.preventDefault();
        };

        const onPointerDown = (e: PointerEvent) => {
            if (e.pointerType !== "touch" || !e.isPrimary) return;
            cancelPress();
            press = {
                x: e.clientX,
                y: e.clientY,
                target: e.target instanceof Element ? e.target : null,
            };
            pressTimer = window.setTimeout(() => {
                const current = press;
                cancelPress();
                if (!current) return;
                const opened = openFor(
                    current.target,
                    { x: current.x + TOUCH_OFFSET_PX, y: current.y + TOUCH_OFFSET_PX },
                    "touch"
                );
                if (opened) suppressUntil = Date.now() + 700;
            }, LONG_PRESS_MS);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!press || e.pointerType !== "touch") return;
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX) {
                cancelPress();
            }
        };
        const onPointerEnd = (e: PointerEvent) => {
            if (e.pointerType === "touch") cancelPress();
        };
        const onClick = (e: MouseEvent) => {
            if (Date.now() < suppressUntil) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        document.addEventListener("contextmenu", onContextMenu);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerEnd);
        document.addEventListener("pointercancel", onPointerEnd);
        document.addEventListener("click", onClick, true);
        return () => {
            cancelPress();
            document.removeEventListener("contextmenu", onContextMenu);
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerEnd);
            document.removeEventListener("pointercancel", onPointerEnd);
            document.removeEventListener("click", onClick, true);
        };
    }, [openFor]);

    const api = useMemo<ActionMenuApi>(() => ({ open, close, openFor }), [open, close, openFor]);

    return (
        <MenuContext.Provider value={api}>
            {children}
            {menu && (
                <ActionMenu
                    open
                    x={menu.x}
                    y={menu.y}
                    items={menu.items}
                    ariaLabel={menu.ariaLabel}
                    onClose={close}
                />
            )}
        </MenuContext.Provider>
    );
}

/** Wraps every selectable item so a pick is reported before it runs. */
function instrument(items: ActionMenuItem[], onPick: (id: string) => void): ActionMenuItem[] {
    return items.map(item => {
        if (item.type === "item") {
            const { onSelect } = item;
            return {
                ...item,
                onSelect: () => {
                    onPick(item.id);
                    onSelect();
                },
            };
        }
        if (item.type === "submenu") {
            return { ...item, items: instrument(item.items, onPick) };
        }
        return item;
    });
}
