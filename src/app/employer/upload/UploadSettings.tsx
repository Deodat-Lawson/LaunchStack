"use client";

import React, { useState, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus, Settings } from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { RadioGroup, RadioGroupItem } from "~/app/employer/documents/components/ui/radio-group";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "~/app/employer/documents/components/ui/collapsible";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/app/employer/documents/components/ui/tooltip";
import { Badge } from "~/app/employer/documents/components/ui/badge";

interface BatchSettings {
    category: string;
    processingMethod: string;
    uploadDate: string;
    storageMethod: string;
}

interface UploadSettingsProps {
    categories: { id: string; name: string }[];
    batchSettings: BatchSettings;
    onBatchSettingsChange: React.Dispatch<React.SetStateAction<BatchSettings>>;
    onApplyBatchSettings: () => void;
    processingMethods: { value: string; label: string; description: string }[];
    isUploadThingConfigured: boolean;
    currentStorageValue: string;
    onToggleChange: (value: string) => void;
    isUpdatingPreference: boolean;
    onAddCategory?: (name: string) => Promise<void>;
    storageProvider?: "cloud" | "local";
}

export function UploadSettings({
    categories,
    batchSettings,
    onBatchSettingsChange,
    onApplyBatchSettings,
    processingMethods,
    isUploadThingConfigured,
    currentStorageValue,
    onToggleChange,
    isUpdatingPreference,
    onAddCategory,
    storageProvider,
}: UploadSettingsProps) {
    const [expanded, setExpanded] = useState(false);
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [isSavingCategory, setIsSavingCategory] = useState(false);

    const handleAddCategoryInline = useCallback(async () => {
        if (!newCategoryName.trim() || !onAddCategory) return;
        const name = newCategoryName.trim();
        if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            onBatchSettingsChange((prev) => ({ ...prev, category: name }));
            setNewCategoryName("");
            setIsAddingCategory(false);
            return;
        }
        setIsSavingCategory(true);
        try {
            await onAddCategory(name);
            onBatchSettingsChange((prev) => ({ ...prev, category: name }));
            setNewCategoryName("");
            setIsAddingCategory(false);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSavingCategory(false);
        }
    }, [newCategoryName, onAddCategory, categories, onBatchSettingsChange]);

    const categoryLabel = batchSettings.category
        ? categories.find((c) => c.name === batchSettings.category)?.name ?? batchSettings.category
        : null;

    return (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
            <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-xl shadow-sm">
                <CollapsibleTrigger asChild>
                    <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors rounded-xl">
                        <div className="flex items-center gap-2">
                            <Settings className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                            <span className="text-base font-medium text-gray-900 dark:text-gray-200">
                                Settings
                            </span>
                            {categoryLabel && (
                                <Badge variant="secondary" className="ml-1">
                                    {categoryLabel}
                                </Badge>
                            )}
                        </div>
                        {expanded ? (
                            <ChevronUp className="h-5 w-5 text-gray-500" />
                        ) : (
                            <ChevronDown className="h-5 w-5 text-gray-500" />
                        )}
                    </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                    <div className="px-6 pb-6 space-y-4 border-t border-gray-200 dark:border-purple-500/20 pt-4">
                        {/* Category */}
                        <div>
                            <Label htmlFor="batch-category">Category</Label>
                            {!isAddingCategory ? (
                                <Select
                                    value={batchSettings.category || undefined}
                                    onValueChange={(value) => {
                                        if (value === "add-new") {
                                            setIsAddingCategory(true);
                                        } else {
                                            onBatchSettingsChange((prev) => ({
                                                ...prev,
                                                category: value,
                                            }));
                                        }
                                    }}
                                >
                                    <SelectTrigger id="batch-category">
                                        <SelectValue placeholder="Select a category (optional)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.length === 0 ? (
                                            <div className="p-2 text-sm text-gray-500">
                                                No categories yet
                                            </div>
                                        ) : (
                                            categories.map((c) => (
                                                <SelectItem key={c.id} value={c.name}>
                                                    {c.name}
                                                </SelectItem>
                                            ))
                                        )}
                                        {onAddCategory && (
                                            <SelectItem value="add-new">
                                                <span className="flex items-center gap-2 text-purple-600">
                                                    <Plus className="h-4 w-4" />
                                                    Add new category
                                                </span>
                                            </SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="flex gap-2">
                                    <Input
                                        value={newCategoryName}
                                        onChange={(e) => setNewCategoryName(e.target.value)}
                                        placeholder="Enter category name"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void handleAddCategoryInline();
                                            } else if (e.key === "Escape") {
                                                setIsAddingCategory(false);
                                                setNewCategoryName("");
                                            }
                                        }}
                                        disabled={isSavingCategory}
                                        autoFocus
                                    />
                                    <Button
                                        onClick={() => void handleAddCategoryInline()}
                                        size="sm"
                                        disabled={!newCategoryName.trim() || isSavingCategory}
                                    >
                                        {isSavingCategory ? "..." : "Add"}
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setIsAddingCategory(false);
                                            setNewCategoryName("");
                                        }}
                                        variant="outline"
                                        size="sm"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Processing Method */}
                        {processingMethods.length > 1 && (
                            <div>
                                <Label className="mb-3 block">Processing Method</Label>
                                <RadioGroup
                                    value={batchSettings.processingMethod}
                                    onValueChange={(value) =>
                                        onBatchSettingsChange((prev) => ({
                                            ...prev,
                                            processingMethod: value,
                                        }))
                                    }
                                    aria-label="Processing method selection"
                                >
                                    {processingMethods.map((method) => (
                                        <div
                                            key={method.value}
                                            className="flex items-start space-x-2"
                                        >
                                            <RadioGroupItem
                                                value={method.value}
                                                id={method.value}
                                            />
                                            <div className="flex-1">
                                                <Label
                                                    htmlFor={method.value}
                                                    className="font-normal cursor-pointer flex items-center gap-2"
                                                >
                                                    {method.label}
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="inline-flex items-center justify-center w-4 h-4 text-xs text-gray-500 border border-gray-300 rounded-full cursor-help">
                                                                ?
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="max-w-xs">
                                                                {method.description}
                                                            </p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </Label>
                                            </div>
                                        </div>
                                    ))}
                                </RadioGroup>
                            </div>
                        )}

                        {/* Upload Date */}
                        <div>
                            <Label htmlFor="uploadDate">Upload Date</Label>
                            <Input
                                id="uploadDate"
                                type="date"
                                value={batchSettings.uploadDate}
                                onChange={(e) =>
                                    onBatchSettingsChange((prev) => ({
                                        ...prev,
                                        uploadDate: e.target.value,
                                    }))
                                }
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Optional: Override the upload date for all documents
                            </p>
                        </div>

                        {/* Storage Method */}
                        <div>
                            <Label htmlFor="storageMethod">Storage Method</Label>
                            {storageProvider === "local" ? (
                                <div className="flex items-center h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                                    SeaweedFS (S3)
                                </div>
                            ) : (
                                <Select
                                    value={currentStorageValue}
                                    onValueChange={onToggleChange}
                                >
                                    <SelectTrigger id="storageMethod">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="database">Vercel Blob</SelectItem>
                                        <SelectItem
                                            value="cloud"
                                            disabled={!isUploadThingConfigured}
                                        >
                                            UploadThing
                                            {!isUploadThingConfigured && " (not configured)"}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                            {isUpdatingPreference && (
                                <p className="text-xs text-gray-400 animate-pulse mt-1">
                                    Updating preference...
                                </p>
                            )}
                        </div>

                        {/* Apply to All */}
                        <div className="pt-2">
                            <Button
                                onClick={onApplyBatchSettings}
                                variant="outline"
                                size="sm"
                            >
                                Apply to All
                            </Button>
                        </div>
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}
