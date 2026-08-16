"use client";

import { ChevronRight, ChevronDown, FileText, ListTree, Edit2, Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { getItemStyles } from "./outline-utils";
import type { OutlineItem } from "./OutlinePanel";

interface OutlineTreeItemProps {
    item: OutlineItem;
    depth: number;
    isExpanded: boolean;
    isFocused: boolean;
    isEditing: boolean;
    editValue: string;
    onToggleExpand: (id: string) => void;
    onStartEdit: (item: OutlineItem) => void;
    onSaveEdit: () => void;
    onEditValueChange: (value: string) => void;
    onAddChild: (parentId: string) => void;
    onDelete: (id: string) => void;
    onInsertSection: (title: string, level: number) => void;
    childCount: number;
}

export function OutlineTreeItem({
    item,
    depth,
    isExpanded,
    isFocused,
    isEditing,
    editValue,
    onToggleExpand,
    onStartEdit,
    onSaveEdit,
    onEditValueChange,
    onAddChild,
    onDelete,
    onInsertSection,
    childCount,
}: OutlineTreeItemProps) {
    const hasChildren = childCount > 0;
    const styles = getItemStyles(item.level);

    return (
        <div
            role="treeitem"
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-level={depth + 1}
            aria-selected={isFocused}
            data-item-id={item.id}
            className={cn(
                "group flex items-center gap-1.5 rounded-md py-1.5 transition-colors",
                isFocused ? "bg-accent ring-ring/30 ring-1" : "hover:bg-muted/50"
            )}
            style={{ paddingLeft: `${depth * 20 + 12}px`, paddingRight: "8px" }}
        >
            {/* Expand/Collapse */}
            <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 flex-shrink-0 p-0"
                onClick={() => onToggleExpand(item.id)}
                tabIndex={-1}
                aria-label={hasChildren ? (isExpanded ? "Collapse" : "Expand") : undefined}
            >
                {hasChildren ? (
                    isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )
                ) : (
                    <div className="h-4 w-4" />
                )}
            </Button>

            {/* Level icon */}
            {styles.showIcon && (
                <span className="text-muted-foreground flex-shrink-0">
                    {item.level === 1 ? (
                        <FileText className={styles.iconSize} />
                    ) : (
                        <ListTree className={styles.iconSize} />
                    )}
                </span>
            )}

            {/* Title or edit input */}
            {isEditing ? (
                <Input
                    value={editValue}
                    onChange={e => onEditValueChange(e.target.value)}
                    onBlur={onSaveEdit}
                    onKeyDown={e => {
                        if (e.key === "Enter") onSaveEdit();
                        if (e.key === "Escape") onSaveEdit();
                    }}
                    className="h-7 flex-1 text-sm"
                    autoFocus
                />
            ) : (
                <span
                    className={cn("flex-1 cursor-pointer truncate", styles.textClass)}
                    onClick={() => onInsertSection(item.title, item.level)}
                >
                    {item.title}
                </span>
            )}

            {/* Children count badge */}
            {hasChildren && !isEditing && (
                <span className="bg-muted text-muted-foreground flex-shrink-0 rounded-full px-1.5 text-[10px] tabular-nums">
                    {childCount}
                </span>
            )}

            {/* Actions (visible on hover or focus) */}
            <div
                className={cn(
                    "flex flex-shrink-0 gap-0.5 transition-opacity",
                    isFocused ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
            >
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onStartEdit(item)}
                    tabIndex={-1}
                    aria-label="Edit"
                >
                    <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onAddChild(item.id)}
                    tabIndex={-1}
                    aria-label="Add child"
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                    onClick={() => onDelete(item.id)}
                    tabIndex={-1}
                    aria-label="Delete"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
