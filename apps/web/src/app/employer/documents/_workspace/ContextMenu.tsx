"use client";

import {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
    IconCheck,
    IconChevronRight,
    IconCopy,
    IconEye,
    IconFolder,
    IconPen,
    IconPlus,
    IconSparkle,
    IconTrash,
} from "./icons";
import { placeMenu, placeSubmenu } from "./placeMenu";
import type { SourceContextMenuItem } from "./sourceContextMenu";
import styles from "./ContextMenu.module.css";

export type { SourceContextMenuItem };

export interface ContextMenuProps {
    open: boolean;
    x: number;
    y: number;
    items: SourceContextMenuItem[];
    onClose: () => void;
    ariaLabel?: string;
}

type MenuIconName = NonNullable<
    Extract<SourceContextMenuItem, { type: "item" | "submenu" }>["icon"]
>;

/** Mirrors `min-width` in ContextMenu.module.css; used for submenu placement math. */
const MENU_MIN_WIDTH = 228;
const SUBMENU_OPEN_DELAY_MS = 120;

function iconFor(name: MenuIconName | undefined): ReactNode {
    switch (name) {
        case "open":
            return <IconEye size={13} />;
        case "ask":
            return <IconSparkle size={13} />;
        case "rename":
            return <IconPen size={13} />;
        case "copy":
            return <IconCopy size={13} />;
        case "delete":
            return <IconTrash size={13} />;
        case "folder":
            return <IconFolder size={13} />;
        case "plus":
            return <IconPlus size={13} />;
        case "check":
            return <IconCheck size={13} />;
        default:
            return null;
    }
}

function actionableItems(items: SourceContextMenuItem[]): SourceContextMenuItem[] {
    return items.filter(item => item.type === "item" || item.type === "submenu");
}

function portalRoot(): HTMLElement {
    return document.querySelector(".lsw-root") ?? document.body;
}

export function ContextMenu({
    open,
    x,
    y,
    items,
    onClose,
    ariaLabel = "Actions",
}: ContextMenuProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted || !open || items.length === 0) return null;
    return createPortal(
        <ContextMenuLayer x={x} y={y} items={items} onClose={onClose} ariaLabel={ariaLabel} />,
        portalRoot()
    );
}

function ContextMenuLayer({ x, y, items, onClose, ariaLabel }: Omit<ContextMenuProps, "open">) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x, top: y });
    const [activeId, setActiveId] = useState<string | null>(null);
    const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
    const labelId = useId();
    const actionables = useMemo(() => actionableItems(items), [items]);

    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const next = placeMenu({
            x,
            y,
            width: el.offsetWidth,
            height: el.offsetHeight,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        });
        setPos(next);
    }, [x, y, items]);

    useEffect(() => {
        menuRef.current?.focus();
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                if (openSubmenuId) {
                    setOpenSubmenuId(null);
                    return;
                }
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, openSubmenuId]);

    const moveActive = useCallback(
        (delta: number) => {
            if (actionables.length === 0) return;
            const current = actionables.findIndex(item => item.id === activeId);
            const start = current === -1 ? (delta > 0 ? -1 : 0) : current;
            const next = (start + delta + actionables.length) % actionables.length;
            setActiveId(actionables[next]!.id);
            const item = actionables[next]!;
            setOpenSubmenuId(item.type === "submenu" ? item.id : null);
        },
        [actionables, activeId]
    );

    const activate = useCallback(
        (item: SourceContextMenuItem) => {
            if (item.type === "item") {
                if (item.disabled) return;
                item.onSelect();
                onClose();
                return;
            }
            if (item.type === "submenu" && !item.disabled) {
                setOpenSubmenuId(item.id);
                setActiveId(item.id);
            }
        },
        [onClose]
    );

    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            moveActive(1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveActive(-1);
        } else if (e.key === "Home") {
            e.preventDefault();
            setActiveId(actionables[0]?.id ?? null);
        } else if (e.key === "End") {
            e.preventDefault();
            setActiveId(actionables[actionables.length - 1]?.id ?? null);
        } else if (e.key === "ArrowRight") {
            const current = actionables.find(item => item.id === activeId);
            if (current?.type === "submenu" && !current.disabled) {
                e.preventDefault();
                setOpenSubmenuId(current.id);
            }
        } else if (e.key === "ArrowLeft") {
            if (openSubmenuId) {
                e.preventDefault();
                setOpenSubmenuId(null);
            }
        } else if (e.key === "Enter" || e.key === " ") {
            const current = actionables.find(item => item.id === activeId);
            if (current) {
                e.preventDefault();
                activate(current);
            }
        }
    };

    return (
        <div
            className={styles.layer}
            data-testid="context-menu-backdrop"
            onMouseDown={e => {
                if (e.target === e.currentTarget) onClose();
            }}
            onContextMenu={e => {
                e.preventDefault();
                onClose();
            }}
        >
            <MenuPanel
                ref={menuRef}
                labelledBy={labelId}
                ariaLabel={ariaLabel}
                items={items}
                left={pos.left}
                top={pos.top}
                activeId={activeId}
                openSubmenuId={openSubmenuId}
                onHover={(id, item) => {
                    setActiveId(id);
                    if (item?.type === "submenu" && !item.disabled) {
                        setOpenSubmenuId(item.id);
                    } else if (item?.type === "item") {
                        setOpenSubmenuId(null);
                    }
                }}
                onActivate={activate}
                onKeyDown={onKeyDown}
                parentPos={pos}
            />
        </div>
    );
}

interface MenuPanelProps {
    items: SourceContextMenuItem[];
    left: number;
    top: number;
    activeId: string | null;
    openSubmenuId: string | null;
    labelledBy?: string;
    ariaLabel?: string;
    onHover: (id: string | null, item: SourceContextMenuItem | null) => void;
    onActivate: (item: SourceContextMenuItem) => void;
    onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
    parentPos: { left: number; top: number };
    nested?: boolean;
}

// Named MenuPanelImpl, not MenuPanel: a named function expression binds its own
// name inside its body, so the recursive <MenuPanel> below would resolve to this
// raw (props, ref) render function instead of the forwardRef component.
const MenuPanel = forwardRef<HTMLDivElement, MenuPanelProps>(function MenuPanelImpl(
    {
        items,
        left,
        top,
        activeId,
        openSubmenuId,
        labelledBy,
        ariaLabel,
        onHover,
        onActivate,
        onKeyDown,
        parentPos,
        nested,
    },
    ref
) {
    const submenuTimer = useRef<number | null>(null);
    const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        return () => {
            if (submenuTimer.current != null) window.clearTimeout(submenuTimer.current);
        };
    }, []);

    const openSubmenu = items.find(
        (item): item is Extract<SourceContextMenuItem, { type: "submenu" }> =>
            item.type === "submenu" && item.id === openSubmenuId && !item.disabled
    );

    let submenuPos = { left: left + MENU_MIN_WIDTH, top };
    if (openSubmenu) {
        const trigger = itemRefs.current[openSubmenu.id];
        const offsetTop = trigger ? trigger.offsetTop : 0;
        submenuPos = placeSubmenu({
            parentLeft: parentPos.left,
            parentTop: parentPos.top,
            parentWidth: trigger?.offsetWidth ?? MENU_MIN_WIDTH,
            itemOffsetTop: offsetTop,
            width: MENU_MIN_WIDTH,
            height: Math.min(openSubmenu.items.length * 32 + 8, 320),
            viewportWidth: typeof window === "undefined" ? 1280 : window.innerWidth,
            viewportHeight: typeof window === "undefined" ? 800 : window.innerHeight,
        });
    }

    return (
        <>
            <div
                ref={ref}
                role="menu"
                tabIndex={nested ? -1 : 0}
                aria-label={ariaLabel}
                aria-labelledby={labelledBy}
                data-testid={nested ? "context-submenu" : "context-menu"}
                onKeyDown={onKeyDown}
                onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
                className={styles.menu}
                style={{
                    left,
                    top,
                    zIndex: nested ? 202 : 201,
                }}
            >
                {items.map(item => {
                    if (item.type === "separator") {
                        return (
                            <div
                                key={item.id}
                                role="separator"
                                data-testid={`context-menu-sep-${item.id}`}
                                className={styles.separator}
                            />
                        );
                    }
                    if (item.type === "label") {
                        return (
                            <div
                                key={item.id}
                                id={labelledBy}
                                data-testid={`context-menu-label-${item.id}`}
                                title={item.label}
                                className={styles.label}
                            >
                                {item.label}
                            </div>
                        );
                    }

                    const disabled = Boolean(item.disabled);
                    const danger = item.type === "item" && item.danger;
                    const active = item.id === activeId && !disabled;
                    const icon = iconFor(item.icon);
                    const itemClass = [
                        styles.item,
                        active ? styles.itemActive : "",
                        danger ? styles.itemDanger : "",
                        disabled ? styles.itemDisabled : "",
                    ]
                        .filter(Boolean)
                        .join(" ");

                    return (
                        <div
                            key={item.id}
                            ref={node => {
                                itemRefs.current[item.id] = node;
                            }}
                            role="menuitem"
                            aria-disabled={disabled || undefined}
                            aria-haspopup={item.type === "submenu" ? "menu" : undefined}
                            aria-expanded={
                                item.type === "submenu" ? item.id === openSubmenuId : undefined
                            }
                            data-testid={`context-menu-item-${item.id}`}
                            title={
                                disabled && "disabledReason" in item
                                    ? item.disabledReason
                                    : item.label
                            }
                            onMouseEnter={() => {
                                if (submenuTimer.current != null) {
                                    window.clearTimeout(submenuTimer.current);
                                }
                                submenuTimer.current = window.setTimeout(() => {
                                    onHover(item.id, item);
                                }, SUBMENU_OPEN_DELAY_MS);
                            }}
                            onMouseLeave={() => {
                                if (submenuTimer.current != null) {
                                    window.clearTimeout(submenuTimer.current);
                                    submenuTimer.current = null;
                                }
                            }}
                            onMouseDown={(e: ReactMouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                onActivate(item);
                            }}
                            className={itemClass}
                        >
                            <span className={styles.itemIcon}>{icon}</span>
                            <span className={styles.itemLabel}>{item.label}</span>
                            {item.type === "item" && item.shortcut && (
                                <span className={`mono ${styles.itemShortcut}`}>
                                    {item.shortcut}
                                </span>
                            )}
                            {item.type === "submenu" && (
                                <IconChevronRight size={12} className={styles.itemChevron} />
                            )}
                        </div>
                    );
                })}
            </div>
            {openSubmenu && (
                <MenuPanel
                    nested
                    items={openSubmenu.items}
                    left={submenuPos.left}
                    top={submenuPos.top}
                    activeId={null}
                    openSubmenuId={null}
                    ariaLabel={openSubmenu.label}
                    onHover={() => undefined}
                    onActivate={onActivate}
                    parentPos={submenuPos}
                />
            )}
        </>
    );
});

MenuPanel.displayName = "MenuPanel";
