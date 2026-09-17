import type { ActionMenuIconName } from "./icons";

/**
 * Declarative items for an action menu. Kept as data so the menu chrome can
 * stay dumb, builders can be unit-tested without a portal, and the same list
 * can feed a context menu, a "⋯" button, or the command palette.
 */
export type ActionMenuItem =
    | {
          type: "label";
          id: string;
          label: string;
      }
    | {
          type: "separator";
          id: string;
      }
    | {
          type: "item";
          id: string;
          label: string;
          danger?: boolean;
          disabled?: boolean;
          disabledReason?: string;
          checked?: boolean;
          shortcut?: string;
          icon?: ActionMenuIconName;
          onSelect: () => void;
      }
    | {
          type: "submenu";
          id: string;
          label: string;
          icon?: ActionMenuIconName;
          disabled?: boolean;
          disabledReason?: string;
          items: ActionMenuItem[];
      };

export type ActionMenuActionable = Extract<ActionMenuItem, { type: "item" | "submenu" }>;

export function actionableItems(items: ActionMenuItem[]): ActionMenuActionable[] {
    return items.filter(
        (item): item is ActionMenuActionable => item.type === "item" || item.type === "submenu"
    );
}

/**
 * Drops separators that would render at the edges or back-to-back, so builders
 * can emit them unconditionally between groups that may turn out empty.
 */
export function tidyMenuItems(items: ActionMenuItem[]): ActionMenuItem[] {
    const out: ActionMenuItem[] = [];
    for (const item of items) {
        if (item.type === "separator") {
            const prev = out[out.length - 1];
            if (!prev || prev.type === "separator" || prev.type === "label") continue;
        }
        out.push(item);
    }
    while (out.length && out[out.length - 1]!.type === "separator") out.pop();
    return out;
}
