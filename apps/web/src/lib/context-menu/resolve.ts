import { tidyMenuItems, type ActionMenuItem } from "~/components/ui/action-menu";
import {
    APP_TARGET_KIND,
    type ActionDefinition,
    type ContextTarget,
    type MenuOpenContext,
} from "./types";

/**
 * Pure composition: a chain of targets plus the registered actions become one
 * item list. No DOM, no React — so the whole policy is unit-testable.
 *
 * Rules, in order:
 * - Overlays (a selection, a link) always contribute, first.
 * - The first non-overlay target is primary: it always contributes and names
 *   the menu.
 * - Ancestors contribute only when they opted in with `inherit`.
 * - The app root contributes only when nothing else did.
 * - Within a group: the target's own items, then registered actions sorted by
 *   `order`, with danger actions last after a separator.
 */
export function resolveMenu(
    ctx: MenuOpenContext,
    actions: readonly ActionDefinition[]
): { items: ActionMenuItem[]; ariaLabel: string } {
    const groups: ActionMenuItem[][] = [];
    let primarySeen = false;
    let ariaLabel: string | undefined;

    for (const target of ctx.chain) {
        let contributes: boolean;
        if (target.kind === APP_TARGET_KIND) {
            contributes = groups.length === 0;
        } else if (target.overlay) {
            contributes = true;
        } else if (!primarySeen) {
            contributes = true;
            primarySeen = true;
            ariaLabel ??= target.label;
        } else {
            contributes = Boolean(target.inherit);
        }
        if (!contributes) continue;

        const own = target.items?.(ctx) ?? [];
        const registered = actionItems(target, ctx, actions);
        const group = tidyMenuItems([
            ...own,
            { type: "separator", id: `sep-${target.kind}-actions` },
            ...registered,
        ]);
        if (group.length > 0) groups.push(group);
    }

    const items = tidyMenuItems(
        groups.flatMap((group, i) =>
            i === 0 ? group : [{ type: "separator" as const, id: `sep-group-${i}` }, ...group]
        )
    );
    return { items, ariaLabel: ariaLabel ?? "Actions" };
}

/** The registered actions that apply to one target, as menu items. */
export function actionItems(
    target: ContextTarget,
    ctx: MenuOpenContext,
    actions: readonly ActionDefinition[]
): ActionMenuItem[] {
    const matching = actions
        .map((action, index) => ({ action, index }))
        .filter(({ action }) => safeApplies(action, target, ctx))
        .sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0) || a.index - b.index)
        .map(({ action }) => action);

    const normal: ActionMenuItem[] = [];
    const danger: ActionMenuItem[] = [];
    for (const action of matching) {
        (action.danger ? danger : normal).push(toItem(action, target, ctx));
    }
    if (danger.length === 0) return normal;
    return [...normal, { type: "separator", id: `sep-${target.kind}-danger` }, ...danger];
}

function safeApplies(
    action: ActionDefinition,
    target: ContextTarget,
    ctx: MenuOpenContext
): boolean {
    try {
        return action.appliesTo(target, ctx);
    } catch {
        return false;
    }
}

export function toItem(
    action: ActionDefinition,
    target: ContextTarget,
    ctx: MenuOpenContext
): ActionMenuItem {
    const label = typeof action.label === "function" ? action.label(target, ctx) : action.label;
    // `false` and "" both mean "enabled" — only a non-empty string is a reason.
    const verdict = action.disabled?.(target, ctx);
    const reason = typeof verdict === "string" && verdict.length > 0 ? verdict : undefined;
    if (action.children) {
        return {
            type: "submenu",
            id: action.id,
            label,
            icon: action.icon,
            disabled: Boolean(reason),
            disabledReason: reason,
            items: reason ? [] : action.children(target, ctx),
        };
    }
    return {
        type: "item",
        id: action.id,
        label,
        icon: action.icon,
        shortcut: action.shortcut,
        danger: action.danger,
        checked: action.checked?.(target, ctx),
        disabled: Boolean(reason),
        disabledReason: reason,
        onSelect: () => {
            void action.run(target, ctx);
        },
    };
}
