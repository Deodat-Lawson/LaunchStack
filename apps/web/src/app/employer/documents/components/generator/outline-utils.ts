import type { OutlineItem } from "./OutlinePanel";

/**
 * Recursively find an item by ID in the outline tree.
 */
export function findItem(
    items: OutlineItem[],
    id: string,
): OutlineItem | null {
    for (const item of items) {
        if (item.id === id) return item;
        if (item.children) {
            const found = findItem(item.children, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Find the parent of an item by ID.
 */
export function findParent(
    items: OutlineItem[],
    id: string,
): OutlineItem | null {
    for (const item of items) {
        if (item.children?.some((c) => c.id === id)) return item;
        if (item.children) {
            const found = findParent(item.children, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Recursively delete an item by ID from the tree.
 */
export function deleteItem(
    items: OutlineItem[],
    id: string,
): OutlineItem[] {
    return items
        .filter((item) => item.id !== id)
        .map((item) => ({
            ...item,
            children: item.children
                ? deleteItem(item.children, id)
                : undefined,
        }));
}

/**
 * Recursively update an item's title by ID.
 */
export function saveEdit(
    items: OutlineItem[],
    id: string,
    newTitle: string,
): OutlineItem[] {
    return items.map((item) => {
        if (item.id === id) {
            return { ...item, title: newTitle };
        }
        if (item.children) {
            return { ...item, children: saveEdit(item.children, id, newTitle) };
        }
        return item;
    });
}

/**
 * Add a child item under the parent with the given ID.
 */
export function addChild(
    items: OutlineItem[],
    parentId: string,
    child: OutlineItem,
): OutlineItem[] {
    return items.map((item) => {
        if (item.id === parentId) {
            return {
                ...item,
                children: [...(item.children ?? []), child],
            };
        }
        if (item.children) {
            return { ...item, children: addChild(item.children, parentId, child) };
        }
        return item;
    });
}

/**
 * Return a flat array of item IDs in visual (depth-first) order,
 * respecting which items are currently expanded.
 */
export function getVisibleItems(
    items: OutlineItem[],
    expandedItems: Set<string>,
): string[] {
    const result: string[] = [];
    for (const item of items) {
        result.push(item.id);
        if (item.children && expandedItems.has(item.id)) {
            result.push(...getVisibleItems(item.children, expandedItems));
        }
    }
    return result;
}

/**
 * Return Tailwind class names for an item based on its tree level.
 */
export function getItemStyles(level: number): {
    textClass: string;
    showIcon: boolean;
    iconSize: string;
} {
    if (level === 1) {
        return {
            textClass: "text-sm font-semibold",
            showIcon: true,
            iconSize: "w-4 h-4",
        };
    }
    if (level === 2) {
        return {
            textClass: "text-sm font-medium",
            showIcon: true,
            iconSize: "w-3.5 h-3.5",
        };
    }
    return {
        textClass: "text-xs text-muted-foreground",
        showIcon: false,
        iconSize: "w-3 h-3",
    };
}
