"use client";

/**
 * A minimal anchored popover.
 *
 * Radix is already a dependency, but its focus management fights ProseMirror:
 * every menu that steals focus collapses the editor's selection, which is
 * exactly what a formatting menu must not do. This one never takes focus, and
 * closes on outside pointerdown or Escape.
 */

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "right-start";

const GAP = 6;
const MARGIN = 8;

export interface PopoverProps {
    anchor: HTMLElement | DOMRect | null;
    open: boolean;
    onClose: () => void;
    placement?: PopoverPlacement;
    children: ReactNode;
    className?: string;
    /** Elements that should not count as "outside" — e.g. the trigger. */
    ignore?: Array<HTMLElement | null>;
}

export function Popover({
    anchor,
    open,
    onClose,
    placement = "bottom-start",
    children,
    className,
    ignore = [],
}: PopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useLayoutEffect(() => {
        if (!open || !anchor) return;

        const place = () => {
            const element = ref.current;
            if (!element) return;
            const rect =
                anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
            const box = element.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let top =
                placement.startsWith("top")
                    ? rect.top - box.height - GAP
                    : placement === "right-start"
                      ? rect.top
                      : rect.bottom + GAP;
            let left =
                placement === "bottom-end"
                    ? rect.right - box.width
                    : placement === "right-start"
                      ? rect.right + GAP
                      : rect.left;

            // Flip rather than clip when the preferred side has no room.
            if (top + box.height > viewportHeight - MARGIN) {
                top = Math.max(MARGIN, rect.top - box.height - GAP);
            }
            if (left + box.width > viewportWidth - MARGIN) {
                left = Math.max(MARGIN, viewportWidth - box.width - MARGIN);
            }
            setPosition({ top: Math.max(MARGIN, top), left: Math.max(MARGIN, left) });
        };

        place();
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        return () => {
            window.removeEventListener("scroll", place, true);
            window.removeEventListener("resize", place);
        };
    }, [open, anchor, placement, children]);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (ref.current?.contains(target)) return;
            if (ignore.some((element) => element?.contains(target))) return;
            onClose();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };

        // Defer registration so the click that opened this does not close it.
        const timer = window.setTimeout(() => {
            document.addEventListener("mousedown", onPointerDown, true);
        }, 0);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("mousedown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
        // `ignore` is a fresh array each render; depending on it would
        // re-register the listeners on every parent render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, onClose]);

    if (!mounted || !open) return null;

    return createPortal(
        <div
            ref={ref}
            className={`ntn-popover${className ? ` ${className}` : ""}`}
            style={{
                position: "fixed",
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                visibility: position ? "visible" : "hidden",
            }}
            onMouseDown={(event) => {
                // Keep the editor selection alive while clicking menu items.
                event.preventDefault();
            }}
        >
            {children}
        </div>,
        document.body
    );
}

/** A single row in a popover menu. */
export function MenuItem({
    icon,
    label,
    hint,
    danger,
    active,
    onClick,
    disabled,
}: {
    icon?: ReactNode;
    label: ReactNode;
    hint?: ReactNode;
    danger?: boolean;
    active?: boolean;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            className={`ntn-menu__item${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
            onClick={onClick}
            disabled={disabled}
        >
            {icon ? <span className="ntn-menu__icon">{icon}</span> : null}
            <span className="ntn-menu__text">
                <span className="ntn-menu__title">{label}</span>
            </span>
            {hint ? <span className="ntn-menu__shortcut">{hint}</span> : null}
        </button>
    );
}

export function MenuDivider() {
    return <div className="ntn-menu__divider" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
    return <div className="ntn-menu__heading">{children}</div>;
}
