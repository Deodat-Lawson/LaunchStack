"use client";

import { useState, useCallback, useRef } from "react";
import type { OutlineItem } from "./OutlinePanel";
import { OutlineTreeItem } from "./OutlineTreeItem";
import { getVisibleItems, findItem, findParent } from "./outline-utils";

interface OutlineTreeProps {
    items: OutlineItem[];
    expandedItems: Set<string>;
    editingId: string | null;
    editValue: string;
    onToggleExpand: (id: string) => void;
    onStartEdit: (item: OutlineItem) => void;
    onSaveEdit: () => void;
    onEditValueChange: (value: string) => void;
    onAddChild: (parentId: string) => void;
    onDelete: (id: string) => void;
    onInsertSection: (title: string, level: number) => void;
}

export function OutlineTree({
    items,
    expandedItems,
    editingId,
    editValue,
    onToggleExpand,
    onStartEdit,
    onSaveEdit,
    onEditValueChange,
    onAddChild,
    onDelete,
    onInsertSection,
}: OutlineTreeProps) {
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const treeRef = useRef<HTMLDivElement>(null);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (editingId) return; // Don't handle keys while editing

            const visibleIds = getVisibleItems(items, expandedItems);
            if (visibleIds.length === 0) return;

            const currentIndex = focusedId
                ? visibleIds.indexOf(focusedId)
                : -1;

            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    const next =
                        currentIndex < visibleIds.length - 1
                            ? visibleIds[currentIndex + 1]
                            : visibleIds[0];
                    if (next) setFocusedId(next);
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    const prev =
                        currentIndex > 0
                            ? visibleIds[currentIndex - 1]
                            : visibleIds[visibleIds.length - 1];
                    if (prev) setFocusedId(prev);
                    break;
                }
                case "ArrowRight": {
                    e.preventDefault();
                    if (!focusedId) break;
                    const item = findItem(items, focusedId);
                    if (!item) break;
                    if (item.children && item.children.length > 0) {
                        if (!expandedItems.has(focusedId)) {
                            onToggleExpand(focusedId);
                        } else {
                            // Move to first child
                            setFocusedId(item.children[0]!.id);
                        }
                    }
                    break;
                }
                case "ArrowLeft": {
                    e.preventDefault();
                    if (!focusedId) break;
                    if (expandedItems.has(focusedId)) {
                        onToggleExpand(focusedId);
                    } else {
                        // Move to parent
                        const parent = findParent(items, focusedId);
                        if (parent) setFocusedId(parent.id);
                    }
                    break;
                }
                case "Enter": {
                    e.preventDefault();
                    if (focusedId) onToggleExpand(focusedId);
                    break;
                }
                case "F2": {
                    e.preventDefault();
                    if (!focusedId) break;
                    const editItem = findItem(items, focusedId);
                    if (editItem) onStartEdit(editItem);
                    break;
                }
                case "Delete": {
                    e.preventDefault();
                    if (focusedId) {
                        const nextVisibleIds = getVisibleItems(items, expandedItems);
                        const idx = nextVisibleIds.indexOf(focusedId);
                        onDelete(focusedId);
                        // Move focus to neighbor
                        const neighbor =
                            nextVisibleIds[idx + 1] ?? nextVisibleIds[idx - 1] ?? null;
                        setFocusedId(neighbor);
                    }
                    break;
                }
            }
        },
        [
            items,
            expandedItems,
            focusedId,
            editingId,
            onToggleExpand,
            onStartEdit,
            onDelete,
        ],
    );

    const renderItem = (
        item: OutlineItem,
        depth: number,
        isLast: boolean,
    ) => {
        const hasChildren = (item.children?.length ?? 0) > 0;
        const isExpanded = expandedItems.has(item.id);

        return (
            <div key={item.id} className="relative">
                {/* Horizontal connector line (for non-root items) */}
                {depth > 0 && (
                    <div
                        className="absolute border-t border-border"
                        style={{
                            left: `${(depth - 1) * 20 + 12 + 10}px`,
                            top: "18px",
                            width: "10px",
                        }}
                    />
                )}

                <OutlineTreeItem
                    item={item}
                    depth={depth}
                    isExpanded={isExpanded}
                    isFocused={focusedId === item.id}
                    isEditing={editingId === item.id}
                    editValue={editValue}
                    onToggleExpand={onToggleExpand}
                    onStartEdit={onStartEdit}
                    onSaveEdit={onSaveEdit}
                    onEditValueChange={onEditValueChange}
                    onAddChild={onAddChild}
                    onDelete={onDelete}
                    onInsertSection={onInsertSection}
                    childCount={item.children?.length ?? 0}
                />

                {/* Children with vertical connector line */}
                {hasChildren && isExpanded && (
                    <div className="relative">
                        {/* Vertical connector line */}
                        <div
                            className="absolute border-l border-border"
                            style={{
                                left: `${depth * 20 + 12 + 10}px`,
                                top: 0,
                                bottom: "18px",
                            }}
                        />
                        {item.children!.map((child, index) =>
                            renderItem(
                                child,
                                depth + 1,
                                index === item.children!.length - 1,
                            ),
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            ref={treeRef}
            role="tree"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => {
                if (!focusedId && items.length > 0) {
                    setFocusedId(items[0]!.id);
                }
            }}
            className="outline-none space-y-0.5"
        >
            {items.map((item, index) =>
                renderItem(item, 0, index === items.length - 1),
            )}
        </div>
    );
}
