"use client";

import {
    ChevronRight,
    ChevronDown,
    FileText,
    ListTree,
    Edit2,
    Plus,
    Trash2,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
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
                "flex items-center gap-1.5 py-1.5 rounded-md group transition-colors",
                isFocused
                    ? "bg-accent/60 ring-1 ring-ring/30"
                    : "hover:bg-muted/50",
            )}
            style={{ paddingLeft: `${depth * 20 + 12}px`, paddingRight: "8px" }}
        >
            {/* Expand/Collapse */}
            <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={() => onToggleExpand(item.id)}
                tabIndex={-1}
                aria-label={
                    hasChildren
                        ? isExpanded
                            ? "Collapse"
                            : "Expand"
                        : undefined
                }
            >
                {hasChildren ? (
                    isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                    ) : (
                        <ChevronRight className="w-4 h-4" />
                    )
                ) : (
                    <div className="w-4 h-4" />
                )}
            </Button>

            {/* Level icon */}
            {styles.showIcon && (
                <span className="flex-shrink-0 text-muted-foreground">
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
                    onChange={(e) => onEditValueChange(e.target.value)}
                    onBlur={onSaveEdit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onSaveEdit();
                        if (e.key === "Escape") onSaveEdit();
                    }}
                    className="h-7 text-sm flex-1"
                    autoFocus
                />
            ) : (
                <span
                    className={cn(
                        "flex-1 cursor-pointer truncate",
                        styles.textClass,
                    )}
                    onClick={() => onInsertSection(item.title, item.level)}
                >
                    {item.title}
                </span>
            )}

            {/* Children count badge */}
            {hasChildren && !isEditing && (
                <span className="flex-shrink-0 bg-muted rounded-full px-1.5 text-[10px] text-muted-foreground tabular-nums">
                    {childCount}
                </span>
            )}

            {/* Actions (visible on hover or focus) */}
            <div
                className={cn(
                    "flex gap-0.5 flex-shrink-0 transition-opacity",
                    isFocused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
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
                    <Edit2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onAddChild(item.id)}
                    tabIndex={-1}
                    aria-label="Add child"
                >
                    <Plus className="w-3.5 h-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                    onClick={() => onDelete(item.id)}
                    tabIndex={-1}
                    aria-label="Delete"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );
}
