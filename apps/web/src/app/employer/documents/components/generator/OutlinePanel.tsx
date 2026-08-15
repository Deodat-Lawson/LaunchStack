"use client";

import { useState } from "react";
import { ListTree, Sparkles, Plus, Loader2, FileText, RefreshCw } from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";
import { ScrollArea } from "~/app/employer/documents/components/ui/scroll-area";
import { OutlineTree } from "./OutlineTree";
import { findItem, deleteItem, saveEdit, addChild as addChildUtil } from "./outline-utils";

// Outline item structure
export interface OutlineItem {
    id: string;
    title: string;
    level: number;
    description?: string;
    children?: OutlineItem[];
    isExpanded?: boolean;
}

interface OutlinePanelProps {
    outline: OutlineItem[];
    documentTitle: string;
    documentDescription: string;
    onOutlineChange: (outline: OutlineItem[]) => void;
    onInsertSection: (title: string, level: number) => void;
    onClose: () => void;
}

export function OutlinePanel({
    outline,
    documentTitle,
    documentDescription,
    onOutlineChange,
    onInsertSection,
    onClose,
}: OutlinePanelProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [topic, setTopic] = useState(documentTitle || "");
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");

    const generateOutline = async () => {
        if (!topic.trim()) return;

        setIsGenerating(true);
        try {
            const response = await fetch("/api/document-generator/outline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "generate",
                    topic,
                    description: documentDescription,
                    options: {
                        depth: 3,
                        sections: 6,
                    },
                }),
            });

            const data = (await response.json()) as {
                success: boolean;
                outline?: OutlineItem[];
            };
            if (data.success && data.outline) {
                onOutlineChange(data.outline);
                const topLevelIds = new Set(data.outline.map(item => item.id));
                setExpandedItems(topLevelIds);
            }
        } catch (error) {
            console.error("Error generating outline:", error);
        } finally {
            setIsGenerating(false);
        }
    };

    const toggleExpand = (id: string) => {
        const newExpanded = new Set(expandedItems);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedItems(newExpanded);
    };

    const startEdit = (item: OutlineItem) => {
        setEditingId(item.id);
        setEditValue(item.title);
    };

    const handleSaveEdit = () => {
        if (!editingId) return;
        onOutlineChange(saveEdit(outline, editingId, editValue));
        setEditingId(null);
        setEditValue("");
    };

    const handleDelete = (id: string) => {
        onOutlineChange(deleteItem(outline, id));
    };

    const handleAddChild = (parentId: string) => {
        const parent = findItem(outline, parentId);
        const parentLevel = parent?.level ?? 1;
        const newItem: OutlineItem = {
            id: `${parentId}.${Date.now()}`,
            title: "New Section",
            level: parentLevel + 1,
        };
        onOutlineChange(addChildUtil(outline, parentId, newItem));
        setExpandedItems(new Set([...expandedItems, parentId]));
    };

    const addTopLevel = () => {
        const newItem: OutlineItem = {
            id: Date.now().toString(),
            title: "New Section",
            level: 1,
        };
        onOutlineChange([...outline, newItem]);
    };

    return (
        <div className="bg-background flex h-full flex-col">
            {/* Header */}
            <div className="border-border border-b p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-foreground flex items-center gap-2 font-semibold">
                        <ListTree className="h-4 w-4" />
                        Outline
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </div>

                {/* Generate Controls */}
                <div className="space-y-2">
                    <Textarea
                        placeholder="Document topic or description..."
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        className="min-h-[60px] text-sm"
                    />
                    <div className="flex gap-2">
                        <Button
                            onClick={generateOutline}
                            disabled={isGenerating || !topic.trim()}
                            className="flex-1 bg-purple-600 hover:bg-purple-700"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Generate Outline
                                </>
                            )}
                        </Button>
                        {outline.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={generateOutline}
                                disabled={isGenerating}
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Outline Tree */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    {outline.length === 0 ? (
                        <div className="text-muted-foreground flex flex-col items-center justify-center py-12">
                            <FileText className="mb-4 h-12 w-12 opacity-20" />
                            <p className="text-sm">No outline yet</p>
                            <p className="mt-1 text-xs">Generate one or add sections manually</p>
                        </div>
                    ) : (
                        <OutlineTree
                            items={outline}
                            expandedItems={expandedItems}
                            editingId={editingId}
                            editValue={editValue}
                            onToggleExpand={toggleExpand}
                            onStartEdit={startEdit}
                            onSaveEdit={handleSaveEdit}
                            onEditValueChange={setEditValue}
                            onAddChild={handleAddChild}
                            onDelete={handleDelete}
                            onInsertSection={onInsertSection}
                        />
                    )}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="border-border border-t p-4">
                <Button variant="outline" size="sm" className="w-full" onClick={addTopLevel}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Section
                </Button>
                <p className="text-muted-foreground mt-2 text-center text-[10px]">
                    Click a section title to insert it into your document
                </p>
            </div>
        </div>
    );
}
