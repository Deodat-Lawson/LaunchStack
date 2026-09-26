import { cn } from "~/lib/utils";

/**
 * A keyboard shortcut, shown where its action is.
 *
 * The shortcuts are how most of this workspace is meant to be driven, and an
 * icon-only control hides them in a tooltip nobody hovers. The label is the
 * member's own binding (`formatKeys` of the resolved bindings), so a rebound
 * key shows as rebound; an unbound command shows nothing.
 */
export function ShortcutHint({
    keys,
    className,
}: {
    keys: string | null | undefined;
    className?: string;
}) {
    if (!keys) return null;
    return (
        <kbd
            className={cn(
                "mono border-line bg-panel text-ink-3 shrink-0 rounded border px-[5px] py-px text-[10px] font-normal leading-4",
                className
            )}
        >
            {keys}
        </kbd>
    );
}

/** The shortcut labels a surface shows, already formatted for this platform. */
export interface ShortcutHints {
    palette?: string | null;
    add?: string | null;
    rail?: string | null;
    search?: string | null;
    studio?: string | null;
}

/** "Jump to anything  ⌘K" — a tooltip that carries the key as well as the name. */
export function withShortcut(label: string, keys: string | null | undefined): string {
    return keys ? `${label}  ${keys}` : label;
}
